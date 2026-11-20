// The relay core: the rules every adapter follows, with no transport in it.
//
// A meeting is two WebSocket connections that ask for the same meeting key.
// The relay pairs them and passes binary frames between them, unread. It
// holds no state beyond the meeting itself and has no authority: devices
// encrypt end to end inside the relayed stream and check who is on the
// other end themselves.
//
// The wire protocol, version 1:
//   1. A device opens `wss://<relay>/v1/pair/<key>`, where <key> is 64 hex
//      characters (32 bytes) both devices derived for this meeting.
//   2. A third connection for a key that already has two is refused with
//      HTTP 409 before the upgrade.
//   3. When the second device arrives, the relay sends the text frame
//      `paired` to both. Devices send nothing before it.
//   4. From then on every binary frame one device sends reaches the other
//      unchanged. Text frames from devices are not allowed.
//   5. When either device leaves, the relay closes the other with
//      CLOSE.PEER_LEFT. The key can be used again for a new meeting.
//   6. At any time a device may send the text frame `ping`; the relay
//      answers `pong` and passes nothing on. A device that has sent one is
//      taken to be sending them, every HEARTBEAT_MS: once it has been silent
//      for `silenceMs` it is closed with CLOSE.SILENT, and its meeting with
//      it. A phone that loses its network or is suspended is let go in
//      seconds, and the other device can look for it another way. A device
//      that never pings is held to the other limits only.

export const PROTOCOL_VERSION = 1;

/** The text frame the relay sends to both devices once they are paired. */
export const PAIRED = 'paired';

/** The heartbeat a device may send, and the relay's answer. */
export const PING = 'ping';
export const PONG = 'pong';

/** How often a device that pings sends one. */
export const HEARTBEAT_MS = 20_000;

/** Close codes the relay uses (the 4000 to 4999 range is for applications). */
export const CLOSE = {
  /** The other device left. */
  PEER_LEFT: 4000,
  /** A device sent data before it was paired, or sent a text frame. */
  PROTOCOL: 4001,
  /** No second device arrived in time. */
  NO_PEER: 4002,
  /** A frame, the meeting's bytes or its duration went over a limit. */
  LIMIT: 4003,
  /** A device that sends heartbeats stopped sending them. */
  SILENT: 4004,
} as const;

export interface Limits {
  /** How long one device waits for the other before it is closed. */
  waitMs: number;
  /** The largest single frame passed through. */
  maxFrameBytes: number;
  /** Bytes passed in both directions over one meeting. */
  maxMeetingBytes: number;
  /** How long one meeting may last. */
  maxMeetingMs: number;
  /** How long a device that pings may go without one before it is closed. */
  silenceMs: number;
}

export const DEFAULT_LIMITS: Limits = {
  waitMs: 60_000,
  maxFrameBytes: 1024 * 1024,
  maxMeetingBytes: 512 * 1024 * 1024,
  maxMeetingMs: 2 * 60 * 60 * 1000,
  // Two heartbeats missed, and a little over.
  silenceMs: 45_000,
};

/** Reads limits from string settings (environment variables), keeping defaults for anything unset or invalid. */
export function limitsFrom(env: Record<string, unknown>, base: Limits = DEFAULT_LIMITS): Limits {
  const read = (name: string, fallback: number): number => {
    const raw = env[name];
    const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  return {
    waitMs: read('RELAY_WAIT_MS', base.waitMs),
    maxFrameBytes: read('RELAY_MAX_FRAME_BYTES', base.maxFrameBytes),
    maxMeetingBytes: read('RELAY_MAX_MEETING_BYTES', base.maxMeetingBytes),
    maxMeetingMs: read('RELAY_MAX_MEETING_MS', base.maxMeetingMs),
    silenceMs: read('RELAY_SILENCE_MS', base.silenceMs),
  };
}

const PAIR_PATH = /^\/v1\/pair\/([0-9a-f]{64})$/;

/** The meeting key in a request path, or null if the path is not a pairing request. */
export function meetingKeyFrom(pathname: string): string | null {
  return PAIR_PATH.exec(pathname)?.[1] ?? null;
}

export type Admission =
  | { ok: true; pairs: boolean }
  | { ok: false; status: number; reason: string };

/** Whether a new connection may join a meeting that already has `present` connections. */
export function admit(present: number): Admission {
  if (present >= 2) return { ok: false, status: 409, reason: 'meeting is full' };
  return { ok: true, pairs: present === 1 };
}

/** What one device's side of a meeting has done, as stored per connection. */
export interface Side {
  joinedAt: number;
  pairedAt: number | null;
  bytes: number;
}

export function newSide(now: number): Side {
  return { joinedAt: now, pairedAt: null, bytes: 0 };
}

/**
 * Each frame is counted as at least this many bytes, so a flood of tiny or
 * empty frames runs into the meeting's byte limit like any other traffic.
 */
export const MIN_FRAME_COST = 64;

export type FrameVerdict =
  | { forward: true; side: Side }
  | { forward: false; code: number; reason: string };

/**
 * Decides what happens to one frame from a device. `meetingBytes` is the
 * total already passed in both directions; the returned side carries this
 * device's new count.
 */
export function onFrame(
  side: Side,
  frame: { binary: boolean; size: number },
  meetingBytes: number,
  limits: Limits,
): FrameVerdict {
  if (side.pairedAt === null) return { forward: false, code: CLOSE.PROTOCOL, reason: 'not paired yet' };
  if (!frame.binary) return { forward: false, code: CLOSE.PROTOCOL, reason: 'binary frames only' };
  if (frame.size > limits.maxFrameBytes) return { forward: false, code: CLOSE.LIMIT, reason: 'frame too large' };
  const cost = Math.max(frame.size, MIN_FRAME_COST);
  if (meetingBytes + cost > limits.maxMeetingBytes) {
    return { forward: false, code: CLOSE.LIMIT, reason: 'meeting byte limit' };
  }
  return { forward: true, side: { ...side, bytes: side.bytes + cost } };
}

export type Deadline = { at: number; code: number; reason: string };

/**
 * When a side must be closed if nothing else happens first. `pingedAt` is
 * when it last sent a heartbeat, or null if it never has.
 */
export function deadlineFor(side: Side, limits: Limits, pingedAt: number | null = null): Deadline {
  const limit: Deadline =
    side.pairedAt === null
      ? { at: side.joinedAt + limits.waitMs, code: CLOSE.NO_PEER, reason: 'no peer arrived' }
      : { at: side.pairedAt + limits.maxMeetingMs, code: CLOSE.LIMIT, reason: 'meeting time limit' };
  if (pingedAt === null) return limit;
  const silent = pingedAt + limits.silenceMs;
  return silent < limit.at ? { at: silent, code: CLOSE.SILENT, reason: 'heartbeat stopped' } : limit;
}

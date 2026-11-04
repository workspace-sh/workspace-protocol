# Key storage

Which keys a device holds, where each one lives on each platform, and how
a person gets them back or takes them elsewhere.

**Status:** design. Stage 1 is the target for the alpha; stage 2 follows
it. The device-identity durability rules in
[`identity-recovery.md`](./identity-recovery.md) apply throughout and are
not repeated here.

## The model

A device holds three kinds of key:

| Key | What it is | Where it may go |
|---|---|---|
| **Device key** | Who this device is. Its public half is the device's `did:key`; workspaces seal envelopes and address delegations to it. | Nowhere. It stays on this device: never synced, never in a backup. |
| **Admin key** | A workspace's root seed, held by the device that created the workspace. It is what makes that device the workspace's admin. | With its owner: to their other devices through the platform's encrypted sync, and out through export. |
| **Store key** | The local Corestore's primary key. It derives the keys of the cores this device writes. | Nowhere. It belongs to one store folder on one device. |

One rule covers all three: **secrets live in the platform's keystore, and
data folders hold none.** A store folder may be copied, backed up or read
by anything running as the user; nothing in it should let that reader act
as the device or the admin.

Kept invite links are bearer secrets and are stored like admin keys.

## Where each key lives

| | Device key | Admin keys | Store folders |
|---|---|---|---|
| **macOS** | Keychain, this device only | Keychain, synced through iCloud Keychain | Application Support, one per workspace |
| **iOS** | Keychain, this device only | Keychain, synced through iCloud Keychain | Application Support, one per workspace, excluded from backup |
| **Android** | Keystore-protected, this device only | Block Store, with cloud backup | App-private storage, excluded from backup |
| **Linux** | Secret Service (libsecret: GNOME Keyring, KWallet) | Secret Service; moved between devices by export | `$XDG_DATA_HOME/workspace`, one per workspace |

Notes per platform:

- **Apple.** An item syncs through iCloud Keychain when it is written with
  `kSecAttrSynchronizable` and an accessibility class without
  `ThisDeviceOnly`. iCloud Keychain is end-to-end encrypted. On macOS the
  item must be in the data protection keychain
  (`kSecUseDataProtectionKeychain`). Sync needs a build signed by the
  team, with a `keychain-access-groups` entitlement scoped to the team,
  which is also what lets the item survive a bundle-identifier change.
  An ad-hoc signed build cannot sync.
- **Android.** Block Store (`setShouldBackupToCloud(true)`) restores small
  secrets to a new device signed in to the same Google account, end-to-end
  encrypted when the device has a screen lock.
- **Linux.** The Secret Service does not sync. Today's implementation
  keeps the device and admin keys in 0600 files under
  `$XDG_DATA_HOME/workspace`; moving them into the Secret Service is part
  of stage 1.
- **Store folders on iOS and Android** are excluded from backup because a
  restore onto a second phone would give it the first phone's store key.
  Two devices writing the same core under one key fork it.

## Rules

1. **The store key is Corestore's own.** An implementation MUST NOT pass
   the device key (or any other long-lived secret) as Corestore's
   `primaryKey`. Corestore writes the key it is given into the store
   folder (`storage.setSeed`), and has no option to keep it out, so
   passing the device key leaves a plain copy of it in every store. Left
   to itself, Corestore makes a random key per store.
2. **The device's DID and swarm keypair come from the device key
   directly**, not from `store.primaryKey`. Both are
   `hypercore-crypto.keyPair(deviceSeed)`, so a device's DID is unchanged
   by rule 1.
3. **Existing stores keep the key they hold.** Opening an existing store
   without a `primaryKey` reuses the key saved in it, so the device's
   writer cores keep their keys and the device keeps write access.
   Passing a *different* key is refused ("Another corestore is stored
   here"); an implementation MUST omit the key, never replace it. A store
   made before rule 1 keeps its copy of the device key until the device
   rejoins that workspace with a new store.
4. **The device key is never synced and never backed up.** A synced
   device key makes two devices one device to every workspace.
5. **Admin keys and kept invites follow their owner** where the platform
   offers end-to-end encrypted sync, and can always be exported.

Corestore 7.9.2 behaves as rules 1 and 3 describe: a store created with a
given key, reopened with none, reports the same `primaryKey` and the same
key for a named core; reopened with a different key, it refuses.

## Recovery and export

### Stage 1: the alpha

- **On Apple and Android, nothing to do.** A person's admin keys reach
  their new device through iCloud Keychain or Block Store. The new device
  makes its own device key and is linked like any other
  ([`identity-recovery.md` §1](./identity-recovery.md#1-device-linking-the-happy-path)).
- **Export.** Settings saves the admin keys and kept invites as one file,
  encrypted with a passphrase the person chooses. Import reads it back on
  any platform. This is the route on Linux, and between Apple and other
  platforms.

### Stage 2: a personal key

- One **personal key** per person, above their device keys, backed by a
  24-word phrase (BIP39), as Holepunch's
  [`keet-identity-key`](https://github.com/holepunchto/keet-identity-key)
  does. The phrase can be shown in Settings; it is never required at
  setup.
- The personal key **attests each of the person's devices**. A workspace
  that grants access to the person then accepts a new device of theirs
  without a fresh invite. This changes how membership is granted
  ([`permissions-model.md`](./permissions-model.md)), so it is a protocol
  change, not a storage one.
- It syncs through iCloud Keychain or Block Store where they exist. A
  device without them takes the phrase, or a code scanned from a device
  the person already has.
- It is the recovery key that
  [`identity-recovery.md` §2](./identity-recovery.md#2-recovery-all-devices-lost)
  describes: recovery with no surviving device.

### Not now: passkeys

A passkey with the WebAuthn PRF extension yields a synced secret from the
platform credential store, and is the other option named in
`identity-recovery.md` §2. It needs an associated domain, team-signed
builds and a recent OS, and has weak support on Linux; the personal key
covers the same need without them.

## Open questions

1. On a new Apple or Android device, are admin keys restored
   automatically by the platform's sync, or only when the person chooses
   to restore them?
2. Is a passphrase-protected export file enough for stage 1, or does the
   24-word phrase come first?
3. With every device lost and no export, is recovery offered at all?
   Platform sync or the phrase is what would cover it.

## Cross-references

- [`identity-recovery.md`](./identity-recovery.md): device linking,
  recovery, rotation, and the durability rules for the device key
- [`risks.md` §4](../security/risks.md#4-identity-recovery): recovery
  tiers and their trust models
- [`permissions-model.md`](./permissions-model.md): envelopes and
  delegations addressed to device DIDs

---

Up: [Permissions and identity](./README.md) · [All docs](../README.md)

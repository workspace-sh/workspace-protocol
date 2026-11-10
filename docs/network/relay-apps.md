# Other apps on Hypercore: how they connect

Companion to [relay-notes.md](./relay-notes.md). "Source read" means its code was checked for relay settings.

## Keet

- Link: https://keet.io/
- Connects with HyperDHT hole-punching.
- Relay: yes. Hyperswarm's own tests load relay keys from Keet's private config package, so Holepunch very likely runs Keet's relays.
- Source read: no (closed source).

## PearPass

- Link: https://github.com/tetherto/pearpass-app-desktop
- Connects with Hyperswarm hole-punching.
- Relay: none configured. `blind-relay` is present only as a dependency of HyperDHT.
- Source read: yes.

## QVAC

- Link: https://pears.com/apps
- Built on Pear and Hyperswarm.
- Relay: unknown.
- Source read: no.

## CoMapeo

- Link: https://github.com/digidem/comapeo-core
- Local network: finds peers itself and connects over TCP, encrypted with Noise.
- Internet: Hyperswarm hole-punching.
- Server: can also sync to a server over WebSocket.
- Relay: none configured.
- Source read: yes.

## Ghostly

- Link: https://github.com/MiguelMedeiros/ghostly
- Connects with HyperDHT.
- Relay: runs its own HyperDHT relay so its web app can connect, and has optional relay and TURN settings.
- Source read: yes (settings and changelog).

## Varanda

- Link: https://github.com/Varanda-org/varanda
- Connects with Hyperswarm.
- Relay: a HyperDHT relay script serves its web client.
- Source read: yes (file names only).

## Holesail

- Link: https://github.com/holesail/holesail
- Connects with HyperDHT hole-punching.
- Relay: none configured.
- Source read: yes.

## datrs

- Link: https://github.com/datrs/hypercore
- Hypercore in Rust, with its own networking.
- Relay: unknown.
- Source read: no.

Up: [Network](./README.md)

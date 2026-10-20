# Workspace Protocol docs

The specification, in flight. Each folder has its own index.

- [Format](./format/README.md): What a workspace is on disk and how it's addressed.
- [Sync](./sync/README.md): How a workspace's content replicates and merges between peers.
- [Network](./network/README.md): How peers find and reach each other, and stay available.
- [Permissions and identity](./permissions/README.md): Who may do what, how access is granted, and how identity survives lost devices.
- [Security](./security/README.md): What Workspace protects, what it doesn't, and where it could fall down.
- [Lighthouse](./lighthouse/README.md): always-on peers a workspace opts into: principles, deployment, prior art
- [Workspace actions](./actions/README.md): sandboxed functions in a document, across files or for a workspace (a spike within the spec)
- [Decisions](./adr/README.md): architecture decision records

Start with [`format/workspace-format.md`](./format/workspace-format.md) for what's being built, then [`security/threat-model.md`](./security/threat-model.md) for the contract that bounds it, [`format/uri-scheme.md`](./format/uri-scheme.md) for addressing, [`permissions/permissions-model.md`](./permissions/permissions-model.md) for the protocol underneath, and [`security/risks.md`](./security/risks.md) for where it could fall down.

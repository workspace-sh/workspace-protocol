# Connections, credentials and trust

How an action reaches outside services without seeing their secrets, who runs it when nobody's awake, and how a result can be checked.

## Connections and credentials

1. Secrets never live in the document. An action names a connection
   (`:conn/github`); the token stays in the device's secure store
   (Keychain, libsecret, Keystore).
2. The action never sees the token. The host attaches it below the
   sandbox, and only to the connection's declared hosts. Kinds: API key,
   bearer, JWT, OAuth with PKCE.
3. Kept results from a connection record their source, and ask before
   writing into a shared document.
4. In a team, in order of preference:
   1. each member brings their own credential (the default);
   2. a member delegates the *right to ask* (a UCAN), never the
      credential: their device runs it and writes a signed result;
   3. short-lived derived tokens encrypted to specific devices through
      the grant envelopes in [`permissions-model.md`](../permissions/permissions-model.md).
      Never the root secret.

   An action's rights are the intersection of the caller's rights in the
   document, what the action declares, and the connection's grant.
5. When every device that holds a connection is offline, the request
   waits in the document log, and the last kept value shows.

## Always-on nodes

A node that runs actions when people's devices are asleep is a
[Lighthouse](../lighthouse/README.md) that has opted in. One per workspace and
one per person or team (both, decided). Whether its default is to only
seed (hold and pass on blocks) or also to execute is reopened: too early
to tell until the stack shows it can.

## Trust

A kept result could be signed with who ran it (the node's key), under
what authority (the UCAN chain), which code (the action's hash), and
which inputs (their hash). Any peer can then check a result instead of
running it again. The same would cover a model run inside an action (a
model hash).

Up: [Workspace actions](./README.md) · [All docs](../README.md)

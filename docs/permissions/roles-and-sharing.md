# Roles and sharing

Who can do what in a workspace, at what level, and how each rule is enforced
without a server. Sharing is meant to work the way people know from Dropbox and
Google Drive: share a workspace, a folder or a file with a person, at a role,
and change or take it back at any time.

**Status (18 Nov 2026):** specified here, not built, except the whole-workspace
roles noted under [What is built](#what-is-built). This document supersedes the
role names in [`workspace-format.md`](../format/workspace-format.md) § Permission
semantics (`read` / `edit` / `admin`) and settles open question 3 of
[`join-by-link.md`](./join-by-link.md) (a folder key hierarchy).

## Roles

A person has one role on the workspace. They can be given more on a folder or a
file (see [Levels](#levels)).

| Role | Reads | Creates, edits, deletes | Shares with existing members | Invites people, changes roles | Workspace settings |
|---|---|---|---|---|---|
| **Owner** | Everything | Everything | Yes | Yes, Admins included | Yes, and transfers or deletes the workspace |
| **Admin** | Everything | Everything | Yes | Yes, except the Owner | Yes |
| **Manager** | What they are given | What they are given | Yes, what they hold | Yes | Yes, except transfer and delete |
| **Collaborator** | What they are given | What they are given | Yes, what they hold | No | No |
| **Viewer** | What they are given | No | No | No | No |

- **Owner** created the workspace and holds its root key. There is one. The
  root key is never copied to give someone ownership: ownership moves by
  transfer (a signed record naming the new root, below).
- **Admin** is given owner rights by the Owner, and the Owner can take them
  back. An Admin holds every content key.
- **Manager** runs people and settings without reading everything: a Manager
  holds only the content keys they were given, like a Google Workspace
  administrator who cannot open your Docs.
- **Collaborator** works in what they were given. They can share it with
  people already in the workspace, at their own role or below, and cannot
  invite anyone new.
- **Viewer** reads what they were given.

A workspace shared with nobody is its Owner's alone. Shared as a whole,
read-only or collaborative, it is the same model at its widest level: the person
is a Viewer or a Collaborator on the workspace root.

### Names in apps

The apps say "Owner", "Admin", "Manager", "Can edit" (Collaborator) and "Can
view" (Viewer). The code's existing `editor` and `viewer` roles are
Collaborator and Viewer.

## Levels

| Level | What it covers |
|---|---|
| Workspace | Every folder and file in it |
| Folder | The folder and everything beneath it |
| File | One `.md`, `.canvas` or `.table` (a `.table` folder is one file) |
| `.table` rows and columns | See [Tables](#tables-rows-and-columns) |

Rules:

1. **Access flows down.** A role on a folder applies to everything beneath it.
2. **A grant only adds.** A person's access to a path is the highest role any
   of their grants gives on it or on a folder above it. There is no "everything
   except this subfolder" in v1: taking a subfolder away from someone who holds
   the folder above would need that subfolder re-keyed and split out of the
   hierarchy, and it is left for later.
3. **You share only what you hold, at your role or below.** A Collaborator on
   `/Projects` can make someone a Viewer or a Collaborator on `/Projects` or
   anything in it, and nothing else.
4. **Roles are not POSIX permissions.** There are no per-user read, write and
   execute bits and no groups in v1; a role at a level is the whole statement.

## Changing access

Access can be changed or taken back at any time, by anyone who could have
given it. Taking access back is forward-only: the person receives no new
changes and cannot write again, but whatever reached their device before is
theirs, as it would be after leaving a shared Dropbox folder. Apps say so in
those words when access is taken back. The mechanisms are
[`permissions-model.md`](./permissions-model.md) § Revocation.

## How each rule is enforced

Nothing here asks a server. Every check runs on the device, against data it
already holds.

| What | Enforced by | Where |
|---|---|---|
| Reading a folder or file | Encryption: no key, no plaintext | Content keys, [below](#content-keys) |
| Writing a folder or file | Every device refuses the change when applying the log | The workspace's Autobase `apply` |
| Inviting, changing roles, settings | The same: records from someone without the role are refused | Autobase `apply`, as membership and relay records are today |
| Who may connect | The connection gate | [`permissions-model.md`](./permissions-model.md) § Topic-layer |

Writes and settings are checked by every honest device independently, from the
same log, so they agree. A modified client can write a refused change into its
own log, but no other device applies it. Reads are the only rule that holds
against a modified client by cryptography alone, which is why reading is keys.

### Grants

A grant is a UCAN delegation (`packages/ucan-boundary`), issued by someone
holding the role it gives:

| Role | Command | Resource |
|---|---|---|
| Admin | `/workspace` | `workspace://v1/<id>` |
| Manager | `/workspace/members`, `/workspace/settings` | `workspace://v1/<id>` |
| Collaborator | `/workspace/edit`, `/workspace/share` | `workspace://v1/<id>/<path>` |
| Viewer | `/workspace/read` | `workspace://v1/<id>/<path>` |

`/workspace/edit` includes reading, and a path covers everything beneath it
(the resource policy is a path prefix ending in `/`). A grant's chain must end
at the workspace's root key, so an Admin's or Collaborator's re-shares verify
like the Owner's own. The log records each grant and each withdrawal as a
membership record, so every device computes the same roles at the same point
in the log.

### Content keys

- Each shared folder has a key. A folder's key seals the keys of the folders
  and files directly beneath it, so holding a folder's key opens everything
  under it, and nothing above or beside it.
- A file shared on its own has a key of its own, sealed by its folder's key.
- The workspace root's key is today's `K0`.
- Granting a role on a path sends the person that path's key, sealed to them,
  through the key delivery log ([`permissions-model.md`](./permissions-model.md)
  § Two carriers).
- Taking access back rotates the key of each path the person held, and of the
  folders beneath it, and sends the new keys to everyone still holding them.
  Old content stays under the old keys (forward-only).
- Moving a file or folder re-seals its key under the new parent's key; its
  content is not re-encrypted.

## Tables: rows and columns

A `.table` follows the pattern of Airtable and Coda (Superhuman Docs): whether
a person can see a cell is whether they can see its row and its column.

- **Columns** use the tiers already specified: a column marked `x-tier` is
  sealed with that tier's key, and a column whose name is sensitive can be
  hidden ([`workspace-format.md`](../format/workspace-format.md) § Hidden schema
  entries).
- **Rows** have an audience: everyone who can read the table (the default), or
  a narrower audience the table names, for example the people in a row's
  person field ("Owner", "Assignee") or a named group. A row's values are
  sealed with its audience's key.
- **A cell** whose row and column are both restricted is sealed with a key
  derived from both (its row audience's key and its column tier's key), so it
  opens only for someone holding both.
- **Editing** a row or a column is checked in `apply` like any write: a person
  edits a row and a column they can see, at Collaborator or above on the table.
- **A view's filter is not a permission.** A filter hides rows from a view and
  protects nothing; only an audience or a tier does. Apps don't present a
  filter as access control.

### Tables that reference tables

Tables linked by relations make applications inside a workspace: a recruitment
tracker with Candidates, Roles, Interviews and Offers, each its own table,
each related to the others (`.table` SPEC: `relation` fields, which resolve in
the same bundle or in a `.table` beside it, and `related` formulas that follow
them). Permissions hold across those links:

- **Each table keeps its own rules.** A relation shows a related row only as
  far as the reader can see that row and that column in its own table. A
  related row the reader can't see shows as a restricted link, never as its
  values, and never as missing, so nobody mistakes it for a broken link.
- **Formulas see what the reader sees.** A `related` value or a rollup is
  computed on each reader's device over the rows and columns they can see, so a
  rollup can't reveal what it summarises. Two people can therefore see
  different totals.
- **A total that must include hidden rows is published, not computed.** When
  everyone should see a figure built from rows only some can read (an
  interviewer sees "4 offers out", not the offers), someone who can see the
  rows stores the figure as a value, sealed at the audience it's meant for.
  How an app keeps such a value current is open (below).

### Performance

The aim is that a restricted table opens and sorts as fast as an open one, and
that nothing waits on another document or device:

- **Keys per audience and per tier, never per row or per cell.** A table with
  10,000 rows and three audiences has three row keys. A device unseals each
  key once per session, not once per row.
- **Every check is local.** Visibility is decided from keys already on the
  device. No request leaves the device to decide what a person can see.
- **No cross-document fetch at read time.** A linked row from another table
  shows from that table's local copy, already replicated, as far as the
  reader's keys open it. A table never waits on another to load. The lag
  people see in Coda's cross-doc tables comes from a server copying rows
  between documents on a schedule, and nothing here works that way.
- **Large tables** decrypt by block, as they read by block today
  (`.table` large-table index), so a restricted large table costs one unseal
  per block read, not per row.

## What is built

As of 18 Nov 2026, in the workspace repository (`packages/workspace`):

- One role on the whole workspace: the admin (today's Owner), `editor`
  (Collaborator) and `viewer` (Viewer), as Autobase records checked in
  `apply`.
- One content key (`K0`) and one grant (`/workspace/read` on
  `workspace://v1/<id>`) per member.
- Taking access back refuses the person's device from its next connection and
  their writes from then on.

## Order of work

1. The five roles on the whole workspace: Owner transfer, Admin and Manager
   grants, Collaborators sharing with existing members only.
2. Folder sharing: folder keys, path checks in `apply`, path grants.
3. File sharing: the same at file level.
4. `.table` rows and columns.

## Open questions

1. **Excluding a subfolder** from someone who holds the folder above it
   (a "deny"), and what it costs to re-key.
2. **Groups**: whether a named group (a team) is a v1 audience, or only
   people.
3. **Owner transfer**: the record that names a new root key, and what
   happens to grants chained to the old one.
4. **Published totals**: who keeps a published value current when the rows
   under it change, and how a reader can tell how recent it is.

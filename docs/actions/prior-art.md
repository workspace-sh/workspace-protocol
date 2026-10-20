# Prior art

What other tools call this and how they work, compared with this proposal.

What other tools call this and how they work, from their documentation
on 18 Oct 2026.

| | Their name | Runs where | Reaching outside | Credentials | Limits |
| --- | --- | --- | --- | --- | --- |
| Superhuman Docs (Coda) | Packs: formulas (flagged `isAction` when they change things), sync tables, MCP servers | Their service | Declared domains (`addNetworkDomain`) | OAuth2 or bearer, used through the host's fetcher | Not found |
| Notion | Buttons, database automations: fixed actions | Their service | A webhook (HTTP POST) only | None (no code) | Buttons on free plans |
| Airtable | "Run a script" (background), Scripting extension (foreground) | Their service | `fetch` to any host | Secrets, redacted from logs; the script reads them | 120 s, 512 MB, 50 fetches |
| Excel | Office Scripts (TypeScript); LAMBDA (pure) | The Excel app | `fetch` from the app only | None stored: keys end up in the script | Admin can block |
| Google Sheets | Custom functions (Apps Script) | Their service | URL Fetch | The owner's, implicitly | 30 s, writes only its own cells |
| Beaker Browser (archived 2022) | — | Peers held files, ran nothing | — | — | — |
| ICP canisters | Canisters | A consensus network | Yes | Paid in tokens | — |

How that compares with this proposal:

| | Here | Nearest elsewhere |
| --- | --- | --- |
| Runs on | A device you own | All run on the vendor's service, or in the app (Office Scripts) |
| Outside access | Declared hosts | Coda declares domains; Airtable and Office allow any |
| Credentials | Never seen by the action | Coda, probably; Airtable's scripts see theirs |
| Who allows it | Each device grants it | A creator or admin role |
| Failure | Normal; the last kept value, marked stale | Sheets: `#ERROR!` |
| A record of the run | Signed, checkable | None |

Worth borrowing: Coda's one flag between a formula and an action;
Airtable's published limits as a starting budget; Sheets giving a
trigger on open fewer rights than one from a tap; and Office Scripts'
lesson that without a credential store, people paste keys into code.

Up: [Workspace actions](./README.md) · [All docs](../README.md)

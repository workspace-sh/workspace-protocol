# Rules for anyone changing this repository, people and agents alike

This repository is public.

1. Never commit a secret: API tokens, account ids, private keys, seeds, or a
   `workspace://` link with `#invite=` (an invite is a bearer secret). Put
   local values in `.dev.vars` or the environment.
2. Never commit personal information: names, email addresses, phone numbers,
   home-directory paths, or links to chat or agent sessions. Examples use
   example.com and placeholder names.
3. `.gitleaks.toml` holds the rules for both. `scripts/hooks/pre-commit` runs
   them on staged changes (`npm install` turns the hook on; it needs gitleaks
   installed), and the `secret scan` workflow runs them on every push and pull
   request. A finding is fixed by removing the value, not by allowlisting it,
   unless it is a false positive.

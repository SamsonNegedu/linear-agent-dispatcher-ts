# AGENTS.md

Linear webhook → relay → dispatcher → Claude CLI → Linear. Local-only, SQLite state. Commands: `package.json`; setup: `README.md`.

- Writing or reviewing code: read `CODING_STANDARDS.md`.
- Changing routing, OAuth, delivery, subscriber identity or run reliability: read the matching ADR in `docs/adr/` first.
- Running tests: `.agents/rules/running-tests.md`.
- Env vars or startup trouble: `services/dispatcher-service/GETTING_STARTED.md`.
- Runs are headless: a question for the user stops the run and posts to the issue.

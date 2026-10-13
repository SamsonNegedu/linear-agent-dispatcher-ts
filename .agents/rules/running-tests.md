# Running tests

Keep test runs to one Node process at a time; each Jest worker is a full Node process, and several at once exhaust RAM.

- Scope: run the package you changed (`pnpm --filter <pkg> test`), a single file at a time while iterating, and the full `pnpm test` once at the end.
- Jest (dispatcher-service, relay-service): add `--runInBand`.
- Sequential only: run suites one after another; `pnpm -r` without `--parallel` is fine, background runs and `--parallel` are not.
- Watch mode and dev servers stay off while tests run.
- Before starting a run, check for leftovers with `pgrep -fl "jest|node --test|bun test"` and stop them.

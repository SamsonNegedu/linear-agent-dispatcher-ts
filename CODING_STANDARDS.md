# Coding standards

## Style
- Types: no `any`; no `I` prefix (`FooBar`, even though older dispatcher-service code differs).
- Names: PascalCase classes, camelCase values, kebab-case files.
- NestJS: one module per feature, constructor injection.
- Comments: match surrounding density.
- Errors: surface, never swallow.
- Secrets: `.env.local` mode `0600`, never committed.

## Testing
- Tests are `*.spec.ts` in a `tests/` folder next to the code they cover (`src/foo/tests/foo.spec.ts`).
- Cover new behaviour through the public interface.
- Jest for dispatcher and relay; Bun runner for monitor-tui.
- Fix failing tests; deleting or skipping is off the table.

## Finish
- `pnpm format`, `pnpm lint`, `pnpm test` green.

## Git
- Conventional commits; branch off `main`; diff touches only the task.

## Repo guards
- Keep `README.md` short.
- `dist/` is generated; edit sources.

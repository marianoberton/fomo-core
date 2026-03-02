Scaffold a new backend tool for Nexus Core, following the project's exact pattern end-to-end.

The tool ID is provided as the argument to this skill. If no argument was given, ask for the tool ID before proceeding.

## Steps

1. **Generate boilerplate** using `scaffoldTool()` from `src/tools/scaffold.ts` (read that file first to understand the API)

2. **Create the implementation file** at `src/tools/definitions/<id>.ts`:
   - Zod schema for input (all fields documented)
   - Zod schema for output
   - Set `riskLevel`: `low` / `medium` / `high` / `critical`
   - Set `requiresApproval: true` if riskLevel is `high` or `critical`
   - Implement `execute()` — real logic with side effects
   - Implement `dryRun()` — validates input, returns expected output shape without side effects

3. **Register the tool** — add the registration line to `src/tools/definitions/index.ts`

4. **Create the test file** at `src/tools/definitions/<id>.test.ts` with all 3 required levels:
   - **Schema test** — Zod rejects invalid/malformed inputs the LLM might generate
   - **Dry run test** — `tool.dryRun()` returns expected shape without calling external services
   - **Integration test** (marked `it.skip` if no test env) — `tool.execute()` against real service

## Coding standards to follow

- No `any` types — use `unknown` + type guards
- Factory function pattern: `createMyTool(options: MyToolOptions): ExecutableTool`
- Dependencies injected via options object, not imported directly
- JSDoc on the exported factory function
- Named exports only
- Use `NexusError` for error types
- Use `Result<T, E>` for operations that can fail expectedly

After scaffolding, confirm the tool appears in `src/tools/definitions/index.ts` and run `pnpm typecheck` to verify zero errors.

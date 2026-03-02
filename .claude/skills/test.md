Run the test suite for fomo-core, then typecheck.

**Step 1 — Tests**

If a file pattern or test name was provided, run:
```
npx vitest run <pattern>
```

Otherwise run all src tests:
```
npx vitest run src
```

**Step 2 — TypeScript**

After tests complete (pass or fail), run:
```
pnpm typecheck
```

**Output format**

Report:
- Total tests: X passed, Y failed
- For each failing test: file path, test name, error message (no stack trace noise)
- TypeScript errors grouped by file: `file:line — error message`
- A single ✅ or ❌ status line at the end

If everything passes: ✅ All tests pass, no TypeScript errors.

If the user provided a pattern as an argument to this skill, use it. Otherwise run the full suite.

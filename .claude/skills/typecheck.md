Run TypeScript type checking for fomo-core:

```
pnpm typecheck
```

Format the output compactly:
- Group errors by file
- Each error: `src/path/to/file.ts:line — TS error message`
- No noise, no stack traces, no repeated file headers
- Count at the end: `N TypeScript errors across M files`

If no errors: `✅ No TypeScript errors`

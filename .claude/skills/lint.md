Run linting and formatting for fomo-core:

```
pnpm lint
pnpm format:fix
```

If `pnpm lint` reports errors, attempt auto-fix:
```
pnpm lint:fix
```

Report remaining errors (those that can't be auto-fixed) in format:
`src/path/to/file.ts:line — rule-name: error description`

If everything is clean: `✅ No lint or formatting errors`

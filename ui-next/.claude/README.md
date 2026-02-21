# .claude/ — Agent & Skill Reference

## Error Boundary Enforcement

Boundaries guard **async failure points we can't control** — API calls, network errors, auth failures. Pure UI components are never wrapped; if they crash, that's a bug to fix. See [Bulletproof React: Error Handling](https://github.com/alan2207/bulletproof-react/blob/master/docs/error-handling.md) for the philosophy.

### The pattern

```tsx
// Chrome (toolbars, filters) — compact mode
<InlineErrorBoundary title="Toolbar error" compact>
  <Toolbar />
</InlineErrorBoundary>

// Content (tables, cards) — with retry
<InlineErrorBoundary
  title="Unable to display workflows"
  resetKeys={[workflows.length]}
  onReset={refetch}
>
  <WorkflowsDataTable />
</InlineErrorBoundary>
```

One boundary per independent concern. Never wrap unrelated sections together.

### Audit + enforce

**Audit only** (read-only report):
```
/audit-error-boundaries
```

**Fix loop** (runs until zero violations):
```
Run the error-boundary-enforcer agent. When it exits with STATUS: CONTINUE,
re-invoke it immediately (do NOT resume — always start fresh). Keep re-invoking
until STATUS: DONE. Do not read any code files yourself — delegate everything
to the agent. When done, show me the final iteration summary.
```

Each invocation is a fresh context. Memory in `.claude/memory/error-boundaries-*.md` carries state between runs — discovery cache, open violations queue, known-good files, and skipped items needing human review.

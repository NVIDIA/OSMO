# .claude/ — Agent & Skill Reference

## Multi-Domain Audit Pipeline

Runs all enforcement domains sequentially, one iteration per invocation.

```
/audit-and-fix
```

Each call: launches the orchestrator → finds active domain → runs its enforcer → updates state → reports progress.
Call repeatedly until all 6 domains show DONE. Final invocation runs the full test suite.

**Pipeline domains (in order):**
1. `error-boundaries` — DONE (21/21, 100%)
2. `react-best-practices` — hook patterns, memoization, waterfall prevention
3. `nextjs-patterns` — RSC boundaries, async params, hydration safety
4. `composition-patterns` — boolean prop proliferation, compound components
5. `tailwind-standards` — Tailwind v4, data-attributes, CSS variables
6. `design-guidelines` — ARIA, semantic HTML, keyboard navigation

**State file:** `.claude/memory/audit-and-fix-pipeline-state.md`

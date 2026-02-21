# React Best Practices — Skipped Items

## Items Requiring Human Review

None in iteration 1. All patterns were either clean or intentional (see known-good).

## Intentional Patterns (Not Violations)

src/components/chrome/app-sidebar.tsx — useEffect to set activePath from pathname
  REASON: PPR (Partial Prerendering) compatibility. Comment says "PPR: Defer pathname reading
  to client effect". During prerender, activePath=null prevents active highlights. After
  hydration, effect fires and correct item highlights. This is intentional SSR safety.

src/app/(dashboard)/workflows/[name]/hooks/use-workflow-detail.ts — refetchIntervalFn not wrapped in useCallback
  REASON: Comment explicitly says "MUST NOT be wrapped in useCallback - TanStack Query needs
  a fresh function each render to access current query.state.data for terminal detection."
  This is a deliberate trade-off for correct behavior.

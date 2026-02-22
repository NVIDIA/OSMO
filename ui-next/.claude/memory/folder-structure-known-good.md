# Folder Structure -- Known Good Files

Files audited and confirmed correctly placed.

## src/hooks/ (all remaining hooks confirmed shared)
- src/hooks/use-virtualizer-compat.ts
- src/hooks/use-mounted.ts
- src/hooks/use-view-transition.ts
- src/hooks/use-tick.ts
- src/hooks/use-copy.ts
- src/hooks/use-url-state.ts
- src/hooks/use-announcer.ts
- src/hooks/use-results-count.ts
- src/hooks/use-server-mutation.ts
- src/hooks/use-expandable-chips.ts
- src/hooks/use-panel-lifecycle.ts
- src/hooks/use-panel-width.ts
- src/hooks/use-auto-refresh-settings.ts
- src/hooks/use-intersection-observer.ts
- src/hooks/use-hydrated-store.ts
- src/hooks/use-url-chips.ts
- src/hooks/use-default-filter.ts

## src/stores/ (all remaining stores confirmed shared)
- src/stores/create-table-store.ts
- src/stores/shared-preferences-store.ts
- src/stores/types.ts

## Leaf clusters (correct structure, no violations)
- src/actions/ (mock server actions, correct Next.js pattern)
- src/app/api/ (route handlers, correct Next.js pattern)
- src/app/(dashboard)/ root files (correct page layout pattern)
- src/app/(dashboard)/experimental/ (minimal feature, correct)
- src/app/(dashboard)/log-viewer/ (feature module, correct)
- src/app/(dashboard)/profile/ (feature module, correct)

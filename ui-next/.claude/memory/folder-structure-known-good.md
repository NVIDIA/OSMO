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

## src/contexts/ (confirmed shared)
- src/contexts/config-context.tsx
- src/contexts/runtime-env-context.tsx
- src/contexts/service-context.tsx

## src/lib/ root (confirmed shared)
- src/lib/utils.ts (149 importers)
- src/lib/config.ts (24 importers)
- src/lib/format-date.ts (15 importers)
- src/lib/query-client.ts (10 importers)
- src/lib/url-utils.ts (5 importers)
- src/lib/filter-utils.ts (2 importers across 2 features)
- src/lib/logger.ts (generic logging utility)
- src/lib/css-utils.ts (generic CSS utility)
- src/lib/format-interval.ts (generic formatting utility)

## src/lib/ sub-modules (confirmed shared)
- src/lib/hotkeys/ (global hotkey definitions, imported by shadcn + chrome)
- src/lib/navigation/ (navigation config + hook, imported by chrome)
- src/lib/dev/ (dev utilities, imported by dev-auth-init + mock-provider)
- src/lib/config/ (oauth-config, imported by api/auth/refresh)
- src/lib/auth/ (auth module, high cohesion, multi-feature importers)
- src/lib/api/ (shared API infrastructure layer)

## src/components/ shared components (confirmed shared, 2+ feature consumers)
- src/components/data-table/ (all feature modules)
- src/components/panel/ (all feature modules, dag, workflow-detail)
- src/components/filter-bar/ (all feature modules)
- src/components/chrome/ (app-wide chrome)
- src/components/error/ (all feature modules)
- src/components/refresh/ (data-table, workflow-detail, pools, resources, workflows)
- src/components/shadcn/ (external library, all modules)
- src/components/log-viewer/ (log-viewer-page + workflow-detail)

## src/components/ generic abstractions (single consumer but designed for reuse)
- src/components/code-viewer/ (currently workflow-detail only, generic abstraction)
- src/components/dag/ (currently workflow-detail only, generic abstraction)
- src/components/event-viewer/ (currently workflow-detail only, generic abstraction)
- src/components/shell/ (currently workflow-detail only, generic abstraction)

## Leaf clusters (correct structure, no violations)
- src/actions/ (mock server actions, correct Next.js pattern)
- src/app/api/ (route handlers, correct Next.js pattern)
- src/app/(dashboard)/ root files (correct page layout pattern)
- src/app/(dashboard)/experimental/ (minimal feature, correct)
- src/app/(dashboard)/log-viewer/ (feature module, correct)
- src/app/(dashboard)/profile/ (feature module, correct)

## Feature modules (correct colocation)
- src/app/(dashboard)/datasets/ (feature-specific code colocated)
- src/app/(dashboard)/pools/ (feature-specific code colocated)
- src/app/(dashboard)/resources/ (feature-specific code colocated)
- src/app/(dashboard)/workflows/ (feature-specific code colocated)
- src/app/(dashboard)/workflows/[name]/ (feature-specific code colocated)

## src/mocks/ (dev infrastructure, correct)
- Self-contained MSW mock infrastructure

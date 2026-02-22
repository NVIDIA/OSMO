# Folder Structure Enforcer -- Last Audit

Last Run: 2026-02-21
Iteration: 1

## Cluster Progress
Completed Clusters: [actions, api-routes, dashboard, experimental, log-viewer-page, profile, hooks, stores, refresh, components-root]
Pending Clusters (topo order): [contexts, lib, lib-other, lib-auth, lib-api-other, lib-api-adapter, shadcn, filter-bar, error, data-table, panel, code-viewer, dag, chrome, event-viewer, log-viewer, shell, mocks, datasets, pools, resources, workflows, workflow-detail]
Current Working Cluster: contexts
Current Cluster Status: DONE
Discovered files this cycle: ~40 (across multiple clusters)

## Fixes Applied This Iteration

1. MOVE src/hooks/use-active-section.ts -> src/app/(dashboard)/profile/components/use-active-section.ts
   Reason: Only imported by profile feature (1 importer). Colocated with its sole consumer.

2. MOVE src/hooks/use-refresh-animation.ts -> src/components/refresh/use-refresh-animation.ts
   Reason: Only imported by use-refresh-control-state (1 importer, part of refresh component). Colocated with refresh.

3. MOVE src/hooks/use-refresh-control-state.ts -> src/components/refresh/use-refresh-control-state.ts
   Reason: Only imported by refresh-control.tsx and vertical-refresh-control.tsx (both in src/components/refresh/). Colocated with refresh.

4. MOVE src/stores/workflow-detail-panel-store.ts -> src/app/(dashboard)/workflows/[name]/stores/workflow-detail-panel-store.ts
   Reason: Only imported by workflow-detail feature (2 importers). Was also a cross-cluster violation (store importing from feature module). Now colocated, eliminating both violations.

## Known Remaining Violations (for future iterations)

1. src/components/event-viewer/ imports from src/app/(dashboard)/workflows/[name]/lib/ (event-search-fields, event-filtering)
   Fix: Move event-search-fields and event-filtering to src/components/event-viewer/ or src/lib/

2. src/lib/api/adapter/datasets-shim.ts imports from src/app/(dashboard)/datasets/lib/date-filter-utils.ts
   Fix: Move date-filter-utils to src/lib/ or src/lib/api/adapter/

3. src/lib/api/adapter/resources-shim.ts imports from src/app/(dashboard)/resources/lib/compute-aggregates.ts
   Fix: Move compute-aggregates to src/lib/ or src/lib/api/adapter/

## Hooks Audit Summary (all in src/hooks/)

KEEP (shared, 2+ unrelated callers):
- use-virtualizer-compat.ts
- use-mounted.ts
- use-view-transition.ts
- use-tick.ts
- use-copy.ts
- use-url-state.ts
- use-announcer.ts
- use-results-count.ts (8 importers across 4 features)
- use-server-mutation.ts
- use-expandable-chips.ts
- use-panel-lifecycle.ts (3 unrelated features)
- use-panel-width.ts (3 unrelated features)
- use-auto-refresh-settings.ts (3 unrelated features)
- use-intersection-observer.ts
- use-hydrated-store.ts
- use-url-chips.ts
- use-default-filter.ts (3 unrelated features)

MOVED (single-owner):
- use-active-section.ts -> profile/components/
- use-refresh-animation.ts -> components/refresh/
- use-refresh-control-state.ts -> components/refresh/

## Stores Audit Summary (all in src/stores/)

KEEP (shared):
- create-table-store.ts (5 feature callers)
- shared-preferences-store.ts (17+ importers)
- types.ts (31 importers)

MOVED (single-owner):
- workflow-detail-panel-store.ts -> workflows/[name]/stores/

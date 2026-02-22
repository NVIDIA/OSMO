# Folder Structure Enforcer -- Last Audit

Last Run: 2026-02-21
Iteration: 3

## Cluster Progress
Completed Clusters: [actions, api-routes, dashboard, experimental, log-viewer-page, profile, hooks, stores, refresh, components-root, contexts, lib, lib-other, lib-auth, lib-api-other, lib-api-adapter, shadcn, filter-bar, error, data-table, panel, code-viewer, dag, chrome, event-viewer, log-viewer, shell, mocks, datasets, pools, resources, workflows, workflow-detail]
Pending Clusters (topo order): []
Current Working Cluster: none
Current Cluster Status: DONE
Discovered files this cycle: Audited all remaining 21 pending clusters

## Fixes Applied This Iteration

None. All remaining clusters are correctly structured:

### lib-other (8 files)
- src/lib/hotkeys/global.ts (imported by shadcn/sidebar) -- shared hotkey definitions, correctly in lib
- src/lib/hotkeys/types.ts (internal only) -- colocated types, correct
- src/lib/navigation/config.ts (imported by chrome + navigation hook) -- shared navigation config, correct
- src/lib/navigation/config.test.ts -- test file, colocated with subject
- src/lib/navigation/use-navigation.ts (imported by chrome) -- part of navigation subsystem, keep shared
- src/lib/dev/auth-transfer-helper.ts (imported by dev-auth-init) -- dev utility, correct
- src/lib/dev/service-worker-manager.ts (imported by mock-provider) -- dev utility, correct
- src/lib/config/oauth-config.ts (imported by api/auth/refresh) -- shared config, correct

### lib-auth (8 files)
All files have multiple cross-feature importers. Well-cohesive auth module, correctly placed.

### lib-api-other, lib-api-adapter (40+ files)
Shared API infrastructure layer. All correctly placed. Known cross-cluster violations (adapter importing from features) deferred to layer-compliance domain.

### shadcn (23 files)
External library components. Intentionally left in place.

### filter-bar, error, data-table, panel, chrome, refresh (varied sizes)
All are shared components with 2+ feature consumers. Internal files are correctly colocated within their component directory.

### code-viewer, dag, event-viewer, shell
Currently only consumed by workflow-detail feature. However, these are generic UI abstractions (same category as DataTable, Panel) designed for reuse. Moving them into workflow-detail would scatter well-established component boundaries into an already-large feature (70+ files). Per standards: "When in doubt, leave in the global directory."

### log-viewer
Consumed by both log-viewer-page and workflow-detail (2 features). Correctly shared.

### mocks
Self-contained dev infrastructure module. Correctly structured.

### Feature modules (datasets, pools, resources, workflows, workflow-detail)
Feature-specific code colocated with features. No files that should be elevated to shared.

## Fixes Applied in Previous Iterations

1. MOVE src/hooks/use-active-section.ts -> src/app/(dashboard)/profile/components/use-active-section.ts
   Reason: Only imported by profile feature (1 importer). Colocated with its sole consumer.

2. MOVE src/hooks/use-refresh-animation.ts -> src/components/refresh/use-refresh-animation.ts
   Reason: Only imported by use-refresh-control-state (1 importer, part of refresh component). Colocated with refresh.

3. MOVE src/hooks/use-refresh-control-state.ts -> src/components/refresh/use-refresh-control-state.ts
   Reason: Only imported by refresh-control.tsx and vertical-refresh-control.tsx (both in src/components/refresh/). Colocated with refresh.

4. MOVE src/stores/workflow-detail-panel-store.ts -> src/app/(dashboard)/workflows/[name]/stores/workflow-detail-panel-store.ts
   Reason: Only imported by workflow-detail feature (2 importers). Was also a cross-cluster violation (store importing from feature module). Now colocated, eliminating both violations.

## Known Observations (not violations)

1. src/components/code-viewer/, dag/, event-viewer/, shell/ are only consumed by workflow-detail.
   These are generic abstractions designed for reuse -- kept shared per "True generic abstractions" exception.

2. Cross-cluster violations (deferred to layer-compliance domain):
   - event-viewer -> workflow-detail/lib (event-search-fields, event-filtering)
   - datasets-shim -> datasets/lib (date-filter-utils)
   - resources-shim -> resources/lib (compute-aggregates)

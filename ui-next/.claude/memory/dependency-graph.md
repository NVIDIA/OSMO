# Dependency Graph -- ui-next

Last Built: 2026-02-21
Last Updated: 2026-02-21
Status: BUILT

Source Files: 491
Total Nodes: 491
Total Edges: ~1630

---

## Graph Stats

```
Isolated nodes   (in_degree=0, not entry point): 27
Single-importer  (in_degree=1):                  208
Bridge nodes     (cross-cluster connectors):      15
Cross-cluster violations:                         6
High fan-in nodes (in_degree>=8):                 45
```

---

## Clusters

> One entry per logical module. Cohesion = internal_edges / (internal + external).

### actions
Directory: src/actions
Files:
  - src/actions/mock-config.ts
  - src/actions/mock-config.types.ts
Internal edges: 1
External edges: 1
Cohesion: 50% -> MEDIUM
Imports from clusters: [mocks]
Imported by clusters: []
Notes: mock-config.ts is dead code (in_degree=0). Only used via server actions for dev mode.

### datasets
Directory: src/app/(dashboard)/datasets
Files:
  - src/app/(dashboard)/datasets/datasets-page-content.tsx
  - src/app/(dashboard)/datasets/datasets-page-skeleton.tsx
  - src/app/(dashboard)/datasets/datasets-with-data.tsx
  - src/app/(dashboard)/datasets/[bucket]/[name]/** (14 files)
  - src/app/(dashboard)/datasets/components/** (6 files)
  - src/app/(dashboard)/datasets/hooks/** (3 files)
  - src/app/(dashboard)/datasets/lib/** (4 files)
  - src/app/(dashboard)/datasets/stores/** (1 file)
Internal edges: ~30
External edges: ~55
Cohesion: 35% -> LOW
Imports from clusters: [components, lib, hooks, stores, shadcn]
Imported by clusters: [lib (datasets-shim)]
Notes: Low cohesion expected for a feature module -- heavy dependency on shared components.

### experimental
Directory: src/app/(dashboard)/experimental
Files:
  - src/app/(dashboard)/experimental/experimental-client.tsx
Internal edges: 1
External edges: 2
Cohesion: 33% -> LOW
Imports from clusters: [components]
Imported by clusters: []
Notes: Minimal feature module.

### log-viewer-page
Directory: src/app/(dashboard)/log-viewer
Files:
  - src/app/(dashboard)/log-viewer/components/** (3 files)
  - src/app/(dashboard)/log-viewer/lib/recent-workflows.ts
Internal edges: 4
External edges: 8
Cohesion: 33% -> LOW
Imports from clusters: [components, lib]
Imported by clusters: []
Notes: Thin page wrapper; most logic lives in src/components/log-viewer/.

### pools
Directory: src/app/(dashboard)/pools
Files:
  - src/app/(dashboard)/pools/pools-page-content.tsx
  - src/app/(dashboard)/pools/pools-page-skeleton.tsx
  - src/app/(dashboard)/pools/pools-with-data.tsx
  - src/app/(dashboard)/pools/components/** (12 files)
  - src/app/(dashboard)/pools/hooks/** (3 files)
  - src/app/(dashboard)/pools/lib/** (4 files)
  - src/app/(dashboard)/pools/stores/** (1 file)
Internal edges: ~25
External edges: ~55
Cohesion: 31% -> LOW
Imports from clusters: [components, lib, hooks, stores, shadcn]
Imported by clusters: [workflows (PoolStatusBadge, PlatformPills)]
Notes: Reference feature module. pools/lib/constants is imported by workflow-detail resubmit.

### profile
Directory: src/app/(dashboard)/profile
Files:
  - src/app/(dashboard)/profile/components/** (13 files)
Internal edges: ~12
External edges: ~30
Cohesion: 29% -> LOW
Imports from clusters: [components, lib, hooks, contexts, shadcn]
Imported by clusters: []
Notes: Settings page with multiple independent sections.

### resources
Directory: src/app/(dashboard)/resources
Files:
  - src/app/(dashboard)/resources/resources-page-content.tsx
  - src/app/(dashboard)/resources/resources-page-skeleton.tsx
  - src/app/(dashboard)/resources/resources-with-data.tsx
  - src/app/(dashboard)/resources/components/** (7 files)
  - src/app/(dashboard)/resources/hooks/** (1 file)
  - src/app/(dashboard)/resources/lib/** (5 files)
  - src/app/(dashboard)/resources/stores/** (1 file)
Internal edges: ~20
External edges: ~55
Cohesion: 27% -> LOW
Imports from clusters: [components, lib, hooks, stores, shadcn]
Imported by clusters: [lib (resources-shim -> computeAggregates -- VIOLATION)]

### workflows
Directory: src/app/(dashboard)/workflows
Files:
  - src/app/(dashboard)/workflows/workflows-page-content.tsx
  - src/app/(dashboard)/workflows/workflows-page-skeleton.tsx
  - src/app/(dashboard)/workflows/workflows-with-data.tsx
  - src/app/(dashboard)/workflows/actions.ts
  - src/app/(dashboard)/workflows/components/** (4 files)
  - src/app/(dashboard)/workflows/hooks/** (3 files)
  - src/app/(dashboard)/workflows/lib/** (3 files)
  - src/app/(dashboard)/workflows/stores/** (1 file)
Internal edges: ~18
External edges: ~35
Cohesion: 34% -> LOW
Imports from clusters: [components, lib, hooks, stores, shadcn]
Imported by clusters: [dashboard, workflow-detail]

### workflow-detail
Directory: src/app/(dashboard)/workflows/[name]
Files:
  - src/app/(dashboard)/workflows/[name]/workflow-detail-*.tsx (4 files)
  - src/app/(dashboard)/workflows/[name]/components/** (~45 files)
  - src/app/(dashboard)/workflows/[name]/hooks/** (6 files)
  - src/app/(dashboard)/workflows/[name]/lib/** (15 files)
  - src/app/(dashboard)/workflows/[name]/stores/** (1 file)
Internal edges: ~120
External edges: ~100
Cohesion: 55% -> MEDIUM
Imports from clusters: [components, lib, hooks, stores, shadcn, pools, workflows]
Imported by clusters: [components (event-viewer), stores (workflow-detail-panel), lib (status-metadata)]
Notes: Largest cluster. workflow-types has 39 importers (high fan-in). Several cross-feature imports to pools.

### dashboard
Directory: src/app/(dashboard) (root-level files only)
Files:
  - src/app/(dashboard)/dashboard-content.tsx
  - src/app/(dashboard)/dashboard-skeleton.tsx
  - src/app/(dashboard)/dashboard-with-data.tsx
Internal edges: 2
External edges: 10
Cohesion: 17% -> LOW
Imports from clusters: [components, lib, workflows]
Imported by clusters: []

### api-routes
Directory: src/app/api
Files:
  - src/app/api/[...path]/** (3 files)
  - src/app/api/auth/refresh/route.ts
  - src/app/api/datasets/** (2 files)
  - src/app/api/health/route.ts
  - src/app/api/me/route.ts
Internal edges: 2
External edges: 6
Cohesion: 25% -> LOW
Imports from clusters: [lib]
Imported by clusters: []
Notes: Server-only route handlers.

### chrome
Directory: src/components/chrome
Files:
  - src/components/chrome/app-sidebar.tsx
  - src/components/chrome/breadcrumb-origin-context.tsx
  - src/components/chrome/chrome.tsx
  - src/components/chrome/constants.ts
  - src/components/chrome/header.tsx
  - src/components/chrome/nvidia-logo.tsx
  - src/components/chrome/page-context.tsx
Internal edges: 6
External edges: 18
Cohesion: 25% -> LOW
Imports from clusters: [components, lib, hooks, contexts, shadcn, stores]
Imported by clusters: [all feature modules via page-context, breadcrumb-origin-context]
Notes: page-context (13 importers) and breadcrumb-origin-context are key bridge nodes.

### code-viewer
Directory: src/components/code-viewer
Files:
  - src/components/code-viewer/CodeMirror.tsx
  - src/components/code-viewer/CodeViewerSkeleton.tsx
  - src/components/code-viewer/lib/** (3 files)
  - src/components/code-viewer/types.ts
Internal edges: 5
External edges: 4
Cohesion: 56% -> MEDIUM
Imports from clusters: [components, hooks]
Imported by clusters: [workflow-detail]

### dag
Directory: src/components/dag
Files:
  - src/components/dag/components/** (2 files)
  - src/components/dag/constants.ts
  - src/components/dag/hooks/use-viewport-boundaries.ts
  - src/components/dag/layout/layout.ts
  - src/components/dag/types.ts
Internal edges: 7
External edges: 4
Cohesion: 64% -> MEDIUM
Imports from clusters: [components, lib]
Imported by clusters: [workflow-detail]

### data-table
Directory: src/components/data-table
Files:
  - src/components/data-table/DataTable.tsx
  - src/components/data-table/DisplayModeToggle.tsx
  - src/components/data-table/ResizeHandle.tsx
  - src/components/data-table/SortableCell.tsx
  - src/components/data-table/SortButton.tsx
  - src/components/data-table/TableEmptyState.tsx
  - src/components/data-table/TableSkeleton.tsx
  - src/components/data-table/TableStates.tsx
  - src/components/data-table/TableToolbar.tsx
  - src/components/data-table/VirtualTableBody.tsx
  - src/components/data-table/constants.ts
  - src/components/data-table/create-column-config.ts
  - src/components/data-table/create-toolbar-hooks.ts
  - src/components/data-table/hotkeys.ts
  - src/components/data-table/hooks/** (5 files)
  - src/components/data-table/types.ts
  - src/components/data-table/utils/** (2 files)
Internal edges: ~30
External edges: ~20
Cohesion: 60% -> MEDIUM
Imports from clusters: [lib, hooks, stores, shadcn]
Imported by clusters: [all feature modules, chrome]
Notes: create-toolbar-hooks.ts and hotkeys.ts are dead code (in_degree=0).

### error
Directory: src/components/error
Files:
  - src/components/error/api-error.tsx
  - src/components/error/error-details.tsx
  - src/components/error/inline-error-boundary.tsx
  - src/components/error/route-error.tsx
Internal edges: 3
External edges: 7
Cohesion: 30% -> LOW
Imports from clusters: [components, lib, hooks, shadcn]
Imported by clusters: [all feature modules]

### event-viewer
Directory: src/components/event-viewer
Files:
  - src/components/event-viewer/EventDetailsPanel.tsx
  - src/components/event-viewer/EventViewerContainer.tsx
  - src/components/event-viewer/EventViewerContext.tsx
  - src/components/event-viewer/EventViewerTable.tsx
  - src/components/event-viewer/LifecycleProgressBar.tsx
  - src/components/event-viewer/TaskRow.tsx
Internal edges: 5
External edges: 12
Cohesion: 29% -> LOW
Imports from clusters: [lib, hooks, components, workflow-detail (VIOLATION)]
Imported by clusters: [workflow-detail]
Notes: VIOLATION -- imports from src/app/(dashboard)/workflows/[name]/lib/ (event-search-fields, event-filtering).

### filter-bar
Directory: src/components/filter-bar
Files:
  - src/components/filter-bar/filter-bar.tsx
  - src/components/filter-bar/FilterBarChip.tsx
  - src/components/filter-bar/FilterBarDropdown.tsx
  - src/components/filter-bar/FilterBarInput.tsx
  - src/components/filter-bar/hooks/** (4 files)
  - src/components/filter-bar/lib/** (3 files)
Internal edges: 15
External edges: 8
Cohesion: 65% -> MEDIUM
Imports from clusters: [components, lib, hooks, shadcn]
Imported by clusters: [all feature modules via types, data-table, log-viewer, event-viewer]
Notes: filter-bar/lib/types (39 importers) is a major bridge node.

### log-viewer
Directory: src/components/log-viewer
Files:
  - src/components/log-viewer/components/** (~15 files)
  - src/components/log-viewer/components/timeline/** (~15 files)
  - src/components/log-viewer/hooks/** (1 file)
  - src/components/log-viewer/lib/** (6 files)
  - src/components/log-viewer/store/** (1 file)
Internal edges: ~35
External edges: ~30
Cohesion: 54% -> MEDIUM
Imports from clusters: [lib, hooks, contexts, shadcn, filter-bar]
Imported by clusters: [workflow-detail, log-viewer-page]
Notes: TimelineControls.tsx, TimelineWindow.tsx, and timeline-context.tsx are dead code.

### panel
Directory: src/components/panel
Files:
  - src/components/panel/actions-section.tsx
  - src/components/panel/dependencies-section.tsx
  - src/components/panel/details-section.tsx
  - src/components/panel/empty-tab-prompt.tsx
  - src/components/panel/hotkeys.ts
  - src/components/panel/hooks/** (5 files)
  - src/components/panel/links-section.tsx
  - src/components/panel/panel-animation-context.tsx
  - src/components/panel/panel-header.tsx
  - src/components/panel/panel-header-controls.tsx
  - src/components/panel/panel-tabs.tsx
  - src/components/panel/resizable-panel.tsx
  - src/components/panel/resize-handle.tsx
  - src/components/panel/separated-parts.tsx
  - src/components/panel/side-panel.tsx
  - src/components/panel/tab-panel.tsx
  - src/components/panel/use-resizable-panel.ts
Internal edges: ~14
External edges: ~12
Cohesion: 54% -> MEDIUM
Imports from clusters: [lib, hooks, shadcn]
Imported by clusters: [all feature modules, dag, workflow-detail]
Notes: panel-header-controls (18 importers) is a bridge. hotkeys.ts and use-resizable-panel.ts are dead code.

### refresh
Directory: src/components/refresh
Files:
  - src/components/refresh/RefreshControl.tsx
  - src/components/refresh/types.ts
  - src/components/refresh/VerticalRefreshControl.tsx
Internal edges: 3
External edges: 6
Cohesion: 33% -> LOW
Imports from clusters: [lib, hooks, shadcn]
Imported by clusters: [data-table, workflow-detail, pools, resources, workflows]

### shadcn
Directory: src/components/shadcn
Files: 23 UI primitives
Internal edges: 8
External edges: 5
Cohesion: 62% -> MEDIUM
Imports from clusters: [lib (utils only), lib/hotkeys]
Imported by clusters: [virtually everything]
Notes: Intentionally left in place -- external library components.

### shell
Directory: src/components/shell
Files:
  - src/components/shell/components/** (6 files)
  - src/components/shell/hooks/use-shell.ts
  - src/components/shell/lib/** (5 files)
Internal edges: ~15
External edges: ~10
Cohesion: 60% -> MEDIUM
Imports from clusters: [lib, hooks, shadcn, panel]
Imported by clusters: [workflow-detail]
Notes: ShellTerminalImpl.tsx is dead code. hotkeys.ts is dead code.

### contexts
Directory: src/contexts
Files:
  - src/contexts/config-context.tsx
  - src/contexts/runtime-env-context.tsx
  - src/contexts/service-context.tsx
Internal edges: 0
External edges: 3
Cohesion: 0% -> LOW
Imports from clusters: [lib]
Imported by clusters: [all features, components]
Notes: Pure provider modules, low internal cohesion is expected.

### hooks
Directory: src/hooks
Files: 20 files
Internal edges: 5
External edges: 12
Cohesion: 29% -> LOW
Imports from clusters: [lib, components, stores, contexts]
Imported by clusters: [all features, all components]
Notes: Global hooks directory. use-server-mutation imports from app/(dashboard)/workflows/actions (type only).

### lib
Directory: src/lib
Files:
  - src/lib/utils.ts (151 importers -- highest fan-in)
  - src/lib/config.ts (25 importers)
  - src/lib/format-date.ts (17 importers)
  - src/lib/query-client.ts
  - src/lib/logger.ts
  - src/lib/filter-utils.ts
  - src/lib/format-interval.ts
  - src/lib/url-utils.ts
  - src/lib/css-utils.ts
Internal edges: 3
External edges: 5
Cohesion: 38% -> LOW
Imports from clusters: [stores, lib/api, lib/auth]
Imported by clusters: [everything]
Notes: Utility module. Low cohesion expected -- each file is independent.

### lib-api-adapter
Directory: src/lib/api/adapter
Files:
  - src/lib/api/adapter/datasets.ts (21 importers)
  - src/lib/api/adapter/datasets-hooks.ts
  - src/lib/api/adapter/datasets-shim.ts
  - src/lib/api/adapter/hooks.ts (16 importers)
  - src/lib/api/adapter/pools-shim.ts
  - src/lib/api/adapter/resources-shim.ts
  - src/lib/api/adapter/transforms.ts
  - src/lib/api/adapter/types.ts (51 importers -- 2nd highest fan-in)
  - src/lib/api/adapter/utils.ts
  - src/lib/api/adapter/workflows-shim.ts
  - src/lib/api/adapter/events/** (7 files)
Internal edges: ~20
External edges: ~25
Cohesion: 44% -> MEDIUM
Imports from clusters: [lib, stores, components]
Imported by clusters: [all features]
Notes: adapter/types (51 importers) and adapter/hooks (16 importers) are major bridge nodes.
VIOLATION: datasets-shim imports from app/(dashboard)/datasets/lib/date-filter-utils.
VIOLATION: resources-shim imports from app/(dashboard)/resources/lib/computeAggregates.

### lib-api-other
Directory: src/lib/api (non-adapter)
Files:
  - src/lib/api/fetcher.ts
  - src/lib/api/handle-redirect.ts
  - src/lib/api/headers.ts
  - src/lib/api/chip-filter-utils.ts
  - src/lib/api/stream-retry.ts
  - src/lib/api/status-metadata.generated.ts
  - src/lib/api/generated.ts (37 importers -- auto-generated, excluded from file count)
  - src/lib/api/log-adapter/** (5 files)
  - src/lib/api/pagination/** (2 files)
  - src/lib/api/server/** (7 files)
Internal edges: ~12
External edges: ~15
Cohesion: 44% -> MEDIUM
Imports from clusters: [lib, stores]
Imported by clusters: [adapter, features, components]
Notes: headers.ts is dead code. events-hooks.ts is dead code (re-exports only, nothing imports it).

### lib-auth
Directory: src/lib/auth
Files:
  - src/lib/auth/cookies.ts
  - src/lib/auth/decode-user.ts
  - src/lib/auth/jwt-utils.ts
  - src/lib/auth/jwt-utils.production.ts
  - src/lib/auth/roles.ts
  - src/lib/auth/server.ts
  - src/lib/auth/user-context.tsx
Internal edges: 7
External edges: 3
Cohesion: 70% -> HIGH
Imports from clusters: [lib]
Imported by clusters: [api-routes, components, features]
Notes: Well-cohesive auth module.

### lib-other
Directory: src/lib (hotkeys, navigation, dev, config)
Files:
  - src/lib/hotkeys/global.ts
  - src/lib/hotkeys/types.ts
  - src/lib/navigation/config.ts
  - src/lib/navigation/use-navigation.ts
  - src/lib/dev/auth-transfer-helper.ts
  - src/lib/dev/service-worker-manager.ts
  - src/lib/config/oauth-config.ts
Internal edges: 3
External edges: 4
Cohesion: 43% -> MEDIUM
Imports from clusters: [lib]
Imported by clusters: [chrome, api-routes, shadcn]
Notes: auth-transfer-helper.ts and service-worker-manager.ts are dead code.

### stores
Directory: src/stores
Files:
  - src/stores/create-table-store.ts
  - src/stores/shared-preferences-store.ts
  - src/stores/types.ts (31 importers)
  - src/stores/workflow-detail-panel-store.ts
Internal edges: 2
External edges: 6
Cohesion: 25% -> LOW
Imports from clusters: [hooks, components, workflow-detail (VIOLATION)]
Imported by clusters: [all features]
Notes: VIOLATION: workflow-detail-panel-store imports from app/(dashboard)/workflows/[name]/lib/.

---

## Notable Nodes

### Bridge Nodes -- connect otherwise-separate clusters
> High betweenness: imported by 2+ distinct clusters.

- src/lib/utils.ts  [151 importers across 4 clusters]  -> KEEP shared
  Connects: app -> components -> hooks -> lib
- src/lib/api/adapter/types.ts  [51 importers across 4 clusters]  -> KEEP shared
  Connects: app -> components -> lib -> stores
- src/lib/config.ts  [25 importers across 5 clusters]  -> KEEP shared
  Connects: app -> components -> contexts -> hooks -> lib
- src/stores/types.ts  [31 importers across 5 clusters]  -> KEEP shared
  Connects: app -> components -> hooks -> lib -> stores
- src/components/filter-bar/lib/types.ts  [39 importers across 4 clusters]  -> KEEP shared
  Connects: app -> components -> hooks -> stores
- src/lib/api/generated.ts  [37 importers across 3 clusters]  -> KEEP shared (auto-generated)
  Connects: app -> components -> lib
- src/components/panel/panel-header-controls.tsx  [18 importers across 3 clusters]  -> KEEP shared
  Connects: app -> components -> hooks
- src/components/data-table/types.ts  [20 importers across 4 clusters]  -> KEEP shared
  Connects: app -> components -> lib -> stores
- src/contexts/service-context.tsx  [12 importers across 3 clusters]  -> KEEP shared
  Connects: app -> components -> hooks
- src/lib/auth/user-context.tsx  [8 importers across 3 clusters]  -> KEEP shared
  Connects: app -> components -> lib
- src/components/refresh/types.ts  [8 importers across 3 clusters]  -> KEEP shared
  Connects: app -> components -> hooks
- src/hooks/use-mounted.ts  [9 importers across 3 clusters]  -> KEEP shared
  Connects: app -> components -> hooks
- src/hooks/use-url-chips.ts  [3 importers across 3 clusters]  -> KEEP shared
  Connects: app -> components -> hooks
- src/lib/url-utils.ts  [3 importers across 3 clusters]  -> KEEP shared
  Connects: app -> components -> hooks
- src/lib/api/adapter/hooks.ts  [16 importers across 3 clusters]  -> KEEP shared
  Connects: app -> components -> lib

### High Fan-In -- potential catch-alls (>=8 importers)
> Top 20 only. Review for decomposition if they contain unrelated exports.

- src/lib/utils.ts  [151 importers]
- src/lib/api/adapter/types.ts  [51 importers]
- src/app/(dashboard)/workflows/[name]/lib/workflow-types.ts  [39 importers]
- src/components/filter-bar/lib/types.ts  [39 importers]
- src/lib/api/generated.ts  [37 importers]
- src/components/shadcn/button.tsx  [35 importers]
- src/stores/types.ts  [31 importers]
- src/lib/config.ts  [25 importers]
- src/components/shadcn/skeleton.tsx  [24 importers]
- src/components/shadcn/card.tsx  [23 importers]
- src/lib/api/adapter/datasets.ts  [21 importers]
- src/components/data-table/types.ts  [20 importers]
- src/components/shadcn/tooltip.tsx  [19 importers]
- src/stores/shared-preferences-store.ts  [18 importers]
- src/components/panel/panel-header-controls.tsx  [18 importers]
- src/lib/format-date.ts  [17 importers]
- src/lib/api/adapter/hooks.ts  [16 importers]
- src/lib/api/log-adapter/types.ts  [16 importers]
- src/app/(dashboard)/workflows/[name]/lib/status.tsx  [16 importers]
- src/components/chrome/page-context.tsx  [13 importers]

### Dead Code -- no importers (in_degree=0)
> Not imported anywhere AND not an entry point (page/layout/route/providers).

- src/actions/mock-config.ts  -> REVIEW -- server action, may be invoked via import-less mechanism
- src/app/(dashboard)/datasets/[bucket]/[name]/components/tabs/DatasetVersionsDataTable.tsx  -> REVIEW -- likely lazy-loaded or tab content
- src/app/(dashboard)/datasets/[bucket]/[name]/components/tabs/OverviewTab.tsx  -> REVIEW -- likely lazy-loaded or tab content
- src/app/(dashboard)/pools/components/quota-bar.tsx  -> REVIEW -- may be unused
- src/app/(dashboard)/workflows/[name]/components/WorkflowTableContent.tsx  -> REVIEW -- may be dead after refactor
- src/app/(dashboard)/workflows/[name]/components/WorkflowTableView.tsx  -> REVIEW -- may be dead after refactor
- src/app/(dashboard)/workflows/[name]/components/panel/workflow/spec/WorkflowSpecViewer.tsx  -> REVIEW -- may be lazy-loaded
- src/app/(dashboard)/workflows/[name]/components/resubmit/ResubmitPanel.tsx  -> REVIEW -- may be lazy-loaded
- src/app/(dashboard)/workflows/[name]/components/shell/ShellContainer.tsx  -> REVIEW -- may be portal-rendered
- src/app/(dashboard)/workflows/[name]/components/table/TreeConnector.tsx  -> DELETE -- duplicate of tree/TreeConnector.tsx
- src/app/(dashboard)/workflows/[name]/components/table/tree/TreeGroupCell.tsx  -> REVIEW -- may be unused after refactor
- src/app/(dashboard)/workflows/[name]/hooks/use-panel-resize-coordination.tsx  -> REVIEW -- may be unused
- src/components/data-table/create-toolbar-hooks.ts  -> DELETE -- dead code
- src/components/data-table/hotkeys.ts  -> REVIEW -- may be imported dynamically
- src/components/log-viewer/components/timeline/components/TimelineControls.tsx  -> DELETE -- dead code
- src/components/log-viewer/components/timeline/components/TimelineWindow.tsx  -> DELETE -- dead code
- src/components/log-viewer/components/timeline/lib/timeline-context.tsx  -> DELETE -- dead code
- src/components/panel/hotkeys.ts  -> REVIEW -- may be imported dynamically
- src/components/panel/use-resizable-panel.ts  -> DELETE -- dead code (replaced by resizable-panel.tsx)
- src/components/placeholder-section.tsx  -> DELETE -- dead code
- src/components/shadcn/tabs.tsx  -> REVIEW -- may be used in JSX without direct import path match
- src/components/shell/components/ShellTerminalImpl.tsx  -> REVIEW -- may be dynamically imported
- src/components/shell/lib/hotkeys.ts  -> REVIEW -- may be imported dynamically
- src/lib/api/adapter/events/events-hooks.ts  -> DELETE -- re-export file, nothing imports it
- src/lib/api/headers.ts  -> DELETE -- dead code
- src/lib/dev/auth-transfer-helper.ts  -> DELETE -- dead code
- src/lib/dev/service-worker-manager.ts  -> DELETE -- dead code

---

## Cross-Cluster Violations

> Edges that cross architectural boundaries they should not cross.

- src/components/event-viewer/EventViewerContainer.tsx -> src/app/(dashboard)/workflows/[name]/lib/event-search-fields.tsx
  Violation: component imports from feature module (should be the reverse)

- src/components/event-viewer/EventViewerContainer.tsx -> src/app/(dashboard)/workflows/[name]/lib/event-filtering.ts
  Violation: component imports from feature module (should be the reverse)

- src/lib/api/adapter/datasets-shim.ts -> src/app/(dashboard)/datasets/lib/date-filter-utils.ts
  Violation: adapter (lib layer) imports from feature module (app layer)

- src/lib/api/adapter/resources-shim.ts -> src/app/(dashboard)/resources/lib/computeAggregates.ts
  Violation: adapter (lib layer) imports from feature module (app layer)

- src/stores/workflow-detail-panel-store.ts -> src/app/(dashboard)/workflows/[name]/lib/panel-constants.ts
  Violation: store imports from feature module (app layer)

- src/stores/workflow-detail-panel-store.ts -> src/app/(dashboard)/workflows/[name]/lib/panel-resize-state-machine.ts
  Violation: store imports from feature module (app layer)

---

## Changelog

> Append-only. Every agent that mutates the graph writes one line per operation.

2026-02-21 BUILD  Initial graph -- 491 nodes, ~1630 edges, 27 clusters identified, 6 violations found

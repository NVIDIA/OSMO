# Dead Code Audit -- Last Run
Date: 2026-02-21
Iteration: 18
Deleted this run: 2 dead files

## Cluster Progress
Completed Clusters: [actions, experimental, log-viewer-page, profile, dashboard, api-routes, pools, datasets, resources, workflows, workflow-detail, chrome, code-viewer, dag, data-table, error, event-viewer, filter-bar, log-viewer, panel, refresh, shell, shadcn, contexts, hooks, lib, lib-api-adapter, lib-api-other, lib-auth, lib-other, stores]
Pending Clusters (topo order): []
Current Working Cluster: (all complete)
Current Cluster Status: DONE
Discovered files this cycle: 8 clusters batch-audited (contexts: 3 files, hooks: 20 files, stores: 4 files, lib: 9 root files, lib-api-adapter: 17 files, lib-api-other: ~24 files, lib-auth: 7 files, lib-other: 6 files)

## Deleted This Run
src/lib/api/headers.ts -- file -- 0 importers, dead since initial graph build (Headers.AUTH and Header type never referenced)
src/lib/api/adapter/events/events-hooks.ts -- file -- 0 importers, deprecated re-export file (useEventStream already imported directly from use-event-stream.ts)

## Open Dead Queue
(empty -- all clusters clean)

## Skipped Findings
src/contexts/config-context.tsx -- exports useConfig, ConfigContext, TableConfig, PanelConfig, ViewportConfig, TimingConfig, ConfigProviderProps with 0 external importers; intentional public API surface for context module, not removing
src/lib/dev/auth-transfer-helper.ts -- imported by DevAuthInit.tsx (dev infrastructure), live
src/lib/dev/service-worker-manager.ts -- imported by MockProvider.tsx (dev infrastructure), live

## Verification
pnpm type-check: PASS
pnpm lint: PASS

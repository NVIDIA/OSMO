# Dead Code Audit -- Last Run
Date: 2026-02-21
Iteration: 19
Deleted this run: 1 dead file

## Cluster Progress
Completed Clusters: [actions, experimental, log-viewer-page, profile, dashboard, api-routes, pools, datasets, resources, workflows, workflow-detail, chrome, code-viewer, dag, data-table, error, event-viewer, filter-bar, log-viewer, panel, refresh, shell, shadcn, contexts, hooks, lib, lib-api-adapter, lib-api-other, lib-auth, lib-other, stores, mocks, components-root]
Pending Clusters (topo order): []
Current Working Cluster: (all complete)
Current Cluster Status: DONE
Discovered files this cycle: mocks: 22 files (excl. test), components-root: 14 files

## Deleted This Run
src/components/placeholder-section.tsx -- file -- 0 importers, "coming soon" placeholder component never used by any page

## Open Dead Queue
(empty -- both clusters clean)

## Skipped Findings
src/contexts/config-context.tsx -- exports useConfig, ConfigContext, TableConfig, PanelConfig, ViewportConfig, TimingConfig, ConfigProviderProps with 0 external importers; intentional public API surface for context module, not removing
src/lib/dev/auth-transfer-helper.ts -- imported by dev-auth-init.tsx (dev infrastructure), live
src/lib/dev/service-worker-manager.ts -- imported by mock-provider.tsx (dev infrastructure), live

## Confirmed Live Files (this run)

### mocks cluster
src/mocks/mock-provider.tsx -- entry point (aliased in next.config.ts)
src/mocks/mock-provider.production.tsx -- entry point (aliased in next.config.ts)
src/mocks/server.ts -- entry point (aliased in next.config.ts)
src/mocks/server.production.ts -- entry point (aliased in next.config.ts)
src/mocks/handlers.ts -- entry point (aliased in next.config.ts)
src/mocks/handlers.production.ts -- entry point (aliased in next.config.ts)
src/mocks/global-config.ts -- imported by 6 generators + actions/mock-config.ts
src/mocks/mock-workflows.ts -- imported by handlers.ts, log-generator.ts
src/mocks/utils.ts -- imported by 9 files (handlers + all generators)
src/mocks/inject-auth.ts -- dynamically imported by mock-provider.tsx, dev-auth-init.tsx; referenced in fetcher.ts
src/mocks/generators/pty-simulator.ts -- imported by handlers.ts
src/mocks/generators/bucket-generator.ts -- imported by handlers.ts
src/mocks/generators/pool-generator.ts -- imported by handlers.ts
src/mocks/generators/portforward-generator.ts -- imported by handlers.ts
src/mocks/generators/resource-generator.ts -- imported by handlers.ts
src/mocks/generators/profile-generator.ts -- imported by handlers.ts
src/mocks/generators/log-generator.ts -- imported by handlers.ts
src/mocks/generators/event-generator.ts -- imported by handlers.ts
src/mocks/generators/spec-generator.ts -- imported by handlers.ts
src/mocks/generators/workflow-generator.ts -- imported by handlers.ts
src/mocks/generators/dataset-generator.ts -- imported by handlers.ts
src/mocks/seed/types.ts -- imported by 9 files (generators + global-config)

### components-root cluster
src/components/boolean-indicator.tsx -- imported by 2 files
src/components/capacity-bar.tsx -- imported by 2 files
src/components/copyable-value.tsx -- imported by 4 files
src/components/dev-auth-init.tsx -- imported by providers.tsx
src/components/expandable-chips.tsx -- imported by 2 files
src/components/inline-progress.tsx -- imported by 1 file
src/components/item-selector.tsx -- imported by 1 file
src/components/link.tsx -- imported by 8 files
src/components/not-found-content.tsx -- imported by 2 not-found pages
src/components/progress-bar.tsx -- imported by inline-progress, capacity-bar
src/components/providers.tsx -- entry point (imported by layout.tsx)
src/components/query-devtools.tsx -- imported by providers.tsx
src/components/theme-toggle.tsx -- imported by header.tsx

## Verification
pnpm type-check: PASS
pnpm lint: PASS

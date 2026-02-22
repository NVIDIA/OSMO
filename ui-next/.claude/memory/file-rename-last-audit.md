# File Rename Audit -- Last Run
Date: 2026-02-21
Iteration: 22
Fixed this run: 12 files renamed

## Cluster Progress
Completed Clusters: [actions, api-routes, dashboard, experimental, log-viewer-page, profile, pools, resources, workflows, workflow-detail, chrome, code-viewer, dag, data-table, error, event-viewer, filter-bar, log-viewer, panel, refresh, shell, contexts, hooks, lib, lib-api-adapter, lib-api-other, lib-auth, lib-other, stores, datasets, mocks, components-misc]
Pending Clusters (topo order): []
Current Working Cluster: datasets + components-misc + mocks (batch rename by user request)
Current Cluster Status: DONE

## Open Violations Queue (current cluster)
(none)

## Fixed This Run
- src/components/DevAuthInit.tsx -> src/components/dev-auth-init.tsx (1 importer updated: providers.tsx)
- src/components/QueryDevtools.tsx -> src/components/query-devtools.tsx (1 importer updated: providers.tsx)
- src/mocks/MockProvider.production.tsx -> src/mocks/mock-provider.production.tsx (0 direct importers; next.config.ts alias updated)
- src/mocks/MockProvider.tsx -> src/mocks/mock-provider.tsx (1 importer updated: providers.tsx; next.config.ts alias updated)
- src/app/(dashboard)/datasets/[bucket]/[name]/components/FileBrowserBreadcrumb.tsx -> file-browser-breadcrumb.tsx (1 importer: FileBrowserHeader.tsx, now file-browser-header.tsx)
- src/app/(dashboard)/datasets/[bucket]/[name]/components/FileBrowserHeader.tsx -> file-browser-header.tsx (1 importer: dataset-detail-content.tsx)
- src/app/(dashboard)/datasets/[bucket]/[name]/components/FilePreviewPanel.tsx -> file-preview-panel.tsx (1 importer: dataset-detail-content.tsx)
- src/app/(dashboard)/datasets/[bucket]/[name]/components/VersionSwitcher.tsx -> version-switcher.tsx (1 importer: FileBrowserHeader.tsx, now file-browser-header.tsx)
- src/app/(dashboard)/datasets/[bucket]/[name]/components/FileBrowserTable.tsx -> file-browser-table.tsx (1 importer: dataset-detail-content.tsx)
- src/app/(dashboard)/datasets/components/panel/DatasetPanel.tsx -> dataset-panel.tsx (1 importer: datasets-page-content.tsx)
- src/app/(dashboard)/datasets/components/panel/DatasetPanelDetails.tsx -> dataset-panel-details.tsx (1 importer: DatasetPanel.tsx, now dataset-panel.tsx)
- src/app/(dashboard)/datasets/components/panel/DatasetPanelVersions.tsx -> dataset-panel-versions.tsx (1 importer: DatasetPanel.tsx, now dataset-panel.tsx)

## Confirmed Clean Files/Directories
All previously confirmed clusters remain clean. Additionally:
- src/components/dev-auth-init.tsx -- fixed 2026-02-21
- src/components/query-devtools.tsx -- fixed 2026-02-21
- src/mocks/mock-provider.production.tsx -- fixed 2026-02-21
- src/mocks/mock-provider.tsx -- fixed 2026-02-21
- src/app/(dashboard)/datasets/[bucket]/[name]/components/ (5 files, all kebab-case now)
- src/app/(dashboard)/datasets/components/panel/ (3 files, all kebab-case now)

## Verification
pnpm type-check: PASS
pnpm lint: PASS

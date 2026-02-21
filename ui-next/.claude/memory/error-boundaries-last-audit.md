# Error Boundary Audit -- Last Run

Date: 2026-02-21
Score: 21/21 covered (100%)
Critical: 0 | Warnings: 0 | Anti-patterns: 0 | Skipped: 0

## Open Violations

None. All data-fetching components are covered by error boundaries.

## Confirmed Clean Files

### List Pages (exemplar pattern)
- src/app/(dashboard)/pools/pools-page-content.tsx
- src/app/(dashboard)/workflows/workflows-page-content.tsx
- src/app/(dashboard)/resources/resources-page-content.tsx
- src/app/(dashboard)/datasets/datasets-page-content.tsx

### Dashboard
- src/app/(dashboard)/dashboard-content.tsx (FIXED this run)

### Workflow Detail
- src/app/(dashboard)/workflows/[name]/workflow-detail-inner.tsx
- src/app/(dashboard)/workflows/[name]/components/WorkflowTableView.tsx
- src/app/(dashboard)/workflows/[name]/components/WorkflowTableContent.tsx
- src/app/(dashboard)/workflows/[name]/components/panel/workflow/WorkflowTasksTab.tsx

### Profile
- src/app/(dashboard)/profile/components/ProfileLayout.tsx
- src/app/(dashboard)/profile/components/NotificationsSection.tsx
- src/app/(dashboard)/profile/components/PoolsSection.tsx
- src/app/(dashboard)/profile/components/BucketsSection.tsx
- src/app/(dashboard)/profile/components/CredentialsSection.tsx

### Dataset Detail
- src/app/(dashboard)/datasets/[bucket]/[name]/dataset-detail-content.tsx (FIXED this run)
- src/app/(dashboard)/datasets/components/panel/DatasetPanel.tsx (consumer-covered, FIXED this run)

### Log Viewer
- src/app/(dashboard)/log-viewer/components/log-viewer-page-content.tsx (FIXED this run)

### Panels
- src/app/(dashboard)/resources/components/panel/panel-content.tsx (ApiError inline)

### Consumer-Covered
- src/components/event-viewer/EventViewerContainer.tsx
- src/components/log-viewer/components/LogViewerContainer.tsx
- src/app/(dashboard)/workflows/[name]/components/panel/workflow/spec/WorkflowSpecViewer.tsx
- src/app/(dashboard)/workflows/[name]/components/resubmit/sections/PoolSection.tsx
- src/app/(dashboard)/workflows/[name]/components/resubmit/ResubmitPanelContent.tsx

### Low-Risk
- src/components/chrome/header.tsx (VersionMenuItem -- graceful degradation)

## API Layer

- Error categorization: OK -- errors flow through React Query with proper error fields
- Auth/401 handling: OK -- handled in fetcher.ts interceptor layer
- User-readable error messages: OK -- ApiError and InlineFallback display error.message

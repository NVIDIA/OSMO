# Error Boundary Coverage -- Known Good Files

Last updated: 2026-02-21

## List Pages (exemplar pattern: compact toolbar boundary + full table boundary with resetKeys/onReset)
- src/app/(dashboard)/pools/pools-page-content.tsx -- toolbar compact + table full with resetKeys/onReset
- src/app/(dashboard)/workflows/workflows-page-content.tsx -- toolbar compact + table full with resetKeys/onReset
- src/app/(dashboard)/resources/resources-page-content.tsx -- toolbar compact + table full with resetKeys/onReset
- src/app/(dashboard)/datasets/datasets-page-content.tsx -- toolbar compact + table full with resetKeys/onReset + panel boundary

## Dashboard
- src/app/(dashboard)/dashboard-content.tsx -- stats compact + recent workflows full + version compact (FIXED 2026-02-21)

## Workflow Detail
- src/app/(dashboard)/workflows/[name]/workflow-detail-inner.tsx -- DAG + panel + shell + cancel dialog + resubmit boundaries
- src/app/(dashboard)/workflows/[name]/components/WorkflowTableView.tsx -- toolbar compact + table full
- src/app/(dashboard)/workflows/[name]/components/WorkflowTableContent.tsx -- toolbar compact + table full
- src/app/(dashboard)/workflows/[name]/components/panel/workflow/WorkflowTasksTab.tsx -- table boundary

## Profile
- src/app/(dashboard)/profile/components/ProfileLayout.tsx -- each section independently wrapped
- src/app/(dashboard)/profile/components/NotificationsSection.tsx -- consumer-covered by ProfileLayout + own error handling
- src/app/(dashboard)/profile/components/PoolsSection.tsx -- consumer-covered by ProfileLayout + own error handling
- src/app/(dashboard)/profile/components/BucketsSection.tsx -- consumer-covered by ProfileLayout + own error handling
- src/app/(dashboard)/profile/components/CredentialsSection.tsx -- consumer-covered by ProfileLayout + own error handling

## Dataset Detail
- src/app/(dashboard)/datasets/[bucket]/[name]/dataset-detail-content.tsx -- header compact + file browser full (FIXED 2026-02-21)

## Panels
- src/app/(dashboard)/resources/components/panel/panel-content.tsx -- uses ApiError inline for pool details errors
- src/app/(dashboard)/datasets/components/panel/DatasetPanel.tsx -- consumer-covered by datasets-page-content (FIXED 2026-02-21)

## Log Viewer
- src/app/(dashboard)/log-viewer/components/log-viewer-page-content.tsx -- log viewer boundary (FIXED 2026-02-21)

## Consumer-Covered Components (boundary exists at render site)
- src/components/event-viewer/EventViewerContainer.tsx -- covered by workflow-detail-inner panel boundary
- src/components/log-viewer/components/LogViewerContainer.tsx -- covered by workflow-detail-inner panel boundary or log-viewer-page-content
- src/app/(dashboard)/workflows/[name]/components/panel/workflow/spec/WorkflowSpecViewer.tsx -- covered by panel boundary
- src/app/(dashboard)/workflows/[name]/components/resubmit/sections/PoolSection.tsx -- covered by resubmit boundary

## Low-Risk / Acceptable
- src/components/chrome/header.tsx (VersionMenuItem) -- useVersion with Infinity staleTime; failure = no version shown, graceful degradation

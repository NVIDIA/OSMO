# Composition Patterns Audit — Last Run
Date: 2026-02-21
Iteration: 1
Fixed this run: 0 files

## Open Violations Queue
None — all composition patterns are clean.

## Fixed This Run
None.

## Confirmed Clean Files
src/components/filter-bar/FilterBarDropdown.tsx — confirmed clean 2026-02-21
src/components/log-viewer/components/LogViewer.tsx — confirmed clean 2026-02-21
src/components/data-table/VirtualTableBody.tsx — confirmed clean 2026-02-21
src/components/data-table/DataTable.tsx — confirmed clean 2026-02-21
src/components/chrome/app-sidebar.tsx — confirmed clean 2026-02-21
src/components/log-viewer/components/LogList.tsx — confirmed clean 2026-02-21
src/components/log-viewer/components/LogEntryRow.tsx — confirmed clean 2026-02-21
src/components/event-viewer/TaskRow.tsx — confirmed clean 2026-02-21
src/components/event-viewer/EventViewerContainer.tsx — confirmed clean 2026-02-21
src/components/event-viewer/LifecycleProgressBar.tsx — confirmed clean 2026-02-21
src/components/event-viewer/EventViewerContext.tsx — confirmed clean 2026-02-21
src/components/event-viewer/EventViewerTable.tsx — confirmed clean 2026-02-21
src/components/panel/panel-tabs.tsx — confirmed clean 2026-02-21
src/components/error/inline-error-boundary.tsx — confirmed clean 2026-02-21
src/components/filter-bar/FilterBarInput.tsx — confirmed clean 2026-02-21
src/components/log-viewer/components/LogViewerContainer.tsx — confirmed clean 2026-02-21
src/components/event-viewer/EventDetailsPanel.tsx — confirmed clean 2026-02-21
src/components/panel/resizable-panel.tsx — confirmed clean 2026-02-21
src/components/filter-bar/FilterBarChip.tsx — confirmed clean 2026-02-21
src/components/log-viewer/components/Footer.tsx — confirmed clean 2026-02-21
src/components/log-viewer/components/timeline/components/TimelineContainer.tsx — confirmed clean 2026-02-21
src/components/log-viewer/components/timeline/components/TimelineAxis.tsx — confirmed clean 2026-02-21
src/components/log-viewer/components/timeline/components/TimelineSelectionOverlay.tsx — confirmed clean 2026-02-21
src/components/QueryDevtools.tsx — confirmed clean 2026-02-21
src/components/shell/components/ShellTerminalImpl.tsx — confirmed clean 2026-02-21
src/components/shell/components/ShellSessionIcon.tsx — confirmed clean 2026-02-21
src/components/panel/panel-header.tsx — confirmed clean 2026-02-21
src/components/panel/resize-handle.tsx — confirmed clean 2026-02-21
src/components/panel/side-panel.tsx — confirmed clean 2026-02-21
src/components/shell/components/ShellSearch.tsx — confirmed clean 2026-02-21
src/components/log-viewer/components/timeline/lib/timeline-context.tsx — confirmed clean 2026-02-21
src/components/log-viewer/components/timeline/components/TimelineWindow.tsx — confirmed clean 2026-02-21
src/components/log-viewer/components/LogViewerSkeleton.tsx — confirmed clean 2026-02-21
src/components/log-viewer/components/timeline/components/TimeRangeHeader.tsx — confirmed clean 2026-02-21
src/components/inline-progress.tsx — confirmed clean 2026-02-21
src/components/error/route-error.tsx — confirmed clean 2026-02-21
src/components/dag/components/DAGControls.tsx — confirmed clean 2026-02-21
src/components/capacity-bar.tsx — confirmed clean 2026-02-21
src/components/code-viewer/lib/search-panel.tsx — confirmed clean 2026-02-21
src/components/expandable-chips.tsx — confirmed clean 2026-02-21
src/components/panel/tab-panel.tsx — confirmed clean 2026-02-21
src/components/shadcn/dialog.tsx — confirmed clean 2026-02-21
src/components/panel/actions-section.tsx — confirmed clean 2026-02-21
src/components/log-viewer/components/ScrollPinControl.tsx — confirmed clean 2026-02-21
src/components/shadcn/sidebar.tsx — confirmed clean 2026-02-21
src/components/shadcn/semi-stateful-button.tsx — confirmed clean 2026-02-21
src/components/log-viewer/components/timeline/components/TimelineControls.tsx — confirmed clean 2026-02-21
src/components/data-table/TableSkeleton.tsx — confirmed clean 2026-02-21
src/components/progress-bar.tsx — confirmed clean 2026-02-21
src/components/panel/details-section.tsx — confirmed clean 2026-02-21
src/components/shadcn/context-menu.tsx — confirmed clean 2026-02-21
src/components/shadcn/command.tsx — confirmed clean 2026-02-21
src/components/shadcn/badge.tsx — confirmed clean 2026-02-21
src/components/boolean-indicator.tsx — confirmed clean 2026-02-21
src/components/shadcn/button.tsx — confirmed clean 2026-02-21
src/components/shadcn/dropdown-menu.tsx — confirmed clean 2026-02-21
src/components/log-viewer/components/timeline/components/TimelineHistogram.tsx — confirmed clean 2026-02-21

## Reasoning
All boolean props found are justified:
- Independent state flags (isPinnedToBottom, isStale, isStreaming, wrapLines, showTask) — these are current UI state passed down, not mode selectors
- Independent feature flags (compact, stickyHeaders, suspendResize) — all can coexist, not mutually exclusive
- Single optional section toggles (showHeader, showHistogram, showTimeline) — single toggle, not C2 proliferation
- ShellSearch booleans (caseSensitive, wholeWord, regex) — correct API for a search widget; all independent, all can be true simultaneously
- EventViewerContainer already uses `scope: "workflow" | "task"` instead of booleans — good pattern applied
- LogViewer already uses grouped prop objects (data, filter, timeline) — excellent composition
- Many components already use explicit variants (variant prop in Button/Badge via CVA)
- CapacityBar/ExpandableChips use children composition correctly

No C1 (mutually exclusive boolean variants), C2 (compound component opportunities), C4 (prop drilling), or C5 (duplicated logic) violations found.

## Verification
pnpm type-check: ✅
pnpm lint: ✅ (1 pre-existing warning in scripts/check-licenses.mjs outside scope)

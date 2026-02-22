# Folder Structure Enforcer — Memory

Last Updated: 2026-02-22
Mode: SCAN (full re-enumeration)

## Scan Summary

Total violations found: 71 files (70 in workflows/[name], 1 in experimental)
All violations are non-routing files inside `app/(dashboard)/` that should be in `features/`.

## Cluster Progress

Completed Clusters: [pools, resources, log-viewer, profile, datasets, dashboard, workflows-list, global-hooks, global-stores, global-lib, global-mocks, components-chrome, components-code-viewer, components-data-table, components-error, components-event-viewer, components-filter-bar, components-log-viewer, components-panel, components-refresh, components-shadcn, components-shell]
Pending Clusters: [workflows-detail, experimental]
Current Working Cluster: workflows-detail
Current Cluster Status: CONTINUE

## Violation Queue — workflows-detail cluster

All 70 files in `src/app/(dashboard)/workflows/[name]/` (excluding page.tsx, error.tsx) need to move to `src/features/workflows/detail/`.

### Subsystem: dag -- DONE (moved to features/workflows/detail/dag/)
1. ~~components/dag/dag-context.tsx~~ -> features/workflows/detail/dag/dag-context.tsx
2. ~~components/dag/dag-edge.tsx~~ -> features/workflows/detail/dag/dag-edge.tsx
3. ~~components/dag/group-node.tsx~~ -> features/workflows/detail/dag/group-node.tsx
4. ~~hooks/use-dag-state.ts~~ -> features/workflows/detail/dag/use-dag-state.ts
5. ~~lib/dag-layout.ts~~ -> features/workflows/detail/dag/dag-layout.ts
6. ~~lib/dag-layout.test.ts~~ -> features/workflows/detail/dag/dag-layout.test.ts
7. ~~styles/dag.css~~ -> features/workflows/detail/dag/dag.css

### Subsystem: shell -- DONE (moved to features/workflows/detail/shell/)
8. ~~components/shell/shell-container.tsx~~ -> features/workflows/detail/shell/shell-container.tsx
9. ~~components/shell/shell-context.tsx~~ -> features/workflows/detail/shell/shell-context.tsx
10. ~~components/shell/shell-navigation-guard.tsx~~ -> features/workflows/detail/shell/shell-navigation-guard.tsx
11. ~~components/shell/shell-portal-context.tsx~~ -> features/workflows/detail/shell/shell-portal-context.tsx

### Subsystem: resubmit -- DONE (moved as flat unit to features/workflows/detail/resubmit/)
12. ~~components/resubmit/resubmit-panel.tsx~~ -> features/workflows/detail/resubmit/resubmit-panel.tsx
13. ~~components/resubmit/resubmit-panel-header.tsx~~ -> features/workflows/detail/resubmit/resubmit-panel-header.tsx
14. ~~components/resubmit/resubmit-panel-content.tsx~~ -> features/workflows/detail/resubmit/resubmit-panel-content.tsx
15. ~~components/resubmit/hooks/use-resubmit-form.ts~~ -> features/workflows/detail/resubmit/use-resubmit-form.ts
16. ~~components/resubmit/hooks/use-resubmit-mutation.ts~~ -> features/workflows/detail/resubmit/use-resubmit-mutation.ts
17. ~~components/resubmit/sections/collapsible-section.tsx~~ -> features/workflows/detail/resubmit/collapsible-section.tsx
18. ~~components/resubmit/sections/pool-section.tsx~~ -> features/workflows/detail/resubmit/pool-section.tsx
19. ~~components/resubmit/sections/pool-select.tsx~~ -> features/workflows/detail/resubmit/pool-select.tsx
20. ~~components/resubmit/sections/pool-status-badge.tsx~~ -> features/workflows/detail/resubmit/pool-status-badge.tsx
21. ~~components/resubmit/sections/priority-section.tsx~~ -> features/workflows/detail/resubmit/priority-section.tsx
22. ~~components/resubmit/sections/spec-section.tsx~~ -> features/workflows/detail/resubmit/spec-section.tsx

### Panel components (move to features/workflows/detail/components/panel/)
23. components/panel/views/timeline.tsx
24. components/panel/views/dependency-pills.tsx
25. components/panel/views/content-slide-wrapper.tsx
26. components/panel/views/details-panel-header.tsx
27. components/panel/views/details-panel.tsx
28. components/panel/views/status-hover-card.tsx
29. components/panel/group/group-overview-tab.tsx
30. components/panel/group/group-details.tsx
31. components/panel/group/group-tasks-tab.tsx
32. components/panel/group/group-timeline.tsx
33. components/panel/task/task-details.tsx
34. components/panel/task/task-shell.tsx
35. components/panel/task/task-timeline.tsx
36. components/panel/workflow/cancel-workflow-dialog.tsx
37. components/panel/workflow/workflow-details.tsx
38. components/panel/workflow/workflow-edge-strip.tsx
39. components/panel/workflow/workflow-tasks-tab.tsx
40. components/panel/workflow/workflow-timeline.tsx
41. components/panel/workflow/spec/spec-toolbar.tsx
42. components/panel/workflow/spec/workflow-spec-viewer.tsx
43. components/panel/workflow/spec/hooks/use-spec-data.ts
44. components/panel/workflow/spec/hooks/use-spec-view-state.ts

### Shared components (move to features/workflows/detail/components/)
45. components/shared/group-badge.tsx
46. components/shared/lead-badge.tsx

### Hooks (move to features/workflows/detail/hooks/)
47. hooks/use-navigation-state.ts
48. hooks/use-panel-props.ts
49. hooks/use-workflow-detail-auto-refresh.ts
50. hooks/use-workflow-detail.ts

### Lib (move to features/workflows/detail/lib/)
51. lib/panel-constants.ts
52. lib/panel-resize-context.tsx
53. lib/panel-resize-state-machine.ts
54. lib/panel-types.ts
55. lib/status-utils.ts
56. lib/status.test.ts
57. lib/status.tsx
58. lib/task-column-defs.tsx
59. lib/task-columns.ts
60. lib/task-search-fields.tsx
61. lib/timeline-utils.ts
62. lib/view-types.ts
63. lib/workflow-layout.test.ts
64. lib/workflow-layout.ts
65. lib/workflow-selectors.test.ts
66. lib/workflow-selectors.ts
67. lib/workflow-types.ts

### Stores (move to features/workflows/detail/stores/)
68. stores/task-table-store.ts
69. stores/workflow-detail-panel-store.ts

### Styles (move to features/workflows/detail/styles/)
70. styles/layout.css

## Violation Queue — experimental cluster

1. experimental-client.tsx -> features/experimental/components/experimental-client.tsx (or delete if unused)

## Notes

- The `dag` subsystem files should move as a flat unit per Section 7.5 of the standards
- The `shell` subsystem files should move as a flat unit per Section 7.5
- The `resubmit` subsystem is a cohesive group with its own hooks and sections -- treat as subsystem
- Panel components maintain their subdirectory structure under features/workflows/detail/components/panel/
- CSS files (dag.css, layout.css) move alongside their subsystem/feature
- Already in features/workflows/detail/: workflow-detail-content.tsx, workflow-detail-with-data.tsx, workflow-detail-skeleton.tsx, workflow-detail-inner.tsx, workflow-detail-layout.tsx, snap-zone-indicator.tsx, workflow-dag-content.tsx, table/ subtree

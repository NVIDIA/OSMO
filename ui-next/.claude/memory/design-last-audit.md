# Design Guidelines Audit — Last Run
Date: 2026-02-21
Iteration: 1
Fixed this run: 5 files
Guidelines source: https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md

## Open Violations Queue

No remaining actionable violations after this run. All discovered violations were fixed.

### Files with acceptable patterns (not violations):
- `src/app/(dashboard)/log-viewer/components/workflow-selector.tsx:102` — `focus:outline-none` with `focus:ring-2 focus:ring-blue-500` replacement (acceptable)
- `src/components/log-viewer/components/LogList.tsx:473` — `focus:outline-none` on tabIndex=-1 element managed programmatically (acceptable, commented justification present)
- `src/components/log-viewer/components/LogEntryRow.tsx:49` — `focus:outline-none` with `focus-visible:ring-2 focus-visible:ring-inset` replacement (acceptable)
- `src/app/(dashboard)/workflows/[name]/components/panel/views/Timeline.tsx:332,449` — `focus:outline-none` with `focus:ring-2 focus:ring-blue-500` replacement (acceptable)

## Fixed This Run

1. `src/app/(dashboard)/workflows/[name]/components/panel/views/DetailsPanelHeader.tsx:313` — Added `type="button"`, `aria-label="More options"`, and `aria-hidden="true"` to MoreVertical icon button (D2: icon-only button without label)

2. `src/components/log-viewer/components/LogViewer.tsx:604,619` — Added `aria-label="Zoom in"` and `aria-label="Zoom out"` to icon-only zoom buttons; added `aria-hidden="true"` to icons (D2: icon-only buttons without accessible labels)

3. `src/app/(dashboard)/workflows/[name]/components/resubmit/sections/SpecSection.tsx:106-126` — Removed `asChild` + `span role="button"` anti-pattern. Replaced with direct `<Button onClick={handleRevert}>` (redundant/incorrect nested interactive element pattern)

4. `src/components/copyable-value.tsx` — Added `aria-label` to `CopyableValue` and `CopyableBlock` buttons (they only had `title` which is not reliably announced); added `type="button"` to `CopyButton`; added `aria-hidden="true"` to decorative icons

5. `src/components/panel/panel-header-controls.tsx` — Added `type="button"` to `PanelCloseButton`; added `aria-hidden="true"` to close icon

6. `src/components/panel/panel-header.tsx` — Added `type="button"` and `aria-label` to expandable toggle button; added `type="button"` to `PanelBackButton` and `PanelCollapseButton`; added `aria-hidden="true"` to icons

## Confirmed Clean Files

- `src/components/theme-toggle.tsx` — sr-only span for toggle, proper pattern
- `src/components/dag/components/DAGControls.tsx` — aria-label passed through ControlButtonProps, proper
- `src/app/(dashboard)/workflows/[name]/components/resubmit/sections/CollapsibleSection.tsx` — aria-label on CollapsibleTrigger, proper
- `src/app/(dashboard)/workflows/[name]/components/table/tree/SplitGroupHeader.tsx` — role="button" div with aria-expanded, aria-label, keyboard handler, proper
- `src/app/(dashboard)/pools/components/cells/gpu-progress-cell.tsx` — aria-label, aria-hidden on icon, proper
- `src/components/expandable-chips.tsx` — aria-labels on interactive buttons, aria-hidden on measurement container, proper
- `src/components/copyable-value.tsx` — CopyButton has aria-label (D2 fixed for CopyableValue/CopyableBlock)
- `src/components/chrome/header.tsx` — aria-label on hamburger button, sr-only on user menu, proper
- `src/app/(dashboard)/workflows/[name]/components/panel/task/TaskShell.tsx` — aria-label on back button, proper

## Verification
pnpm type-check: ✅
pnpm lint: ✅

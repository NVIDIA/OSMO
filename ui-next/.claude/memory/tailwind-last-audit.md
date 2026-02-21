# Tailwind Standards Audit — Last Run
Date: 2026-02-21
Iteration: 1
Fixed this run: 4 files

## Open Violations Queue

### T6 — Animation: layout property transitions (justified exceptions)
- `src/app/(dashboard)/workflows/[name]/styles/dag.css:486` — `transition: width 250ms` for panel snap. JUSTIFIED: actual width must change for layout to reflow.
- `src/components/data-table/styles.css:211-213` — `transition: width/min-width` for column resizing. JUSTIFIED: actual dimension changes needed; transitions disabled during active resize.

### T8 — Hardcoded colors (justified exceptions)
- `src/app/layout.tsx:83-91` — Inline styles in `AppLoadingFallback` use hardcoded hex. JUSTIFIED: pre-CSS-hydration spinner cannot use Tailwind classes.
- `src/components/shell/lib/types.ts:90,97,105` — xterm.js theme object uses hex. JUSTIFIED: xterm API requires raw hex strings, not CSS variables.

### T4 — Inline styles with static CSS properties (deferred)
- `src/components/expandable-chips.tsx:81` — `style={{ willChange: "contents" }}` — Tailwind has `will-change-contents` but `contents` is not a standard `will-change` value. Skip.
- `src/app/(dashboard)/workflows/[name]/components/panel/views/DependencyPills.tsx:133` — same pattern as above.
- `src/app/(dashboard)/pools/components/panel/shared-pools-chips.tsx:74` — same pattern.

## Fixed This Run
- `src/components/event-viewer/EventViewerTable.tsx` — T4: replaced `style={{ contain: "strict" }}` with `className="contain-strict"` (existing utility class)
- `src/app/(dashboard)/datasets/[bucket]/[name]/lib/version-column-defs.tsx` — T8: replaced `text-[#76b900]` → `text-nvidia`, `bg-[#76b900] hover:bg-[#6aa800]` → `bg-nvidia hover:bg-nvidia-dark`
- `src/app/(dashboard)/datasets/components/panel/DatasetPanelVersions.tsx` — T8: replaced `text-[#76b900]` → `text-nvidia`
- `src/components/data-table/TableSkeleton.tsx` — T4: moved `display: "flex"` from inline style to className on both `<tr>` elements

## Confirmed Clean Files
- `src/app/globals.css` — @theme inline pattern correct, CSS variables properly separated
- `src/styles/base.css` — uses @apply for base styles, correct pattern
- `src/styles/utilities.css` — proper custom utilities, CSS variables for shared values
- `src/components/data-table/styles.css` — excellent use of CSS variables, GPU-accelerated animations (width transitions justified)
- `src/components/event-viewer/event-viewer.css` — exemplary: CSS variables for column widths, data attributes for badge styling, GPU-accelerated animations
- `src/components/shell/styles/shell.css` — complex component, animation patterns acceptable
- `src/app/(dashboard)/workflows/[name]/styles/dag.css` — CSS variables for status colors, acceptable

## Verification
pnpm type-check: ✅
pnpm lint: ✅ (1 pre-existing warning in scripts/check-licenses.mjs, unrelated)

# Tailwind Standards — Skipped Items

Items that were identified but intentionally skipped (require human review or are justified exceptions).

## Justified Exceptions

src/app/layout.tsx:83-91 — AppLoadingFallback inline styles — Pre-CSS-hydration spinner cannot use Tailwind classes (CSS not yet loaded)
src/components/shell/lib/types.ts:90,97,105 — xterm.js theme hex colors — xterm API requires raw hex strings, CSS variables not supported
src/app/(dashboard)/workflows/[name]/styles/dag.css:486 — `transition: width` in .panel-snap-transition — width must change for panel layout reflow; unavoidable
src/components/data-table/styles.css:211-213 — `transition: width/min-width` for column resizing — same justification as above; mitigated with transition: none during active resize

## Deferred (Non-Standard CSS Values)

src/components/expandable-chips.tsx:81 — `style={{ willChange: "contents" }}` — Tailwind's will-change-* utilities don't include "contents"; not a standard value
src/app/(dashboard)/workflows/[name]/components/panel/views/DependencyPills.tsx:133 — same as above
src/app/(dashboard)/pools/components/panel/shared-pools-chips.tsx:74 — same as above

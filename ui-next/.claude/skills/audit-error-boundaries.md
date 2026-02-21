# Audit: Error Boundary Coverage

Perform a systematic error boundary coverage audit of the codebase.
Produce a structured report with severity-tagged findings and a coverage summary.

---

## Phase 0 — Load Memory (Before Doing Any Work)

Check for a previous audit state:
```
Read: .claude/memory/error-boundaries-last-audit.md  (if it exists)
Read: .claude/memory/error-boundaries-skipped.md     (if it exists)
```

If a previous audit exists:
- Note the date it was run and the score at that time
- Note any files marked as skipped (needs human decision) — do not re-flag these as violations
- Display a "since last run" delta at the top of your output

If no memory exists yet, note this is the first run.

---

## Phase 1 — Discover the Error System

**Do not assume component names or paths. Discover them first.**

### 1a. Find the error boundary components
```
Glob: src/components/error/**/*
```
Read every file found. For each component, identify:
- Its exported name(s)
- Its props interface (what props does it accept?)
- Which props are required vs optional
- What variants exist (e.g. compact mode, full mode)
- Its import path (for use in later steps)

### 1b. Find the API error handling layer
```
Glob: src/lib/api/fetcher* OR src/lib/api/client*
```
Read the file(s). Identify how errors are created, categorized, and whether there is interceptor-style error handling (auth redirects, toast notifications, retry logic).

### 1c. Find the data-fetching hook layer
```
Glob: src/lib/api/adapter/**/*
```
Read the index or hooks file. Identify:
- The names of all exported data-fetching hooks
- The shape of what they return (especially: is there an `error` field? a `refetch`?)

### 1d. Find exemplars (well-covered components to learn the pattern from)
Search for files that use both the error boundary component AND a data-fetching hook:
```
Grep: [error boundary component name from 1a]
Glob: src/**/*.tsx
```
Pick 2–3 results that look like list/page components. Read them fully.
Extract the exact pattern used: how is the boundary placed, what props are passed, how is `refetch` connected.

**These exemplars define the "correct" pattern for this codebase.** Use them as the reference standard for the rest of the audit.

---

## Phase 2 — Collect Everything to Audit

**Scope rule:** only components that directly call data-fetching hooks are in scope.
Pure UI components (no hook calls, only props) are never flagged — if they crash, that is a code bug, not a boundary gap.

### 2a. Find all data-fetching components
Using the hook names discovered in Phase 1c, search for every `.tsx` file that calls them:
```
Grep: [hook names joined with |]
Glob: src/**/*.tsx
```
Exclude test files and mock files. Record each match with its file path and which hooks it uses.

### 2b. Find all existing error boundaries
```
Grep: [error boundary component name from 1a]
Glob: src/**/*.tsx
```
For each match, read the file and record which props are present.

### 2c. Find all feature routes
```
Glob: src/app/**/error.tsx
```
Note which features have route-level error backstops and which don't.

---

## Phase 3 — Identify Gaps

For each data-fetching component found in 2a:

1. **Self-covered**: Does the component's own JSX wrap the data-dependent section with the error boundary? → ✅ covered
2. **Consumer-covered**: If not, find who imports and renders this component. Does that consumer wrap it? → ✅ covered
3. **Neither**: → 🔴 **GAP**

Do not flag a component as a gap if it is a pure pass-through (receives data as props from a parent that is already covered). The boundary belongs at the fetch site, not at every consumer downstream.

---

## Phase 4 — Audit Quality of Existing Boundaries

Compare each boundary found in 2b against the exemplar patterns from Phase 1d.

Apply this quality rubric (adapt based on what you discovered the props to be):

| Concern | Good | Bad |
|---|---|---|
| Title/label prop | Descriptive and specific to the data being loaded | Missing, or too generic like "Error" |
| Reset/retry callback | Connected to the actual `refetch` function | Missing when the boundary wraps a data fetch |
| Reset trigger | Tied to data state (e.g. item count) so boundary auto-recovers | Missing when the boundary wraps a data fetch |
| Scope | Wraps exactly ONE independent concern | Wraps multiple independent concerns (e.g. toolbar AND table) |
| Mode | Compact/minimal for small UI chrome like toolbars | Full-size error UI used for tiny non-critical components |

---

## Phase 5 — Output

### Summary Table

Produce a table grouped by feature area (infer features from directory structure):

```
Feature    | Boundaries | Critical Gaps | Warnings | Route backstop
─────────────────────────────────────────────────────────────────
[feature]  | N          | N             | N        | ✅/❌
```

### Findings (sorted by severity)

**🔴 CRITICAL — Unprotected data fetch, no boundary**
- `path/to/file.tsx:LINE` — calls `[hookName]`, no boundary in self or consumer
  - Suggested fix: [concrete suggestion using the exemplar pattern]

**🟡 WARNING — Boundary exists but incomplete**
- `path/to/file.tsx:LINE` — missing [specific prop]
  - Suggested fix: [what to add]

**🟠 ANTI-PATTERN — Boundary wraps multiple independent concerns**
- `path/to/file.tsx:LINE` — single boundary covers [X] and [Y]
  - Suggested fix: split into two boundaries

**🟢 INFO — Minor quality improvement**
- `path/to/file.tsx:LINE` — [specific issue]

### API Layer Status
Based on what you found in Phase 1b:
- Error categorization: ✅/❌ [brief note]
- Auth/401 handling: ✅/❌ [brief note]
- User-readable error messages: ✅/❌ [brief note]

### Final Score
`X/Y components covered (Z%)` — `N critical, M warnings, P anti-patterns`

---

## Phase 6 — Write Memory

After producing the report, write the current findings to disk so future runs can compare progress.

**Write `.claude/memory/error-boundaries-last-audit.md`** with this structure:
```markdown
# Error Boundary Audit — Last Run

Date: [today's date]
Score: X/Y covered (Z%)
Critical: N | Warnings: M | Anti-patterns: P | Skipped: Q

## Open Violations
[copy the 🔴, 🟡, 🟠 findings verbatim — file paths and descriptions]

## Confirmed Clean Files
[list every file audited that had NO violations]

## API Layer
[copy the API layer status section]
```

**Append to `.claude/memory/error-boundaries-skipped.md`** any 🔴/🟡/🟠 findings you are marking as "needs human decision" — include the file path, the issue, and why it was skipped. Do not append duplicates if the item is already in the file.

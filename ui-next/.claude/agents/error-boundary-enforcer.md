---
name: error-boundary-enforcer
description: "Finds and fixes missing or incomplete error boundaries in the ui-next codebase. Runs ONE audit→fix→verify cycle per invocation and exits with STATUS: DONE or STATUS: CONTINUE. The calling orchestrator re-invokes with a fresh context until STATUS is DONE. Examples: \"fix all missing error boundaries\", \"enforce error boundary coverage\", \"add error boundaries to the datasets feature\"."
tools: Read, Write, Edit, Glob, Grep, Bash
model: opus
---

You are an error boundary enforcement agent.
Your job: run **exactly one** audit→fix→verify cycle, write memory, then exit.

**Never loop internally. One iteration per invocation.**
The calling orchestrator checks your exit status and re-invokes with a fresh context if violations remain.

**Read before you edit. Never guess — discover. Never suppress errors.**

---

## Step 0 — Load Memory

Read these files (all may not exist yet — that is fine):

```
Read: .claude/memory/error-boundaries-discovery.md   ← cached Phase 1 results
Read: .claude/memory/error-boundaries-last-audit.md  ← previous findings + open violations queue
Read: .claude/memory/error-boundaries-known-good.md  ← files confirmed clean in prior runs
Read: .claude/memory/error-boundaries-skipped.md     ← items awaiting human review (never re-flag these)
```

Also read the audit skill so you know its phases:

```
Read: .claude/skills/audit-error-boundaries.md
Read: CLAUDE.md
Read: .claude/memory/dependency-graph.md   ← cluster data for scope selection
Read: .claude/skills/cluster-traversal.md   ← cluster selection procedure
```

Note the iteration number from `error-boundaries-last-audit.md` (default 0 if no prior run).
This invocation is iteration N+1.

---

## Step 1 — Select Working Cluster

**Scope filter for this enforcer: `all-ui`**

Follow the cluster-traversal skill (Step 5 procedure) to select one cluster to work on:

1. From `error-boundaries-last-audit.md`, load `Completed Clusters` and `Current Cluster Status`
2. If `Current Cluster Status: CONTINUE` — re-select the same cluster (violations remain)
3. Otherwise: filter graph clusters to `all-ui` scope (components + feature routes),
   remove completed clusters, sort topologically (leaf-first), select pending[0]
4. If graph is UNBUILT: use feature route directories as pseudo-clusters
   (`src/app/(dashboard)/*/` each = one cluster, alphabetical order)

**After selecting the cluster's directory, discover actual files with a live Glob:**
```
Glob: [cluster-directory]/**/*.{ts,tsx}
```

The live Glob result is authoritative. Graph file lists are hints for prioritization only.
Files in graph but missing on disk → skip silently. Files on disk not in graph → include them.

**Record:**
```
Working Cluster: [name]
Directory: [path]
Discovered files (live Glob): [N files — list them]
```

All subsequent steps operate only on files discovered within the working cluster's directory.

---

## Step 2 — Discovery (skip if cache is fresh for working cluster)

**If `error-boundaries-discovery.md` exists and is ≤ 7 days old:** load it and skip to Step 2.

**Otherwise:** run Phases 1a–1d from the audit skill. Then write the discovery cache:

Write `.claude/memory/error-boundaries-discovery.md`:
```markdown
# Error Boundary Discovery Cache
Date: [today]

## Boundary Component
Name: [exported component name]
Import path: [absolute @/ path]
Required props: [list]
Optional props: [list]
Compact variant: [prop name and value for compact/chrome mode, if any]

## Data-Fetching Hooks
[one per line: hookName — import path — returns { data, isLoading, error, refetch }]

## Exemplar Pattern (verbatim JSX structure)
[5–10 lines of the exact pattern used in reference files]
[Must show: boundary placement, title prop value style, onReset wiring, resetKeys wiring]

## Exemplar Files
[list the 2–3 files used as reference]
```

---

## Step 3 — Audit

Run Phases 2–5 from the audit skill using the discovery knowledge from Step 2.

**Scope**: audit ONLY files within the working cluster selected in Step 1.

**Efficiency rule:** any file listed in `error-boundaries-known-good.md` may be skipped unless it
appears in the output of `git diff --name-only HEAD~1` (i.e. recently modified).

Produce the full findings report: 🔴 CRITICAL, 🟡 WARNING, 🟠 ANTI-PATTERN, 🟢 INFO.

Do **not** re-flag items already in `error-boundaries-skipped.md` — list them separately as
"previously skipped, awaiting human decision."

---

## Step 4 — Fix (bounded to 10 violations)

Select the **top 10 violations** by severity within the working cluster: 🔴 first, then 🟡, then 🟠.
If `error-boundaries-last-audit.md` has an open violations queue for this cluster from a prior run,
treat those as the front of the queue (audit findings confirm/refresh them and may add new ones at the back).

For each selected violation, apply the appropriate fix pattern:

**Pattern A — Wrap in consumer** *(preferred when there is one clear rendering parent)*
Wrap the component at its render site. Connect `onReset` to `refetch`, `resetKeys` to data length.

**Pattern B — Wrap internally** *(component rendered in many places)*
Wrap the component's own JSX return. Use data and `refetch` already in scope.

**Pattern C — Compact boundary for chrome**
Toolbars, filter bars, secondary controls: use `compact` prop (or equivalent).

**Pattern D — Complete an existing boundary**
Add the missing `onReset` callback and/or `resetKeys` to a boundary that already exists.

**Pattern E — Split a combined boundary**
One boundary wraps multiple independent concerns → split into one boundary per concern.
Use compact for chrome, full for content.

After each edit confirm:
- The boundary component import is present and uses an absolute `@/` path
- Any new file has the NVIDIA copyright header (format in CLAUDE.md)

---

## Step 5 — Verify

```bash
pnpm type-check
pnpm lint
```

If either fails, fix the root cause before proceeding to Step 5.
Never use `@ts-ignore`, `any` types, or `eslint-disable`.

---

## Step 6 — Write Memory

**Write `.claude/memory/error-boundaries-last-audit.md`** (full replacement):
```markdown
# Error Boundary Audit — Last Run
Date: [today]
Iteration: [N]
Score: X/Y covered (Z%)
Critical: N | Warnings: M | Anti-patterns: P | Skipped: Q | Fixed this run: R

## Cluster Progress
Completed Clusters: [cluster-a, cluster-b, ...]
Pending Clusters (topo order): [cluster-c, cluster-d, ...]
Current Working Cluster: [cluster-name]
Current Cluster Status: [DONE | CONTINUE]

## Open Violations Queue (current cluster)
[All unfixed 🔴, 🟡, 🟠 findings in severity order — file paths, line numbers, descriptions]
[These are the starting queue for the next invocation of this cluster]

## Fixed This Run
[One line per file: path — what changed — which pattern used]

## Confirmed Clean Files
[Every file audited in this invocation that had no violations]
```

**Update `.claude/memory/error-boundaries-known-good.md`:**
- Append every file you confirmed clean or just fixed successfully
- Format: `src/path/to/file.tsx — confirmed clean [date]`
- Do not duplicate entries already in the file

**Append to `.claude/memory/error-boundaries-skipped.md`** (only new items):
- Any violation you could not safely auto-fix (ambiguous ownership, needs refactor, etc.)
- Format: `src/path/to/file.tsx — [issue description] — [reason skipped]`
- Do not append duplicates

---

## Step 7 — Exit Report

Output this summary so the orchestrator knows what to do next:

```
## Iteration [N] Complete

Working cluster this cycle: [cluster-name] ([N files])
Cluster status: [DONE | CONTINUE]
Completed clusters: N/M total
Pending clusters: [cluster-c, cluster-d, ...]

Fixed this run: N files
  [one line per file: path — brief description]

Violations remaining in cluster: N (critical: N, warnings: N, anti-patterns: N)
Skipped (human review): N items

Verification:
  pnpm type-check: ✅/❌
  pnpm lint: ✅/❌

STATUS: [DONE | CONTINUE]
```

- **DONE**: all clusters processed (pending list empty) AND current cluster has no remaining violations
- **CONTINUE**: current cluster has remaining violations OR more clusters remain in pending list

---

## Hard Rules

- **Never loop internally** — one audit→fix→verify cycle per invocation, then exit
- **Max 10 fixes per invocation** — keeps context bounded and prevents rot
- **Never edit a file you haven't read in this session**
- **One independent concern per boundary** — never couple unrelated UI sections
- **All imports must use absolute `@/` paths** — never relative
- **Never suppress type or lint errors** — fix the root cause
- **Do not create route-level `error.tsx` files** unless explicitly requested
- **Do not modify test files or mock files**
- **Only flag components that directly call data-fetching hooks** — pure UI components that receive data as props are never in scope; if they crash, that is a code bug to fix, not a boundary gap

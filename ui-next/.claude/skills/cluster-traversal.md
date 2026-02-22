# Cluster Traversal — Skill

How to select a working cluster, scope an agent cycle to it, and track progress.

Every pipeline enforcer loads this skill at Step 0. **One cycle = one cluster.**
This prevents context bloat from mixing unrelated clusters in a single agent invocation.

---

## Source of Truth Hierarchy

> **The dependency graph is a hint, not the authoritative source of truth.**
> It narrows the search frontier — it tells you *where to look*, not *what you'll find*.

| What the graph tells you | How to treat it |
|--------------------------|-----------------|
| Which cluster to work on next (topology, cohesion, pending/completed) | **Authoritative** — use as-is for cluster selection ordering |
| Which directory the cluster lives in | **Authoritative** — use as the base path for discovery |
| Which files are in the cluster | **Advisory hint only** — always verify with a live Glob |
| Import relationships between files | **Advisory hint only** — always verify with a live Grep |
| Cluster membership of a file | **Advisory hint only** — file may have been moved since last graph build |

**After selecting a cluster, always discover the actual codebase:**
```
Glob: [cluster-directory]/**/*.{ts,tsx}
```
Use this live file list as your actual scope — not the graph's cached file list.
A file in the graph that no longer exists on disk: skip it silently.
A file in the directory that the graph doesn't list: include it — the graph is stale.

Live Grep and Read are always more accurate than graph memory after recent changes.

**CRITICAL — Dynamic route directories**: Next.js directories like `[bucket]`, `[name]`,
`[id]` use literal square brackets as directory names on disk. If the graph lists
`src/app/.../[bucket]/[name]/** (N files)` as an abbreviation, do NOT treat `[bucket]`
as a glob character class. The live `Glob: [cluster-directory]/**/*.{ts,tsx}` call will
correctly traverse into `[bracket]` directories via `**`. Trust the Glob result, not the
graph's abbreviated notation.

---

## 1. Why Cluster-Scoped Batching

An enforcer with an arbitrary "max N files" cap may pick N files from 5 unrelated
clusters. The agent's context then holds domain knowledge from 5 separate semantic
areas — high noise, low signal per area, poor reasoning quality.

Cluster-scoped batching solves this:
- One cycle works on files that are highly coupled to each other
- Reasoning, fixes, and verification all share the same semantic context
- Clusters are processed to completion before moving to the next

---

## 2. Core Concepts

**Cluster**: a set of files with high internal import cohesion (more edges within
the group than across its boundary). From the dependency graph:
```
### data-table
Directory: src/components/data-table
Files:
  - src/components/data-table/data-table.tsx
  - src/components/data-table/data-table-header.tsx
  - src/components/data-table/use-data-table.ts
  ...
Imports from clusters: [shared-ui, stores]
Imported by clusters: [pools, workflows, datasets]
```

**Topology**: which clusters depend on which. `Imports from clusters` = this cluster's
outgoing cluster edges. If cluster A imports from cluster B, A depends on B.

**Leaf cluster**: a cluster that is NOT imported by any other pending cluster.
Processing leaf clusters first ensures their file names/locations are stable before
their dependents reference them.

---

## 3. Reading Cluster Data

Load `.claude/memory/dependency-graph.md` (already done in Step 0).

From the Clusters section, extract for each cluster:
- Name
- Directory
- File list
- `Imports from clusters` list (outgoing cluster deps)
- `Imported by clusters` list (incoming cluster deps)

If the graph status is **UNBUILT**, go to section 6 (Fallback Procedure).

---

## 4. Scope Filters

Each enforcer declares which scope filter it uses. Only clusters containing
files relevant to the domain are candidates for cluster selection.

| Filter              | Clusters in scope                                                      |
|---------------------|-----------------------------------------------------------------------|
| `component-dirs`    | Clusters whose primary directory is under `src/components/`           |
| `feature-routes`    | Clusters whose primary directory is under `src/app/(dashboard)/`      |
| `all-ui`            | Both `component-dirs` and `feature-routes`                            |
| `hook-files`        | Clusters containing files under `src/hooks/`                          |
| `all-source`        | All clusters (no filter)                                              |

**Per-domain scope filters:**

| Enforcer                    | Scope Filter    |
|-----------------------------|-----------------|
| file-rename-enforcer        | `all-source`    |
| folder-structure-enforcer   | `all-source`    |
| error-boundary-enforcer     | `all-ui`        |
| react-best-practices-enforcer | `all-source`  |
| nextjs-patterns-enforcer    | `feature-routes`|
| composition-patterns-enforcer | `component-dirs`|
| tailwind-standards-enforcer | `all-ui`        |
| design-guidelines-enforcer  | `all-ui`        |

---

## 5. Cluster Selection Procedure

Run this procedure at the start of every enforcer cycle:

### 5a. Load completed clusters from domain memory

From `[domain]-last-audit.md`, read:
```
Completed Clusters: [list]
Current Working Cluster: [name]
Current Cluster Status: [DONE | CONTINUE]
```

Default if no prior run: Completed Clusters = [], Current Working Cluster = none.

### 5b. Re-use current cluster if it's CONTINUE

If `Current Cluster Status: CONTINUE` (the last cycle left violations in this cluster):
→ Re-select the same cluster. Skip steps 5c–5e.

### 5c. Filter clusters to domain scope

Apply this enforcer's scope filter. Discard clusters outside scope.

### 5d. Remove completed clusters

Discard any cluster whose name appears in `Completed Clusters`.

### 5e. Sort topologically (leaf-first)

Among the remaining pending clusters, compute topological order:

```
1. Build inter-cluster dependency map: for each cluster, list which OTHER
   pending clusters it imports from.

2. Find leaf clusters: clusters with zero outgoing edges to other PENDING clusters.
   (A cluster that only imports from already-COMPLETED clusters is a leaf.)

3. Sort: leaves first, then clusters whose deps are all leaves, and so on.
   (This is a standard BFS/Kahn's algorithm on the inter-cluster DAG.)

4. Tie-break within same depth: higher cohesion first (% in cluster definition).
```

### 5f. Select working cluster and discover actual files

Pick the first cluster in the sorted list.

The cluster gives you a **directory** — not a definitive file list. After selecting the cluster,
discover its actual contents with a live tool call:

```
Glob: [cluster-primary-directory]/**/*.{ts,tsx}
```

This live result is your audit scope. Cross-reference against the graph's file list only to
prioritize order (files the graph already knows are hot imports → check first). But:
- Files in the graph that don't exist on disk → skip silently (already moved/deleted)
- Files in the directory that the graph doesn't list → include them (graph is stale)

**Record:**
```
Working Cluster: [cluster-name]
Directory: [primary directory]
Discovered files (live Glob):
  [file-1]
  [file-2]
  ...
Graph-listed files not found on disk (stale): [list or "none"]
Files found on disk not in graph (new/unlisted): [list or "none"]
```

---

## 6. Fallback Procedure (Graph UNBUILT)

When the dependency graph has Status: UNBUILT, derive pseudo-clusters from
directory structure:

**component-dirs scope:**
```
Glob: src/components/*/
```
Each subdirectory is one pseudo-cluster. Name = directory basename.
Files in cluster = all `.ts`/`.tsx` files in that directory (non-recursive unless
the subdir has no direct files).

**feature-routes scope:**
```
Glob: src/app/(dashboard)/*/
```
Each subdirectory is one pseudo-cluster. Files = all non-reserved `.tsx` files
in that directory tree.

**hook-files scope:**
`src/hooks/` = one pseudo-cluster named "global-hooks".

**all-source scope:**
Combine all of the above plus:
- `src/stores/` = pseudo-cluster "stores"
- `src/lib/` = pseudo-cluster "lib" (skip `generated.ts`)
- `src/mocks/` = pseudo-cluster "mocks"
- `src/components/*.{ts,tsx}` (root-level only, no subdirs) = pseudo-cluster "components-root"

**Order when UNBUILT:** alphabetical (no topology data available).

Apply the same completed-cluster filter from section 5a.

---

## 7. Recording Progress

At the end of each cycle, update domain memory with cluster progress.

Record what was **discovered on disk**, not what the graph claimed:

```markdown
## Cluster Progress
Completed Clusters: [cluster-a, cluster-b]
Pending Clusters (topo order): [cluster-c, cluster-d, cluster-e]
Current Working Cluster: cluster-c
Current Cluster Status: [DONE | CONTINUE]
Discovered files this cycle: N   ← from live Glob, not graph cache
```

**Current Cluster Status:**
- `DONE`: all violations in this cluster are fixed or skipped. Add cluster name to
  Completed Clusters. Set next pending as working cluster.
- `CONTINUE`: violations remain in this cluster. Keep same cluster next cycle.

---

## 8. DONE / CONTINUE Determination

**The enforcer returns STATUS: DONE only when:**
- `Pending Clusters` list is empty (after marking current cluster DONE), AND
- `Current Cluster Status: DONE`

In other words: every cluster has been fully processed.

**The enforcer returns STATUS: CONTINUE when:**
- Current cluster still has unfixed violations (`Current Cluster Status: CONTINUE`), OR
- More clusters remain in `Pending Clusters`

---

## 9. Cap Semantics

The "max N fixes per invocation" cap that exists in each enforcer becomes a
**safety cap for abnormally large clusters**, not the primary bound.

The primary bound is: **finish the current cluster** (or as many violations as
possible within the cap).

If a cluster has more violations than the cap allows in one cycle:
- Fix up to the cap
- Record status as `CONTINUE` for this cluster
- Same cluster is re-selected next invocation
- Continue from where the violations queue left off

This ensures that even a very large cluster gets processed to completion across
multiple invocations, always in a coherent single-cluster context.

---

## 10. Exit Report Additions

Each enforcer's exit report should include cluster progress:

```
Working cluster this cycle: [cluster-name] ([N files])
Cluster status: [DONE | CONTINUE]
Completed clusters: N/M
Pending clusters: [cluster-c, cluster-d, ...]
```

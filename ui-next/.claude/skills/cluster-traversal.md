# Cluster Traversal — Skill

How to select a working cluster, scope an agent cycle to it, and track progress.

Every pipeline enforcer loads this skill. **One cycle = one cluster.**
This prevents context bloat from mixing unrelated clusters in a single agent invocation.

---

## 1. Why Cluster-Scoped Batching

An enforcer with an arbitrary "max N files" cap may pick N files from 5 unrelated
clusters. The agent's context then holds domain knowledge from 5 separate semantic
areas — high noise, low signal per area, poor reasoning quality.

Cluster-scoped batching solves this:
- One cycle works on files that are semantically coupled
- Reasoning, fixes, and verification all share the same context
- Clusters are processed to completion before moving to the next

---

## 2. Scope Filters

Each enforcer declares a scope filter. Only directories matching the filter
are cluster candidates.

| Filter | Cluster directories |
|--------|---------------------|
| `component-dirs` | Each subdirectory of `src/components/` |
| `feature-routes` | Each subdirectory of `src/app/(dashboard)/` |
| `all-ui` | Both `component-dirs` and `feature-routes` |
| `hook-files` | `src/hooks/` as one cluster |
| `all-source` | All of the above plus `src/stores/`, `src/lib/`, `src/mocks/` |

**Per-domain scope filters:**

| Enforcer                      | Scope Filter     |
|-------------------------------|------------------|
| file-rename-enforcer          | `all-source`     |
| folder-structure-enforcer     | `all-source`     |
| error-boundary-enforcer       | `all-ui`         |
| react-best-practices-enforcer | `all-source`     |
| nextjs-patterns-enforcer      | `feature-routes` |
| composition-patterns-enforcer | `component-dirs` |
| tailwind-standards-enforcer   | `all-ui`         |
| design-guidelines-enforcer    | `all-ui`         |
| dead-code-enforcer            | `all-source`     |
| layer-compliance-enforcer     | `all-source`     |
| abstraction-enforcer          | `all-source`     |

---

## 3. Cluster Selection Procedure

Run this at the start of every enforcer cycle:

### 3a. Load progress from domain memory

From `[domain]-last-audit.md`, read:
```
Completed Clusters: [list]
Current Working Cluster: [name]
Current Cluster Status: [DONE | CONTINUE]
```
Default if no prior run: Completed Clusters = [], Current Working Cluster = none.

### 3b. Re-use current cluster if it's CONTINUE

If `Current Cluster Status: CONTINUE` (violations remain in this cluster):
→ Re-select the same cluster. Skip steps 3c–3d.

### 3c. Enumerate candidate clusters from directory structure

Apply the scope filter to list candidate directories. Each subdirectory under
the scope path is one cluster:

```
# component-dirs scope:
Glob: src/components/*/

# feature-routes scope:
Glob: src/app/(dashboard)/*/

# hook-files scope:
src/hooks/ = one cluster named "global-hooks"

# all-source scope: combine all of the above plus
src/stores/ = one cluster
src/lib/    = one cluster (skip generated.ts)
src/mocks/  = one cluster
```

Discard any cluster whose name appears in `Completed Clusters`.
Sort alphabetically. Select the first remaining cluster.

### 3d. Discover actual cluster files with a live Glob

The directory gives you the cluster boundary. After selecting, always discover
the actual contents:

```
Glob: [cluster-primary-directory]/**/*.{ts,tsx}
```

This live result is your audit scope — not any cached list.

**Record:**
```
Working Cluster: [cluster-name]
Directory: [primary directory]
Discovered files (live Glob): [N files]
```

---

## 4. Recording Progress

At the end of each cycle, update domain memory:

```markdown
## Cluster Progress
Completed Clusters: [cluster-a, cluster-b]
Pending Clusters: [cluster-c, cluster-d, cluster-e]
Current Working Cluster: cluster-c
Current Cluster Status: [DONE | CONTINUE]
```

**Current Cluster Status:**
- `DONE`: all violations in this cluster are fixed or skipped. Add cluster name to
  Completed Clusters. Set next pending as working cluster.
- `CONTINUE`: violations remain. Keep same cluster next cycle.

---

## 5. DONE / CONTINUE Determination

**STATUS: DONE only when:**
- Pending Clusters list is empty (after marking current cluster DONE), AND
- Current Cluster Status: DONE

**STATUS: CONTINUE when:**
- Current cluster still has unfixed violations (`Current Cluster Status: CONTINUE`), OR
- More clusters remain in Pending Clusters

---

## 6. Cap Semantics

The "max N fixes per invocation" cap is a **safety cap for abnormally large clusters**,
not the primary bound.

The primary bound is: **finish the current cluster** (or as many violations as
possible within the cap).

If a cluster has more violations than the cap:
- Fix up to the cap
- Record status as `CONTINUE`
- Same cluster is re-selected next invocation
- Continue from where the violations queue left off

---

## 7. Exit Report Additions

Each enforcer's exit report should include cluster progress:

```
Working cluster this cycle: [cluster-name] ([N files])
Cluster status: [DONE | CONTINUE]
Completed clusters: N/M
Pending clusters: [cluster-c, cluster-d, ...]
```

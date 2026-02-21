# Dependency Graph — Skill

How to read, query, update, and reason about the import dependency graph for ui-next.

This skill is loaded by every pipeline agent. The graph in
`.claude/memory/dependency-graph.md` is the shared source of truth for code
structure. Every agent that modifies files MUST update the graph before exiting.

---

## 1. What the Graph Is

A directed graph where:
- **Nodes** = source files (`src/**/*.{ts,tsx}`)
- **Edges** = import relationships (`A → B` means A imports B)
- **Clusters** = groups of nodes with high internal cohesion (more edges within
  the group than across its boundary)

The graph answers every structural question:
- "Who depends on this file?" → in-edges (importers)
- "What does this file depend on?" → out-edges (its imports)
- "What logical module does this belong to?" → cluster membership
- "Is this file safe to delete/inline?" → in_degree = 0 or 1
- "Is this file doing too much?" → high betweenness, cross-cluster edges
- "Should these files be colocated?" → same cluster, different directories

---

## 2. Reading the Graph

### From memory (pre-computed)

Load `.claude/memory/dependency-graph.md` for:
- Cluster definitions and cohesion metrics
- Pre-identified notable nodes (bridges, isolated, single-importer)
- Cross-cluster violations
- Changelog of recent mutations

**Read the graph memory at Step 0 of every agent invocation.**

### Live queries (always accurate)

For a specific file, live queries are more accurate than memory after recent changes.

**Find all importers of a file:**
```
Grep: pattern="from ['\"]@/path/to/file['\"]" glob="src/**/*.{ts,tsx}" output_mode="files_with_matches"
```
Strip the `src/` prefix and `.ts`/`.tsx` extension from the target path.

**Find all imports of a file:**
```
Read: src/path/to/file.ts
```
Parse every `import ... from "..."` statement. Extract `@/` paths.

**Check if a file is dead (no importers):**
```
Grep: pattern="['\"]@/path/to/file['\"]" glob="src/**/*.{ts,tsx}"
```
Zero results → dead code candidate (verify it is not an entry point: page.tsx,
route.ts, layout.tsx are never imported but are not dead).

---

## 3. Cluster Reasoning

A **cluster** is a set of files that form a logical unit. The two signals:

**Structural signal** — files in the same directory with high mutual import density
tend to form a cluster.

**Semantic signal** — files whose names share a domain prefix
(`panel-*`, `use-panel-*`, `data-table-*`) tend to form a cluster even if
temporarily scattered across directories.

### Cohesion formula

```
cohesion = internal_edges / (internal_edges + external_edges)
```

- `cohesion > 0.7` → tightly coupled, likely a correct module boundary
- `cohesion 0.4–0.7` → moderate coupling, worth reviewing
- `cohesion < 0.4` → loosely coupled, files may not belong together

### What tight coupling means architecturally

High cohesion within a cluster = those files **should be colocated** and treated
as a unit. Changes to one file frequently require changes to others.

Low cohesion across a cluster boundary = those files are **correctly separated**.
They can evolve independently.

### Cluster membership rules

A file belongs to the cluster where it has the most in-cluster edges.
Tie-break: use directory location.

When a file is moved (folder-structure domain), re-evaluate its cluster membership.
It may shift from one cluster to another.

---

## 4. Identifying Architectural Issues from Graph Shape

### Dead code → `dead-code` domain
```
in_degree = 0  AND  not an entry point
```
Entry points (never imported but not dead): `page.tsx`, `layout.tsx`,
`error.tsx`, `loading.tsx`, `route.ts`, `not-found.tsx`, `providers.tsx`.

### Inline candidate → `abstraction-audit` domain
```
in_degree = 1  AND  the file adds no meaningful transformation
```
A file imported by exactly one consumer that is either:
- A thin re-export wrapper
- A trivial one-liner that could live inline in its consumer

### Bridge node → `abstraction-audit` domain
```
high betweenness: connects 2+ otherwise-unconnected clusters
```
A bridge node is imported by multiple clusters. It may be:
- A correctly shared utility (keep) — `utils.ts`, `use-copy.ts`
- A catch-all that has grown too large (decompose) — a `utils.ts` with 30 exports
- A file in the wrong location (move) — `src/hooks/use-panel-width.ts`
  imported only by `src/components/panel/`

### Misplaced file → `folder-structure` domain
```
cluster membership ≠ directory location
```
A file belongs to the `panel` cluster (most imports are panel files) but lives
in `src/hooks/`. It should move to `src/components/panel/`.

### Wrong file name → `file-rename` domain
```
node path contains uppercase
```

### Cross-cluster violation → `layer-compliance` domain
```
edge crosses an architectural boundary that should not be crossed
```
Example: `src/app/(dashboard)/pools/*` imports `src/app/(dashboard)/workflows/*`.
Features must not import from each other.

### Missing abstraction → `abstraction-audit` domain
```
3+ nodes with near-identical import patterns AND near-identical structure
```
These are duplication candidates that should be extracted into a shared module.

---

## 5. Updating the Graph

**Every agent that modifies files MUST update the graph memory before exiting.**
The graph must reflect the codebase after each domain runs so the next domain
starts with accurate information.

### RENAME (file-rename domain)

When `OldName.tsx` is renamed to `new-name.tsx`:

```
1. Find the node with path: src/.../OldName.tsx
2. Update node path to: src/.../new-name.tsx
3. Update all edges that referenced the old path
4. Cluster membership: unchanged (same directory, same cluster)
5. Append to changelog: RENAME src/.../OldName.tsx → new-name.tsx
```

### MOVE (folder-structure domain)

When `src/hooks/use-panel-lifecycle.ts` moves to `src/components/panel/`:

```
1. Update node path: src/hooks/use-panel-lifecycle.ts
                  → src/components/panel/use-panel-lifecycle.ts
2. Update all edges that referenced the old path
3. Remove from old cluster (hooks), add to new cluster (panel)
4. Recompute cohesion for both affected clusters
5. Append to changelog: MOVE src/hooks/use-panel-lifecycle.ts → src/components/panel/
```

### DELETE (dead-code domain)

When a dead file is deleted:

```
1. Remove the node
2. Remove all edges to/from it (importers should also be gone or updated)
3. If it was in a cluster, recompute that cluster's cohesion
4. Append to changelog: DELETE src/.../file.ts
```

### CREATE (any domain)

When a new file is created:

```
1. Add node with path
2. Parse its imports, add out-edges
3. Find all files that import it, add in-edges
4. Assign to cluster based on directory + semantic name
5. Recompute cluster cohesion
6. Append to changelog: CREATE src/.../file.ts
```

### INLINE (abstraction-audit domain)

When a file's code is inlined into its single consumer and the file is deleted:

```
1. DELETE the node (see above)
2. The consumer's out-edges absorb the inlined file's out-edges
3. Append to changelog: INLINE src/.../file.ts → src/.../consumer.ts
```

---

## 6. Graph Update Format

When writing updates back to `.claude/memory/dependency-graph.md`:

- **Cluster changes**: update the cluster's file list and recompute cohesion
- **Notable node changes**: add/remove from the relevant sections
- **Changelog**: always append, never remove entries
- **Stats**: update total nodes, edges, isolated count after each domain

Write the full file if cluster structure changed significantly.
Use Edit for targeted updates (single node rename, single changelog entry).

---

## 7. What NOT to Store in Memory

The memory file stores **summaries**, not the full adjacency list.

Do NOT store:
- Every edge (too verbose — query live with Grep instead)
- Full import lists per file (read the file directly)
- Per-file metrics for every file (only notable outliers)

DO store:
- Cluster definitions (pre-computed, expensive to recompute)
- Notable nodes (pre-identified, used by multiple domains)
- Cross-cluster violations (pre-computed, architectural concern)
- Changelog (append-only, tracks graph mutations across pipeline runs)

---

## 8. Reasoning About Partitions

When evaluating whether a set of files forms a correct logical partition:

**Ask these questions:**
1. Do these files change together? (high co-change frequency = tight coupling)
2. Do these files share domain vocabulary in their names?
3. Would a new developer expect to find them together?
4. If you extracted them into a package, would the package have a clear name?
5. Are the external edges to this cluster through well-defined interfaces (adapter hooks,
   typed props) or ad-hoc (direct internal imports)?

**A well-partitioned cluster:**
- Has a name you can say in one word (`panel`, `data-table`, `pools`)
- External consumers use a stable, narrow interface
- Internal files are free to change without external impact

**A poorly-partitioned cluster:**
- Has no clear name (it is just "stuff that ended up together")
- External edges reach into internal implementation details
- Adding a file requires deciding between two equally plausible clusters

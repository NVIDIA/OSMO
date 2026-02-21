# Dependency Graph — ui-next

Last Built: —
Last Updated: —
Status: UNBUILT — run dependency-graph-builder agent to populate

Source Files: —
Total Nodes: —
Total Edges: —

---

## Graph Stats

```
Isolated nodes   (in_degree=0, not entry point): —
Single-importer  (in_degree=1):                  —
Bridge nodes     (cross-cluster connectors):      —
Cross-cluster violations:                         —
```

---

## Clusters

> One entry per logical module. Cohesion = internal_edges / (internal + external).
> Files listed are non-entry-point source files only.

<!--
SCHEMA — each cluster looks like:

### [cluster-name]
Directory: src/path/to/primary/dir
Files:
  - src/.../file-a.ts
  - src/.../file-b.tsx
Internal edges: N
External edges: N
Cohesion: N% → [HIGH | MEDIUM | LOW]
Imports from clusters: [cluster-name, ...]
Imported by clusters: [cluster-name, ...]
Notes: [optional — anything unusual about this cluster]
-->

---

## Notable Nodes

### Bridge Nodes — connect otherwise-separate clusters
> High betweenness: imported by 2+ distinct clusters.
> Each may be a correctly shared utility OR a catch-all that should be decomposed.

<!--
SCHEMA:
- src/.../file.ts  [N importers across N clusters]  → [KEEP shared | DECOMPOSE | MOVE]
  Connects: cluster-A ↔ cluster-B ↔ cluster-C
-->

### High Fan-In — potential catch-alls (≥8 importers)
> Review for decomposition if they contain unrelated exports.

<!--
SCHEMA:
- src/.../file.ts  [N importers]
-->

### Single-Importer Nodes — inline candidates (in_degree=1)
> Imported by exactly one file. Evaluate: does this file justify its existence,
> or should its code live inline in its consumer?

<!--
SCHEMA:
- src/.../file.ts  →  imported only by: src/.../consumer.ts
  Verdict: [INLINE | KEEP — reason]
-->

### Dead Code — no importers (in_degree=0)
> Not imported anywhere AND not an entry point (page/layout/route/providers).

<!--
SCHEMA:
- src/.../file.ts  →  [DELETE | KEEP — reason]
-->

---

## Cross-Cluster Violations

> Edges that cross architectural boundaries they should not cross.
> These are the import-path violations that layer-compliance enforces.

<!--
SCHEMA:
- src/.../source.ts → src/.../target.ts
  Violation: [features must not import each other | generated hook bypasses adapter | etc.]
-->

---

## Changelog

> Append-only. Every agent that mutates the graph writes one line per operation.
> Format: [date] [OPERATION] [details]
> Operations: BUILD, RENAME, MOVE, DELETE, CREATE, INLINE, REFRESH

<!--
EXAMPLE:
2026-02-21 BUILD  Initial graph — 142 nodes, 387 edges, 9 clusters identified
2026-02-21 RENAME src/components/data-table/DataTable.tsx → data-table.tsx
2026-02-21 MOVE   src/hooks/use-panel-lifecycle.ts → src/components/panel/
2026-02-21 DELETE src/components/DevAuthInit.tsx (dead — inlined into layout)
-->

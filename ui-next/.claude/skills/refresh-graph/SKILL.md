# /refresh-graph

Rebuild the import dependency graph for ui-next. Run this any time you change files
and want downstream pipeline domains (dead-code, layer-compliance, cluster-traversal)
to have an accurate view of the codebase.

---

## What I Do (3 steps, no more)

1. Launch `dependency-graph-builder` agent with **force refresh** (foreground — wait for exit report)
2. Parse the exit report (batch progress + overall STATUS)
3. Show the progress summary to the user

No reads, no writes, no loops here. All graph state is managed inside the builder.

---

## How to Invoke

```
subagent_type: dependency-graph-builder
prompt: Force refresh the dependency graph. Treat the current graph as UNBUILT regardless of
the staleness threshold — a fresh scan has been explicitly requested. Process the next batch
of up to 5 unprocessed directories, extract import edges, identify notable nodes, update
.claude/memory/dependency-graph.md, and exit with STATUS: DONE or STATUS: CONTINUE.
```

Wait for the builder to return. Then display its progress summary verbatim to the user.

---

## Expected Output Format

```
## Dependency Graph Refresh

Directories processed this batch: [list]
Files scanned: N
Edges extracted: N (intra: N, cross: N)
New clusters defined: N
Notable nodes found:
  Dead candidates: N
  Single-importer: N
  High fan-in (≥8): N
  Bridge nodes: N

Graph status: BUILDING (N/M dirs complete) | BUILT
Overall: [N dirs done] / [M dirs total]

Run /refresh-graph again to continue.   ← only if STATUS: CONTINUE
```

If STATUS is DONE:
```
## Dependency Graph Refresh — Complete ✅

Graph rebuilt. N clusters, N nodes, N edges.
Dead candidates: N  ← files with 0 importers, ready for dead-code enforcer
Cross-cluster violations: N  ← ready for layer-compliance enforcer
```

---

## When to Use

- After adding, renaming, or moving source files
- Before running `/audit-and-fix` when significant code has changed
- When cluster-traversal is producing unexpected results (graph may be stale)
- After merging a PR that touched many files

## Notes

- Each invocation processes one batch (~5 directories). For a full rebuild, run `/refresh-graph`
  repeatedly until the graph shows BUILT status.
- Force refresh always runs even if the graph was recently built — it bypasses the 20-file
  staleness threshold used by the automated pipeline.
- This skill does NOT touch pipeline state. It only updates
  `.claude/memory/dependency-graph.md`.

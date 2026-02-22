# Folder Structure -- Skipped

Files or patterns intentionally not changed.

## Minor Style Observations (not violations)
- src/app/(dashboard)/log-viewer/ uses components/ and lib/ sub-folders with only 4 non-route files (standard says 8+ for sub-folders). Acceptable organizational choice, not a blocking violation.

## Cross-Cluster Violations (deferred to layer-compliance domain)
These are layer violations where a lower-layer module imports from a higher-layer feature:
1. event-viewer -> workflow-detail/lib (event-search-fields, event-filtering)
2. datasets-shim -> datasets/lib (date-filter-utils)
3. resources-shim -> resources/lib (compute-aggregates)
These require moving shared utilities down in the layer hierarchy, which overlaps with the layer-compliance enforcer domain.

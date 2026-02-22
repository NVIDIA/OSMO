# Layer Compliance Audit

Last Updated: 2026-02-22
Status: DONE — all violations resolved ✅

## Violation Summary

### Fixed (3 auto-fixed)

1. **V2 (hook import):** `src/app/(dashboard)/log-viewer/components/log-viewer-page-content.tsx`
   - Was: `import { useGetWorkflowApiWorkflowNameGet, type WorkflowQueryResponse } from "@/lib/api/generated"`
   - Now: `import { useWorkflow } from "@/lib/api/adapter/hooks"` (adapter hook with parsing + timestamp normalization)
   - Removed unused `WorkflowQueryResponse` type import (no longer needed after adapter switch)

2. **V2 (type import):** `src/app/(dashboard)/workflows/[name]/components/panel/workflow/spec/workflow-spec-viewer.tsx`
   - Was: `import type { WorkflowQueryResponse } from "@/lib/api/generated"`
   - Now: `import type { WorkflowQueryResponse } from "@/lib/api/adapter/types"`

3. **V2 (type import):** `src/app/(dashboard)/workflows/[name]/components/panel/workflow/spec/hooks/use-spec-data.ts`
   - Was: `import type { WorkflowQueryResponse } from "@/lib/api/generated"`
   - Now: `import type { WorkflowQueryResponse } from "@/lib/api/adapter/types"`

#### V1 -- Feature-to-Feature Imports (2) — ALL FIXED ✅

1. ~~`pool-status-badge.tsx`~~ → `getStatusDisplay, STATUS_STYLES, type StatusCategory` moved to `src/lib/pool-status.ts`
   - All 5 consumers updated (4 pools-internal + 1 workflows violator); `constants.ts` trimmed to just `DisplayMode` re-export
2. ~~`pool-section.tsx`~~ → `PlatformPills` moved to `src/components/platform-pills.tsx`
   - Old `pools/components/cells/platform-pills.tsx` deleted; 2 consumers updated

#### V2 -- Direct Generated Hook Import (1) — ALL FIXED ✅

3. ~~`pool-section.tsx`~~ → replaced `useGetPoolQuotasApiPoolQuotaGet` with `usePool`/`usePools` from adapter
   - Added optional `enabled` param to both `usePool(poolName, enabled)` and `usePools(enabled)` in `adapter/hooks.ts`

#### V3 -- Components Importing from App Routes (2) — ALL FIXED ✅

4. ~~`src/components/event-viewer/event-viewer-container.tsx`~~ → `event-search-fields.tsx` moved to `src/components/event-viewer/lib/`
5. ~~`src/components/event-viewer/event-viewer-container.tsx`~~ → `event-filtering.ts` moved to `src/components/event-viewer/lib/`
   - Both originals deleted from `workflows/[name]/lib/`; only consumer was `event-viewer-container.tsx`

#### V3-like -- Lib/Stores/Hooks Importing from App Routes (3) — ALL FIXED ✅

6. ~~`src/lib/api/adapter/datasets-shim.ts`~~ → `parseDateRangeValue` moved to `src/lib/date-range-utils.ts`
   - `date-filter-utils.ts` slimmed to only `getDateRangePresetSuggestions` (imports `DATE_RANGE_PRESETS` from lib)
7. ~~`src/lib/api/adapter/resources-shim.ts`~~ → `computeAggregates` + `ResourceAggregates` moved to `src/lib/resource-aggregates.ts`
   - `compute-aggregates.ts` deleted; all 5 consumers updated
8. ~~`src/hooks/use-server-mutation.ts`~~ → `ActionResult` moved to `src/lib/server-actions.ts`
   - `workflows/actions.ts` re-exports `ActionResult` from lib (preserves public API)

### Not Violations (allowed enum imports)

All remaining `@/lib/api/generated` imports are enum-only imports:
- `PoolStatus`, `WorkflowStatus`, `TaskGroupStatus`, `WorkflowPriority`, `BackendResourceType`
These are explicitly allowed per the layer-compliance standards.

### V4 -- Barrel Exports: NONE (0 violations)
### V5 -- Relative Imports: NONE (0 violations)

## Cluster Progress
Completed Clusters: all (full codebase scan, not cluster-by-cluster)
Pending Clusters: none
Current Working Cluster: none
Current Cluster Status: DONE

## Verification
- pnpm type-check: PASS (0 errors)
- pnpm lint: PASS (0 errors/warnings)

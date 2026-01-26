# Debug Infrastructure Audit

**Date:** 2026-01-26
**Purpose:** Document all existing debug/logging patterns before creating unified system

## Summary

| Category | Count | Production Safe? | Notes |
|----------|-------|------------------|-------|
| **Feature-specific debug systems** | 3 | ⚠️ Partial | Timeline (✅), DataTable (✅), DAG (❌) |
| **Dev-only utilities** | 3 | ✅ Yes | MockProvider, inject-auth, service-worker-manager |
| **Production logging** | 1 | ✅ Yes | lib/logger.ts (env-gated) |
| **One-off console logs** | ~60 | ❌ No | Scattered across codebase |

---

## 1. Feature-Specific Debug Systems

### 1.1 Timeline Debug (⭐ EXEMPLAR)
**Location:** `src/components/log-viewer/components/timeline/hooks/use-timeline-gestures.ts`

| Aspect | Implementation |
|--------|----------------|
| **Activation** | URL param: `?debug=timeline` or `?debug=true` |
| **Logging** | Silent until activated, structured events, 100-event buffer |
| **Window APIs** | ✅ `window.timelineDebug()` - table view<br>✅ `window.timelineDebugCurrent()` - current state<br>✅ `window.timelineDebugStats()` - statistics<br>✅ `window.timelineDebugClear()` - clear buffer |
| **JSON Export** | ✅ Yes: `JSON.stringify(wheelDebugLog, null, 2)` |
| **Production** | ❌ Not tree-shaken (code remains, but no-op when not activated) |
| **Strengths** | • No console spam<br>• Elegant APIs<br>• LLM-friendly JSON dumps<br>• Self-documenting |
| **Recommendation** | ✅ **Use as template for unified system** |

**Example Usage:**
```javascript
// URL: ?debug=timeline
window.timelineDebug()        // View all wheel events in table
window.timelineDebugCurrent() // Show current state + invalid zones
window.timelineDebugStats()   // Show statistics (blocked %, pans vs zooms)
```

---

### 1.2 Data Table Column Sizing Debug (⭐ PRODUCTION-SAFE)
**Location:** `src/components/data-table/utils/debug.ts`

| Aspect | Implementation |
|--------|----------------|
| **Activation** | localStorage: `localStorage.setItem('DEBUG_COLUMN_SIZING', 'true')` |
| **Logging** | Batched events (100ms debounce), structured snapshots |
| **Window APIs** | ❌ None (direct console.log only) |
| **JSON Export** | ✅ Yes: Full state snapshots for AI consumption |
| **Production** | ✅ **Tree-shaken via Turbopack alias** → `debug.production.ts` |
| **Strengths** | • Zero production overhead (aliased)<br>• AI-optimized output<br>• Event batching prevents spam |
| **Weaknesses** | • No window APIs for inspection<br>• localStorage less convenient than URL param |
| **Recommendation** | ✅ **Extract pattern for unified system** |

**Example Usage:**
```javascript
// Enable debugging
localStorage.setItem('DEBUG_COLUMN_SIZING', 'true')

// Reproduce issue, then copy output from console:
{
  "_instruction": "Copy this entire object and paste to AI for debugging",
  "eventCount": 5,
  "timeRange": "...",
  "finalState": { /* complete state snapshot */ }
}
```

**Production Stub Pattern:**
```typescript
// debug.production.ts - All functions are no-ops
export function logColumnSizingDebug(_snapshot: DebugSnapshot): void {}
export function createDebugSnapshot(...): DebugSnapshot { return {} as DebugSnapshot; }
```

---

### 1.3 DAG Debug (⚠️ NOT PRODUCTION-SAFE)
**Location:** `src/components/dag/lib/dag-debug.ts`

| Aspect | Implementation |
|--------|----------------|
| **Activation** | URL param: `?debug=true` (checked in `workflow-detail-inner.tsx`) |
| **Logging** | Direct console.log when enabled + dev mode |
| **Window APIs** | ❌ None |
| **JSON Export** | ❌ No structured format |
| **Production** | ❌ **Code remains, gated by `process.env.NODE_ENV`** |
| **Strengths** | • URL-based activation<br>• Centralized logger instance |
| **Weaknesses** | • No window APIs<br>• No JSON export<br>• Not tree-shaken in production<br>• Spams console when enabled |
| **Recommendation** | ⚠️ **Migrate to unified system** |

**Example Usage:**
```typescript
// URL: ?debug=true
dagDebug.log("LAYOUT_START", { nodeCount: 50 })
// Output: [DAG-DEBUG] LAYOUT_START { nodeCount: 50 }
```

---

## 2. Dev-Only Utilities (Production-Safe)

### 2.1 MockProvider (✅ PRODUCTION-SAFE)
**Location:** `src/mocks/MockProvider.tsx`

| Aspect | Implementation |
|--------|----------------|
| **Purpose** | Mock mode control panel (hermetic dev) |
| **Window API** | `window.__mockConfig` - adjust data volumes<br>`window.__dev` - service worker utils |
| **Production** | ✅ **Aliased to `MockProvider.production.tsx`** (empty stub) |
| **Recommendation** | ✅ **Keep as-is** (already optimal) |

---

### 2.2 Dev Auth Helpers (✅ PRODUCTION-SAFE)
**Location:** `src/mocks/inject-auth.ts`

| Aspect | Implementation |
|--------|----------------|
| **Purpose** | JWT injection for local dev (no backend SSO) |
| **Window API** | `window.devAuth.testUsers.*` - inject test users |
| **Production** | ✅ **Aliased to `inject-auth.production.ts`** (empty export) |
| **Recommendation** | ✅ **Keep as-is** |

---

### 2.3 Service Worker Manager (✅ PRODUCTION-SAFE)
**Location:** `src/lib/dev/service-worker-manager.ts`

| Aspect | Implementation |
|--------|----------------|
| **Purpose** | Clear MSW service workers that break HMR |
| **Usage** | Called from MockProvider: `__dev.clearServiceWorker()` |
| **Production** | ✅ Only imported by MockProvider (which is stubbed) |
| **Recommendation** | ✅ **Keep as-is** |

---

## 3. Production Logging (Minimal, Intentional)

### 3.1 Logger Utility (✅ PRODUCTION-SAFE)
**Location:** `src/lib/logger.ts`

| Aspect | Implementation |
|--------|----------------|
| **Purpose** | Minimal logging for errors/warnings |
| **API** | `logError()` - always logged<br>`logWarn()` - dev only |
| **Production** | ✅ `console.error` removed by Next.js config (except errors/warnings) |
| **Recommendation** | ✅ **Keep for error reporting** (not debug-related) |

---

## 4. One-Off Console Logs (❌ CLEANUP NEEDED)

### 4.1 Shell/WebSocket Debugging

| File | Lines | Type | Recommendation |
|------|-------|------|----------------|
| `use-websocket-shell.ts:201` | 1 | `console.debug` - filter resize msgs | 🔄 Migrate to unified debug |
| `use-websocket-shell.ts:287` | 1 | `console.debug` - connection details | 🔄 Migrate to unified debug |
| `use-shell.ts:132` | 1 | `console.debug` - WebGL fallback | 🔄 Migrate to unified debug |

**Pattern:** Debug logs for WebSocket/PTY issues. Should be unified under `?debug=shell`.

---

### 4.2 API/Backend Errors (Keep)

| File | Lines | Type | Recommendation |
|------|-------|------|----------------|
| `log-parser.ts:283` | 1 | `console.warn` - out-of-order entries | ✅ Keep (backend bug) |
| `adapter/hooks.ts:372` | 1 | `console.error` - parse failure | ✅ Keep (error) |
| `workflows-shim.ts:120` | 1 | `console.error` - parse failure | ✅ Keep (error) |
| `logs.ts:115` | 1 | `console.log` - cache cleared | ✅ Keep (server action) |
| `api/[...path]/route.ts:136` | 1 | `console.error` - proxy error | ✅ Keep (critical) |
| `api/workflow/[name]/logs/route.ts:83` | 1 | `console.error` - backend fail | ✅ Keep (critical) |

**Pattern:** Production error logging. These should stay (Next.js strips console.log but keeps error/warn).

---

### 4.3 Workflow/DAG Warnings (Keep)

| File | Lines | Type | Recommendation |
|------|-------|------|----------------|
| `workflow-layout.ts:152` | 1 | `console.warn` - cycle detected | ✅ Keep (data issue) |
| `workflow-layout.ts:173` | 1 | `console.warn` - upstream not found | ✅ Keep (data issue) |
| `dag-layout.ts:233` | 1 | `console.warn` - no position found | ✅ Keep (data issue) |
| `use-dag-state.ts:301` | 1 | `console.error` - layout failed | ✅ Keep (error) |

**Pattern:** Warnings about malformed workflow data. Should stay to help debug backend issues.

---

### 4.4 Placeholder Code (Remove)

| File | Lines | Type | Recommendation |
|------|-------|------|----------------|
| `workflow-detail-inner.tsx:400` | 1 | `console.log("Cancel workflow")` | ❌ Remove (placeholder) |
| `ShellTerminalImpl.tsx:29` | 1 | JSDoc example with console.log | ✅ Keep (just docs) |

---

### 4.5 Mock Mode Console Logs (Dev Only)

| File | Lines | Type | Recommendation |
|------|-------|------|----------------|
| `MockProvider.tsx` | 20 | Mock config window API logs | ✅ Keep (dev mode only) |
| `inject-auth.ts` | 20 | Auth helper logs | ✅ Keep (dev mode only) |
| `instrumentation.ts:54` | 1 | MSW server started | ✅ Keep (dev mode only) |
| `log-scenarios.ts:267` | 1 | Unknown scenario warning | ✅ Keep (dev mode only) |

**Pattern:** These are in files already aliased to production stubs. No action needed.

---

## 5. Turbopack Alias Configuration (Existing)

**Location:** `next.config.ts` (lines 158-178)

```typescript
turbopack: {
  resolveAlias: process.env.NODE_ENV === "production" ? {
    // Data table debug → production stub
    "./utils/debug": "./utils/debug.production",

    // Mock provider → production stub
    "@/mocks/MockProvider": "@/mocks/MockProvider.production",
    "@/mocks/server": "@/mocks/server.production",
    "@/mocks/inject-auth": "@/mocks/inject-auth.production",

    // JWT helper → production version
    "@/lib/auth/jwt-helper": "@/lib/auth/jwt-helper.production",
  } : {}
}
```

**Status:** ✅ Works perfectly. Extend this pattern for unified debug system.

---

## 6. Unified Debug System Proposal

### Goals
1. ✅ URL param activation: `?debug=true` or `?debug=module-name`
2. ✅ No console spam (structured logging with window APIs)
3. ✅ JSON export for LLM feedback
4. ✅ **ZERO production overhead** (Turbopack aliasing)
5. ✅ Consistent API across all features

### Proposed API

```typescript
// src/lib/debug/index.ts
import { createDebugger } from '@/lib/debug/core';

export const shellDebug = createDebugger('shell');
export const dagDebug = createDebugger('dag');
export const timelineDebug = createDebugger('timeline');

// Usage in components:
shellDebug.log('WS_CONNECT', { url, key });
shellDebug.error('WS_FAILED', error);

// Browser console:
window.__debug.shell()         // View all shell events
window.__debug.shellCurrent()  // Current state
window.__debug.shellExport()   // JSON for LLM
window.__debug.help()          // Show all modules
```

### Migration Plan

| Module | Priority | Effort | Impact |
|--------|----------|--------|--------|
| **Shell/WebSocket** | High | Medium | Consolidate 3 console.debug calls |
| **DAG** | High | Low | Already centralized, just migrate API |
| **Timeline** | Low | None | Already excellent, maybe adopt unified API |
| **Data Table** | Low | None | Already production-safe, maybe add window APIs |

---

## 7. Next Steps

### Phase 1: Create Unified Debug Core (High Priority)
1. Create `src/lib/debug/core.ts` - createDebugger factory
2. Create `src/lib/debug/core.production.ts` - no-op stub
3. Add Turbopack alias to `next.config.ts`
4. Create `src/lib/debug/index.ts` - export namespaced debuggers

### Phase 2: Migrate High-Value Modules
1. **Shell/WebSocket** - consolidate 3 console.debug calls
2. **DAG** - migrate from class-based to factory pattern
3. Test production build to verify zero overhead

### Phase 3: Optional Harmonization
1. **Timeline** - optionally adopt unified API (keep existing if preferred)
2. **Data Table** - optionally add window APIs

### Phase 4: Documentation
1. Add to CLAUDE.md under "Debugging Features"
2. Document `?debug=module-name` convention
3. Document window.__debug API

---

## 8. Key Design Decisions

### ✅ URL Param vs localStorage
**Decision:** Use URL param `?debug=module-name`
- ✅ More discoverable (visible in address bar)
- ✅ Shareable (send URL to teammate)
- ✅ Consistent with existing Timeline implementation
- ❌ localStorage is fine too (Data Table uses it), but URL is superior

### ✅ Turbopack Alias vs Dead Code Elimination
**Decision:** Use Turbopack alias (existing pattern)
- ✅ Guaranteed zero overhead (code never bundled)
- ✅ Already working for MockProvider, data-table debug
- ✅ No reliance on optimizer heuristics

### ✅ Namespace Strategy
**Decision:** Module-scoped debuggers (`shellDebug`, `dagDebug`, etc.)
- ✅ Prevents collisions
- ✅ Selective activation: `?debug=shell` vs `?debug=true`
- ✅ Clear ownership

### ✅ Window API Naming
**Decision:** Single namespace `window.__debug.*`
- ✅ Avoids polluting global scope
- ✅ Consistent with existing `__mockConfig`, `__dev`
- ✅ Self-documenting with `.help()` method

---

## 9. Files to Clean Up (Low Priority)

### Remove Placeholder Code
- [ ] `workflow-detail-inner.tsx:400` - Remove `console.log("Cancel workflow")`

### Consider Migrating (Optional)
- [ ] Shell console.debug → unified debug (3 locations)
- [ ] DAG debug → unified debug (already centralized, just API change)

---

## Appendix: Feature Comparison Matrix

| Feature | Timeline | DataTable | DAG | Unified (Proposed) |
|---------|----------|-----------|-----|-------------------|
| **URL Activation** | ✅ Yes | ❌ localStorage | ✅ Yes | ✅ Yes |
| **Window APIs** | ✅ 4 helpers | ❌ No | ❌ No | ✅ Yes |
| **JSON Export** | ✅ Yes | ✅ Yes | ❌ No | ✅ Yes |
| **Event Buffer** | ✅ 100 events | ✅ Batched | ❌ Immediate | ✅ Configurable |
| **Production Safe** | ⚠️ No-op | ✅ Aliased | ⚠️ Gated | ✅ Aliased |
| **Self-Documenting** | ✅ Help msg | ⚠️ Partial | ❌ No | ✅ Yes |
| **Namespace** | `timelineDebug*` | N/A | `dagDebug` | `__debug.*` |

---

**Legend:**
- ✅ Implemented well
- ⚠️ Implemented but could be better
- ❌ Not implemented
- 🔄 Should migrate to unified system

**Conclusion:** Timeline debug is the gold standard. Data Table has the right production safety pattern (Turbopack alias). Combine both for the unified system.

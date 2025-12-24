# Hermetic Local Development

> **Goal**: Full UI development with zero network access using deterministic, memory-efficient synthetic data generation.

---

## Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           HERMETIC DEVELOPMENT                              │
│                                                                             │
│   UI Components  ◀────▶  TanStack Query  ◀────▶  MSW Handlers  ◀──▶  Generators
│                                                                    (infinite)
│                                                                             │
│   Zero network access required!                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Key Properties

| Property | Implementation |
|----------|----------------|
| **Spec-Coupled** | Status enums imported from `@/lib/api/generated.ts` |
| **Deterministic** | `faker.seed(baseSeed + index)` - same index = same data |
| **Memory Efficient** | No storage - items regenerated on each request |
| **Infinite Pagination** | Configurable `total` - set to any number |

---

## Quick Start

```bash
# Start dev with mock mode
pnpm dev:mock

# Or set environment variable
NEXT_PUBLIC_MOCK_API=true pnpm dev
```

That's it! No setup, no scraping, no configuration needed.

---

## Architecture

### Component Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| **Generators** | Faker.js + TypeScript | Deterministic infinite data |
| **Mock Interceptor** | MSW (Mock Service Worker) | Intercepts fetch, returns synthetic data |
| **API Client** | Orval-generated | Type-safe, matches OpenAPI spec |
| **Data Fetching** | TanStack Query | Caching, loading states |
| **UI** | React + Next.js | What we're developing |

### Request Flow

```
UI Component
     │
     ▼
TanStack Query
     │
     ▼
fetch("/api/workflow?offset=100&limit=20")
     │
     ▼
MSW Intercepts
     │
     ▼
┌─────────────────────────────────────────────┐
│          WorkflowGenerator                  │
│                                             │
│   for (i = 100; i < 120; i++) {            │
│     faker.seed(baseSeed + i);  // ← Key!   │
│     entries.push(generate(i));             │
│   }                                         │
│                                             │
│   return { entries, total: 10000 };        │
└─────────────────────────────────────────────┘
     │
     ▼
HttpResponse.json({ entries, total })
     │
     ▼
UI renders page
```

---

## Directory Structure

```
external/ui-next/
├── src/
│   └── mocks/
│       ├── browser.ts           # MSW browser setup
│       ├── handlers.ts          # Request handlers for all endpoints
│       ├── index.ts             # Main exports
│       ├── MockProvider.tsx     # React provider
│       │
│       ├── generators/          # Deterministic data generators
│       │   ├── index.ts
│       │   ├── workflow-generator.ts   # Workflows (infinite)
│       │   ├── pool-generator.ts       # Pools
│       │   ├── resource-generator.ts   # Resources (infinite per pool)
│       │   ├── task-generator.ts       # Tasks
│       │   ├── log-generator.ts        # Streaming logs
│       │   ├── event-generator.ts      # K8s-style events
│       │   ├── bucket-generator.ts     # Storage/artifacts
│       │   ├── dataset-generator.ts    # Datasets/collections
│       │   ├── profile-generator.ts    # User profiles
│       │   ├── portforward-generator.ts # Port forwarding
│       │   └── terminal-simulator.ts   # Interactive terminal
│       │
│       └── seed/                # Configuration
│           ├── index.ts
│           └── types.ts         # MOCK_CONFIG with patterns
│
└── public/
    └── mockServiceWorker.js     # MSW service worker
```

---

## Generators

### Infinite Pagination

Generators don't store data. They regenerate on demand:

```typescript
import { workflowGenerator, setWorkflowTotal } from "@/mocks/generators";

// Configure total (default: 10,000)
setWorkflowTotal(100_000);

// Request page 500 (items 10000-10019)
const { entries, total } = workflowGenerator.generatePage(10000, 20);

// entries.length = 20
// total = 100,000
// Memory: O(20), not O(100,000)!
```

### Determinism

Same index always produces identical data:

```typescript
// First call
workflowGenerator.generate(12345);
// → { name: "train-model-abc123", status: "RUNNING", ... }

// Later call (same result!)
workflowGenerator.generate(12345);
// → { name: "train-model-abc123", status: "RUNNING", ... }
```

This enables:
- Consistent pagination (scroll back and see same items)
- Reproducible bugs
- Stable UI testing

### Volume Configuration

Configure volumes via browser console (available in mock mode):

```javascript
// Show help
__mockConfig.help()

// Configure for stress testing
__mockConfig.setWorkflowTotal(100000)      // 100k workflows
__mockConfig.setPoolTotal(1000)            // 1k pools
__mockConfig.setResourcePerPool(10000)     // 10k resources per pool
__mockConfig.setResourceTotalGlobal(1000000) // 1M total resources
__mockConfig.setBucketTotal(10000)         // 10k buckets
__mockConfig.setDatasetTotal(50000)        // 50k datasets

// Check current volumes
__mockConfig.getVolumes()
```

Or in test/module code:

```typescript
import { setWorkflowTotal, setPoolTotal } from "@/mocks/generators";

setWorkflowTotal(100_000);
setPoolTotal(1_000);
```

### Volume Presets

```typescript
import { DEFAULT_VOLUME, HIGH_VOLUME, LOW_VOLUME } from "@/mocks/generators";

DEFAULT_VOLUME  // 10,000 workflows
HIGH_VOLUME     // 100,000 workflows  
LOW_VOLUME      // 100 workflows
```

---

## Available Generators

| Generator | Entity | Infinite? | Default | Purpose |
|-----------|--------|-----------|---------|---------|
| `WorkflowGenerator` | Workflows | ✅ | 10,000 | List, detail, DAG |
| `TaskGenerator` | Tasks | ✅ (by name) | - | Task details |
| `PoolGenerator` | Pools | ✅ | 50 | Pool list |
| `ResourceGenerator` | Nodes | ✅ (per pool + global) | 50/pool | GPU allocation |
| `LogGenerator` | Logs | ✅ | - | Streaming task logs |
| `EventGenerator` | Events | ✅ | - | K8s-style events |
| `BucketGenerator` | Buckets | ✅ | 50 | Artifact storage |
| `DatasetGenerator` | Datasets | ✅ | 100 | Dataset metadata |
| `ProfileGenerator` | Users | By user | - | User settings |
| `PortForwardGenerator` | Tunnels | Session-based | - | Remote access |
| `TerminalSimulator` | Shell | Interactive | - | Exec sessions |

---

## Testing Scenarios

### Pagination Boundaries

```typescript
setWorkflowTotal(100_000);

// Normal page
workflowGenerator.generatePage(0, 20);      // First 20

// Middle
workflowGenerator.generatePage(50_000, 20); // Middle 20

// Near end
workflowGenerator.generatePage(99_990, 20); // Last 10

// Past end
workflowGenerator.generatePage(100_000, 20); // Empty []
```

### Filtering

```typescript
// Handlers apply filters to generated data
GET /api/workflow?statuses=RUNNING&pools=gpu-pool
```

### Error States

```typescript
// In handlers.ts - simulate failures
http.get("/api/workflow/:name", async ({ params }) => {
  // 10% failure rate
  if (Math.random() < 0.1) {
    return new HttpResponse(null, { status: 500 });
  }
  // ...
});
```

### Network Latency

```typescript
// In handlers.ts
const MOCK_DELAY = 50; // ms

http.get("/api/workflow", async () => {
  await delay(MOCK_DELAY);
  // ...
});
```

---

## API Endpoints

All handlers in `src/mocks/handlers.ts`:

### Workflows

| Endpoint | Method | Pagination |
|----------|--------|------------|
| `/api/workflow` | GET | offset/limit |
| `/api/workflow/:name` | GET | - |
| `/api/workflow/:name/logs` | GET | - |
| `/api/workflow/:name/events` | GET | - |
| `/api/workflow/:name/spec` | GET | - |
| `/api/workflow/:name/artifacts` | GET | - |

### Tasks

| Endpoint | Method |
|----------|--------|
| `/api/workflow/:name/task/:task` | GET |
| `/api/workflow/:name/task/:task/logs` | GET |
| `/api/workflow/:name/task/:task/events` | GET |

### Interactive

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/workflow/:name/exec/task/:task` | POST | Create terminal session |
| `/api/workflow/:name/task/:task/exec/:session` | POST | Execute command |
| `/api/workflow/:name/webserver/:task` | POST | Create port forward |

### Infrastructure

| Endpoint | Method | Pagination |
|----------|--------|------------|
| `/api/pool` | GET | - |
| `/api/pool/:name` | GET | - |
| `/api/pool/:name/resources` | GET | offset/limit |
| `/api/resources` | GET | - |

### Storage

| Endpoint | Method |
|----------|--------|
| `/api/bucket` | GET |
| `/api/bucket/:name` | GET |
| `/api/bucket/:name/list` | GET |
| `/api/bucket/list_dataset` | GET |

### Profile

| Endpoint | Method |
|----------|--------|
| `/api/profile` | GET |
| `/api/profile/settings` | GET/PUT |

---

## Memory Budget

| Component | Size | Notes |
|-----------|------|-------|
| Patterns (MOCK_CONFIG) | ~5KB | Loaded once |
| Faker instance | ~1MB | Shared |
| Page generation | ~50KB | Per request, GC'd |
| **Total (steady state)** | **~1MB** | Constant |

Compare to storing 100k workflows: ~500MB+

---

## Customizing Patterns

Edit `src/mocks/seed/types.ts`:

```typescript
export const MOCK_CONFIG: MockConfig = {
  volume: {
    workflows: 10_000,  // Total workflows
    pools: 10,          // Number of pools
    resourcesPerPool: 50,
  },
  
  workflows: {
    statusDistribution: {
      RUNNING: 0.25,
      COMPLETED: 0.40,
      FAILED: 0.15,
      WAITING: 0.10,
      // ...
    },
    pools: ["training-pool", "inference-pool", "preemptible"],
    users: ["alice", "bob", "charlie"],
    // ...
  },
  
  // ... more patterns
};
```

---

## Browser Console API

```javascript
// Check mock status
localStorage.getItem("mockApi")

// Enable mocks
localStorage.setItem("mockApi", "true")
location.reload()

// Disable mocks
localStorage.removeItem("mockApi")
location.reload()
```

---

## Checklist

### Initial Setup (Done!)

- [x] Install MSW: `pnpm add -D msw`
- [x] Install Faker: `pnpm add -D @faker-js/faker`
- [x] Initialize MSW: `npx msw init public/ --save`
- [x] Create `src/mocks/` structure
- [x] Create all generators
- [x] Add handlers for all endpoints
- [x] Add `dev:mock` script

### Before Each Session

- [ ] Run `pnpm dev:mock`
- [ ] Verify pages load with mock data
- [ ] Test pagination behavior

---

## Related Docs

- [Mock Entity Reference](./MOCK_ENTITY_REFERENCE.md) - Detailed generator API
- [Offline LLM Setup](./OFFLINE_LLM_SETUP.md) - Using local LLMs
- [UI Patterns Reference](./UI_PATTERNS_REFERENCE.md) - Design patterns
- [Workflows Design](../WORKFLOWS_DESIGN.md) - Workflow page design

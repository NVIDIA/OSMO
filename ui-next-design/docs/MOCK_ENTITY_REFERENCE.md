# Mock Entity Reference

Comprehensive reference for all mock data generators used in hermetic UI development.

## Architecture

All generators follow these key principles:

### 1. Spec-Coupled Types

Generators import status enums directly from `@/lib/api/generated.ts` to prevent drift:

```typescript
// Imports from generated API spec
import { WorkflowStatus, TaskGroupStatus } from "@/lib/api/generated";
```

### 2. Deterministic Generation

Same index/name always produces the same data:

```typescript
generate(index: number): MockWorkflow {
  // Seed faker deterministically
  faker.seed(this.config.baseSeed + index);
  // ... generation is now reproducible
}
```

### 3. Memory-Efficient Infinite Streaming

No data is stored in memory. Items are regenerated on each request:

```typescript
generatePage(offset: number, limit: number) {
  const entries = [];
  // Only generate items for the requested page
  for (let i = offset; i < offset + limit && i < total; i++) {
    entries.push(this.generate(i));
  }
  return { entries, total };
}
```

### 4. Configurable Volume

Adjust total items for pagination boundary testing:

```typescript
import { setWorkflowTotal } from "@/mocks/generators";

// Test with 1 million workflows
setWorkflowTotal(1_000_000);
```

---

## Generators

### WorkflowGenerator

**Location:** `src/mocks/generators/workflow-generator.ts`

**Types (spec-coupled):**
- `WorkflowStatus` - from generated spec
- `TaskGroupStatus` - from generated spec

**Types (mock-specific):**
- `MockWorkflow` - workflow with groups and tasks
- `MockGroup` - task group with DAG edges
- `MockTask` - individual task with resources
- `Priority` - LOW | NORMAL | HIGH

**Methods:**
```typescript
workflowGenerator.generate(index)           // Single workflow at index
workflowGenerator.generatePage(offset, limit) // Paginated list
workflowGenerator.getByName(name)           // Lookup by name
workflowGenerator.total                     // Get/set total count
```

**Default Volume:** 10,000 workflows

**Example:**
```typescript
// Page 5, 20 items per page
const { entries, total } = workflowGenerator.generatePage(100, 20);
// entries.length = 20, total = 10000

// For stress testing
setWorkflowTotal(100_000);
```

---

### TaskGenerator

**Location:** `src/mocks/generators/task-generator.ts`

**Types:**
- `MockTaskDetail` - detailed task with container info, env, logs/events URLs

**Methods:**
```typescript
taskGenerator.generate(workflowName, taskName, groupName?)
```

**Key Features:**
- Deterministic based on workflow+task name
- Includes pod info, container image, command/args
- Exit codes and failure reasons for failed tasks

---

### PoolGenerator

**Location:** `src/mocks/generators/pool-generator.ts`

**Types (spec-coupled):**
- `Pool` - from generated spec
- `PoolStatus` - ONLINE | OFFLINE | MAINTENANCE

**Types (mock-specific):**
- `PoolWithUsage` - pool with resource usage metrics

**Methods:**
```typescript
poolGenerator.generate(index)           // Single pool at index
poolGenerator.generatePage(offset, limit) // Paginated list
poolGenerator.generateAll()              // All pools (use generatePage for large)
poolGenerator.getByName(name)            // Lookup
poolGenerator.getPoolNames()             // List of names
poolGenerator.total                      // Get/set total count
```

**Configuration:**
```typescript
import { setPoolTotal } from "@/mocks/generators";
setPoolTotal(1000); // Now 1000 pools available
```

**Default Volume:** 50 pools

---

### ResourceGenerator

**Location:** `src/mocks/generators/resource-generator.ts`

**Types:**
- `MockResource` - compute node with GPU/CPU/memory
- `ResourceStatus` - AVAILABLE | IN_USE | CORDONED | DRAINING | OFFLINE

**Methods:**
```typescript
// Per-pool resources
resourceGenerator.generate(poolName, index)
resourceGenerator.generatePage(poolName, offset, limit)
resourceGenerator.generateForPool(poolName)

// Global resources (across all pools)
resourceGenerator.generateGlobal(index, poolNames)
resourceGenerator.generateGlobalPage(poolNames, offset, limit)
resourceGenerator.generateAll(poolNames)

// Configuration
resourceGenerator.perPool = 1000;      // Resources per pool
resourceGenerator.totalGlobal = 50000; // Total across all pools
```

**Configuration:**
```typescript
import { setResourcePerPool, setResourceTotalGlobal } from "@/mocks/generators";
setResourcePerPool(1000);      // 1000 resources per pool
setResourceTotalGlobal(50000); // 50,000 total resources
```

**Default Volume:** 50 resources per pool

---

### LogGenerator

**Location:** `src/mocks/generators/log-generator.ts`

**Types:**
- `GeneratedLogLine` - timestamp, level, source, message

**Methods:**
```typescript
logGenerator.generateWorkflowLogs(name, taskNames, status)
logGenerator.generateTaskLogs(workflow, task, status, duration?)
```

**Features:**
- OSMO lifecycle messages ([osmo] prefixed)
- Training metrics (loss, accuracy, epochs)
- Error messages matching failure type
- Realistic timestamps

---

### EventGenerator

**Location:** `src/mocks/generators/event-generator.ts`

**Types:**
- `GeneratedEvent` - K8s-style event

**Methods:**
```typescript
eventGenerator.generateWorkflowEvents(name, status, submitTime, startTime?, endTime?)
eventGenerator.generateTaskEvents(workflow, task, status, startTime?, endTime?)
```

**Event Types:**
- Scheduling: Scheduled, Pulling, Pulled, Created
- Execution: Started, Running
- Completion: Completed, Succeeded
- Failure: Failed, OOMKilled, Evicted, Preempted, BackOff

---

### BucketGenerator

**Location:** `src/mocks/generators/bucket-generator.ts`

**Types:**
- `GeneratedBucket` - storage bucket
- `GeneratedArtifact` - object/file in bucket
- `GeneratedArtifactList` - paginated artifact listing

**Methods:**
```typescript
bucketGenerator.generateBucket(index)
bucketGenerator.generateBucketPage(offset, limit)
bucketGenerator.generateAllBuckets()
bucketGenerator.generateWorkflowArtifacts(bucket, workflow, limit, offset)
bucketGenerator.getBucketByName(name)
bucketGenerator.totalBuckets = 1000; // Set total
```

**Configuration:**
```typescript
import { setBucketTotal } from "@/mocks/generators";
setBucketTotal(1000); // Now 1000 buckets available
```

**Artifact Types:** checkpoint, model, log, config, metrics

**Default Volume:** 50 buckets

---

### DatasetGenerator

**Location:** `src/mocks/generators/dataset-generator.ts`

**Types:**
- `GeneratedDataset` - dataset metadata
- `GeneratedDatasetVersion` - version history
- `GeneratedDatasetCollection` - grouped datasets

**Methods:**
```typescript
datasetGenerator.generate(index)
datasetGenerator.generatePage(offset, limit)
datasetGenerator.generateVersions(name, count?)
datasetGenerator.generateAll(count?)
datasetGenerator.generateCollection(index)
datasetGenerator.generateCollectionPage(offset, limit)
datasetGenerator.generateCollections()
datasetGenerator.getByName(name)
datasetGenerator.totalDatasets = 1000; // Set total
```

**Configuration:**
```typescript
import { setDatasetTotal } from "@/mocks/generators";
setDatasetTotal(1000); // Now 1000 datasets available
```

**Default Volume:** 100 datasets, 20 collections

---

### ProfileGenerator

**Location:** `src/mocks/generators/profile-generator.ts`

**Types:**
- `GeneratedProfile` - user profile
- `GeneratedProfileSettings` - user preferences
- `GeneratedApiKey` - API key metadata

**Methods:**
```typescript
profileGenerator.generateProfile(username?)
profileGenerator.generateSettings(username?)
profileGenerator.generateApiKeys(count)
```

---

### PortForwardGenerator

**Location:** `src/mocks/generators/portforward-generator.ts`

**Types:**
- `GeneratedPortForwardSession` - active tunnel
- `GeneratedPortForwardRequest` - create request
- `GeneratedPortForwardResponse` - create response

**Methods:**
```typescript
portForwardGenerator.createSession(workflow, task, port)
portForwardGenerator.getSession(sessionId)
portForwardGenerator.getWorkflowSessions(workflow)
portForwardGenerator.closeSession(sessionId)
portForwardGenerator.getCommonPorts()
```

**Common Ports:** 8080 (HTTP), 8888 (Jupyter), 6006 (TensorBoard), etc.

---

### TerminalSimulator

**Location:** `src/mocks/generators/terminal-simulator.ts`

**Types:**
- `TerminalSession` - shell session state
- `CommandResult` - stdout/stderr/exit_code

**Methods:**
```typescript
terminalSimulator.createSession(workflow, task)
terminalSimulator.executeCommand(sessionId, command)
terminalSimulator.getSession(sessionId)
terminalSimulator.closeSession(sessionId)
terminalSimulator.getPrompt(session)
```

**Simulated Commands:**
- File system: `ls`, `pwd`, `cd`, `cat`
- System: `whoami`, `hostname`, `date`, `env`
- GPU: `nvidia-smi`
- Python: `python --version`, `pip list`
- Terminal: `clear`, `exit`, `help`

---

## Volume Presets

```typescript
import { DEFAULT_VOLUME, HIGH_VOLUME, LOW_VOLUME } from "@/mocks/generators";

DEFAULT_VOLUME  // 10,000 workflows
HIGH_VOLUME     // 100,000 workflows
LOW_VOLUME      // 100 workflows
```

---

## Testing Pagination

### Browser Console

```javascript
// Configure for stress testing (in mock mode)
__mockConfig.setWorkflowTotal(100000)
__mockConfig.setPoolTotal(1000)
__mockConfig.setResourcePerPool(10000)
__mockConfig.setResourceTotalGlobal(10000000)
__mockConfig.setBucketTotal(10000)
__mockConfig.setDatasetTotal(50000)

// Check volumes
__mockConfig.getVolumes()
```

### In Code (tests, modules)

```typescript
import {
  setWorkflowTotal,
  setPoolTotal,
  workflowGenerator,
  poolGenerator,
  resourceGenerator,
  bucketGenerator,
  datasetGenerator,
} from "@/mocks/generators";

// Configure for stress testing
setWorkflowTotal(100_000);
setPoolTotal(1_000);

// All endpoints now support infinite pagination
workflowGenerator.generatePage(99_000, 20);  // Workflows
poolGenerator.generatePage(900, 20);          // Pools
resourceGenerator.generatePage("pool-1", 9000, 20); // Per-pool resources
bucketGenerator.generateBucketPage(9000, 20); // Buckets
datasetGenerator.generatePage(40_000, 20);    // Datasets
```

---

## API Endpoints

All handlers in `src/mocks/handlers.ts`:

| Endpoint | Generator | Pagination |
|----------|-----------|------------|
| `GET /api/workflow` | WorkflowGenerator | ✅ offset/limit |
| `GET /api/workflow/:name` | WorkflowGenerator | - |
| `GET /api/workflow/:name/logs` | LogGenerator | - |
| `GET /api/workflow/:name/events` | EventGenerator | - |
| `GET /api/workflow/:name/spec` | (inline YAML) | - |
| `GET /api/workflow/:name/task/:task` | TaskGenerator | - |
| `GET /api/workflow/:name/task/:task/logs` | LogGenerator | - |
| `GET /api/workflow/:name/task/:task/events` | EventGenerator | - |
| `POST /api/workflow/:name/exec/task/:task` | TerminalSimulator | - |
| `POST /api/workflow/:name/webserver/:task` | PortForwardGenerator | - |
| `GET /api/pool` | PoolGenerator | ✅ offset/limit |
| `GET /api/pool/:name` | PoolGenerator | - |
| `GET /api/pool/:name/resources` | ResourceGenerator | ✅ offset/limit |
| `GET /api/resources` | ResourceGenerator | ✅ offset/limit (global) |
| `GET /api/bucket` | BucketGenerator | ✅ offset/limit |
| `GET /api/bucket/:name/list` | BucketGenerator | ✅ offset/limit |
| `GET /api/bucket/list_dataset` | DatasetGenerator | ✅ offset/limit |
| `GET /api/bucket/collections` | DatasetGenerator | ✅ offset/limit |
| `GET /api/profile` | ProfileGenerator | - |
| `GET /api/profile/settings` | ProfileGenerator | - |

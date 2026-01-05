// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// SPDX-License-Identifier: Apache-2.0

/**
 * Mock Data Generators
 *
 * All generators use status enums from @/lib/api/generated.ts to prevent drift.
 * Generation is deterministic and memory-efficient (on-demand, not stored).
 *
 * Key properties for infinite streaming:
 * - Same index/name always produces the same data (deterministic)
 * - Supports "infinite" pagination (bounded only by configured total)
 * - No items stored in memory - regenerated on each request
 * - Efficient for testing pagination boundaries
 */

// ============================================================================
// Core Workflow Entities
// ============================================================================

export {
  WorkflowGenerator,
  workflowGenerator,
  setWorkflowTotal,
  getWorkflowTotal,
  // Re-exported generated enums
  WorkflowStatus,
  TaskGroupStatus,
  // Mock types
  type MockWorkflow,
  type MockGroup,
  type MockTask,
  type Priority,
} from "./workflow-generator";

export { TaskGenerator, taskGenerator, type MockTaskDetail } from "./task-generator";

// ============================================================================
// Infrastructure (all support infinite pagination)
// ============================================================================

export {
  PoolGenerator,
  poolGenerator,
  setPoolTotal,
  getPoolTotal,
  PoolStatus,
  type PoolResourceUsage,
  type PoolResponse,
} from "./pool-generator";

export {
  ResourceGenerator,
  resourceGenerator,
  setResourcePerPool,
  getResourcePerPool,
  setResourceTotalGlobal,
  getResourceTotalGlobal,
} from "./resource-generator";

// ============================================================================
// Observability
// ============================================================================

export { LogGenerator, logGenerator, type GeneratedLogLine } from "./log-generator";

export { EventGenerator, eventGenerator, type GeneratedEvent } from "./event-generator";

// ============================================================================
// Storage (all support infinite pagination)
// ============================================================================

export {
  BucketGenerator,
  bucketGenerator,
  setBucketTotal,
  getBucketTotal,
  type GeneratedBucket,
  type GeneratedArtifact,
  type GeneratedArtifactList,
} from "./bucket-generator";

export {
  DatasetGenerator,
  datasetGenerator,
  setDatasetTotal,
  getDatasetTotal,
  type GeneratedDataset,
  type GeneratedDatasetVersion,
  type GeneratedDatasetCollection,
} from "./dataset-generator";

// ============================================================================
// User & Profile
// ============================================================================

export {
  ProfileGenerator,
  profileGenerator,
  type GeneratedProfile,
  type GeneratedProfileSettings,
  type GeneratedApiKey,
} from "./profile-generator";

// ============================================================================
// Interactive Features
// ============================================================================

export {
  PortForwardGenerator,
  portForwardGenerator,
  type GeneratedPortForwardSession,
  type GeneratedPortForwardRequest,
  type GeneratedPortForwardResponse,
} from "./portforward-generator";

export { TerminalSimulator, terminalSimulator, type TerminalSession, type CommandResult } from "./terminal-simulator";

// ============================================================================
// Configuration (from seed)
// ============================================================================

export { MOCK_CONFIG, DEFAULT_VOLUME, HIGH_VOLUME, LOW_VOLUME } from "../seed";

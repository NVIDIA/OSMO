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
 * Mock Data Generators - Public API
 *
 * This module exports only what is actively used by handlers and tests.
 * Generators are singletons with deterministic seeding for reproducible data.
 *
 * Internal implementation details (classes, types) are NOT exported here.
 * This keeps the public API clean and makes it easier to refactor internals.
 */

// =============================================================================
// Singleton Instances (used by handlers)
// =============================================================================

export { workflowGenerator } from "./workflow-generator";
export { poolGenerator } from "./pool-generator";
export { resourceGenerator } from "./resource-generator";
export { logGenerator } from "./log-generator";
export { eventGenerator } from "./event-generator";
export { bucketGenerator } from "./bucket-generator";
export { datasetGenerator } from "./dataset-generator";
export { profileGenerator } from "./profile-generator";
export { portForwardGenerator } from "./portforward-generator";
export { ptySimulator, type PTYSession, type PTYScenario } from "./pty-simulator";

// =============================================================================
// Volume Setters/Getters (used by mock-config server action)
// =============================================================================

export { setWorkflowTotal, getWorkflowTotal } from "./workflow-generator";
export { setPoolTotal, getPoolTotal } from "./pool-generator";
export {
  setResourcePerPool,
  getResourcePerPool,
  setResourceTotalGlobal,
  getResourceTotalGlobal,
} from "./resource-generator";
export { setBucketTotal, getBucketTotal } from "./bucket-generator";
export { setDatasetTotal, getDatasetTotal } from "./dataset-generator";

// =============================================================================
// Log Scenarios (used by handlers and scenario-selector UI)
// =============================================================================

export { getLogScenario, getLogScenarioNames, type LogScenarioName } from "./log-scenarios";

// =============================================================================
// Configuration (used by generators internally)
// =============================================================================

export { MOCK_CONFIG } from "../seed";

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
 * Mock Data Configuration
 *
 * Exports patterns and volume settings for synthetic data generation.
 */

export {
  // Volume presets
  DEFAULT_VOLUME,
  HIGH_VOLUME,
  LOW_VOLUME,
  // Pattern configurations
  DEFAULT_WORKFLOW_PATTERNS,
  DEFAULT_POOL_PATTERNS,
  DEFAULT_RESOURCE_PATTERNS,
  DEFAULT_TASK_PATTERNS,
  DEFAULT_LOG_PATTERNS,
  DEFAULT_EVENT_PATTERNS,
  DEFAULT_IMAGE_PATTERNS,
  // Combined config
  MOCK_CONFIG,
  // Types
  type MockVolume,
  type WorkflowPatterns,
  type PoolPatterns,
  type ResourcePatterns,
  type TaskPatterns,
  type LogPatterns,
  type EventPatterns,
  type ImagePatterns,
  type MockConfig,
} from "./types";

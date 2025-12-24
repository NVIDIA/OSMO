// Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

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

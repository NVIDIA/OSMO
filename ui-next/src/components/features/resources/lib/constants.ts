/**
 * Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
 */

// Panel snap presets for quick width adjustments
export const PANEL = {
  WIDTH_PRESETS: [33, 50, 75] as const,
  MIN_WIDTH_PCT: 20,
  MAX_WIDTH_PCT: 80,
} as const;

// Layout constants
export const LAYOUT = {
  HEADER_HEIGHT: 41,
  ROW_HEIGHT: 48,
  ROW_HEIGHT_COMPACT: 32,
} as const;

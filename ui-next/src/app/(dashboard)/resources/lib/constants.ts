/**
 * Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
 */

// Re-export PANEL from canonical location
export { PANEL } from "@/lib/constants/ui";

// Layout constants specific to resources table
export const LAYOUT = {
  HEADER_HEIGHT: 41,
  ROW_HEIGHT: 48,
  ROW_HEIGHT_COMPACT: 32,
} as const;

// Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

/**
 * Shared Panel Components
 *
 * Components used across workflow, group, and task views.
 */

export { DetailsPanel } from "./DetailsPanel";
export { DetailsPanelHeader, ColumnMenuContent } from "./DetailsPanelHeader";
export type { HeaderViewType } from "./DetailsPanelHeader";
export { Timeline, parseTime, createPhaseDurationCalculator } from "./Timeline";
export type { TimelinePhase } from "./Timeline";
export { DependencyPills } from "./DependencyPills";

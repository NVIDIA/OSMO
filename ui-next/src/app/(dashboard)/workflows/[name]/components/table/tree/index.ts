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
 * Tree Components Index
 *
 * Exports for tree visualization in the workflow tasks table.
 *
 * ## Component Summary
 *
 * - **TreeConnector**: Task row connector (three modes: single-task, last, middle)
 * - **TreeGroupCell**: Group row expand/collapse control with conditional vertical line
 * - **TreeExpandIndicator**: Visual-only expand/collapse indicator (extracted from TreeGroupCell)
 * - **SplitGroupHeader**: Split-button pattern for group headers with expand + details actions
 * - **GroupNameCell**: Group name display with badge and task count
 * - **TaskNameCell**: Task name with optional indentation and Lead badge
 *
 * ## Usage
 *
 * ```tsx
 * import {
 *   TreeConnector,
 *   TreeGroupCell,
 *   TreeExpandIndicator,
 *   SplitGroupHeader,
 *   GroupNameCell,
 *   TaskNameCell,
 * } from "./tree";
 * ```
 */

export { TreeConnector, type TreeConnectorProps } from "./TreeConnector";
export { TreeGroupCell, type TreeGroupCellProps } from "./TreeGroupCell";
export { TreeExpandIndicator, type TreeExpandIndicatorProps } from "./TreeExpandIndicator";
export { SplitGroupHeader, type SplitGroupHeaderProps } from "./SplitGroupHeader";
export { GroupNameCell, type GroupNameCellProps } from "./GroupNameCell";
export { TaskNameCell, type TaskNameCellProps } from "./TaskNameCell";
export { CORNER_RADIUS, LINE_WIDTH, CIRCLE_SIZE, ICON_SIZE, SINGLE_TASK_CIRCLE_SIZE } from "./tree-constants";

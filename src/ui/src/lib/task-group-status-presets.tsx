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

import { cn } from "@/lib/utils";
import type { SearchPreset, PresetRenderProps } from "@/components/filter-bar/lib/types";
import { presetPillClasses } from "@/components/filter-bar/lib/preset-pill";
import type { SearchChip } from "@/stores/types";
import { TaskGroupStatus } from "@/lib/api/generated";
import { TASK_STATUS_METADATA } from "@/lib/api/status-metadata.generated";
import { WORKFLOW_STATUS_UI_STYLES } from "@/lib/workflows/workflow-status-primitives";
import { WORKFLOW_STATUS_ICONS } from "@/lib/workflows/workflow-status-icons";

export type TaskStateCategory = "completed" | "running" | "failed" | "waiting";

export const TASK_STATE_CATEGORY_ORDER: readonly TaskStateCategory[] = ["running", "waiting", "completed", "failed"];

function buildTaskStateCategories(): Record<TaskStateCategory, TaskGroupStatus[]> {
  const cats: Record<TaskStateCategory, TaskGroupStatus[]> = {
    completed: [],
    running: [],
    failed: [],
    waiting: [],
  };
  for (const [status, meta] of Object.entries(TASK_STATUS_METADATA)) {
    switch (meta.category) {
      case "completed":
        cats.completed.push(status as TaskGroupStatus);
        break;
      case "running":
        cats.running.push(status as TaskGroupStatus);
        break;
      case "failed":
        cats.failed.push(status as TaskGroupStatus);
        break;
      case "waiting":
      case "pending":
        cats.waiting.push(status as TaskGroupStatus);
        break;
      case "unknown":
        cats.failed.push(status as TaskGroupStatus);
        break;
    }
  }
  return cats;
}

export const TASK_STATE_CATEGORIES: Record<TaskStateCategory, TaskGroupStatus[]> = buildTaskStateCategories();

function buildTaskStateChips(category: TaskStateCategory): SearchChip[] {
  return TASK_STATE_CATEGORIES[category].map((status) => ({
    field: "status",
    value: status,
    label: `status: ${status}`,
  }));
}

export const TASK_GROUP_STATUS_PRESETS: { label: string; items: SearchPreset[] }[] = [
  {
    label: "Status:",
    items: TASK_STATE_CATEGORY_ORDER.map((state) => {
      const styles = WORKFLOW_STATUS_UI_STYLES[state];
      const Icon = WORKFLOW_STATUS_ICONS[state];
      const label = state.charAt(0).toUpperCase() + state.slice(1);
      return {
        id: `state-${state}`,
        chips: buildTaskStateChips(state),
        render: ({ active }: PresetRenderProps) => (
          <span className={presetPillClasses(styles.bg, active)}>
            <Icon className={cn("size-3.5", styles.icon)} />
            <span className={cn("text-xs font-semibold", styles.text)}>{label}</span>
          </span>
        ),
      };
    }),
  },
];

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

import type { SearchChip } from "@/components/filter-bar/lib/types";
import { WorkflowStatus } from "@/lib/api/generated";
import { WORKFLOW_STATUS_METADATA } from "@/lib/api/status-metadata.generated";
import { STATUS_LABELS } from "@/lib/workflows/workflow-constants";

export type StatusPresetId = "running" | "waiting" | "completed" | "failed";

function buildStatusPresets(): Record<StatusPresetId, WorkflowStatus[]> {
  const presets: Record<StatusPresetId, WorkflowStatus[]> = {
    running: [],
    waiting: [],
    completed: [],
    failed: [],
  };

  for (const [status, meta] of Object.entries(WORKFLOW_STATUS_METADATA)) {
    const category = meta.category as StatusPresetId;
    if (category in presets) {
      presets[category].push(status as WorkflowStatus);
    }
  }

  return presets;
}

export const STATUS_PRESETS: Record<StatusPresetId, WorkflowStatus[]> = buildStatusPresets();

export function createPresetChips(presetId: StatusPresetId): SearchChip[] {
  return STATUS_PRESETS[presetId].map((status) => ({
    field: "status",
    value: status,
    label: `Status: ${STATUS_LABELS[status] ?? status}`,
  }));
}

/**
 * Workflow label formatting, draft editing, and validation helpers
 * shared by the detail, resubmit, and submit surfaces.
 */
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

// Mirrors MAX_WORKFLOW_LABELS in src/lib/utils/validation.py.
export const MAX_WORKFLOW_LABELS = 16;

export interface WorkflowLabelDraft {
  key: string;
  value: string;
}

export function validateWorkflowLabelDrafts(labels: WorkflowLabelDraft[]): string | null {
  if (labels.length > MAX_WORKFLOW_LABELS) {
    return `A workflow can have at most ${MAX_WORKFLOW_LABELS} label overrides.`;
  }

  const keys = new Set<string>();
  for (const label of labels) {
    const key = label.key.trim();
    const value = label.value.trim();
    if (!key || !value) {
      return "Every workflow label needs both a key and value.";
    }
    if (keys.has(key)) {
      return `Duplicate workflow label key: ${key}`;
    }
    keys.add(key);
  }
  return null;
}

export function getChangedWorkflowLabelAssignments(
  labels: WorkflowLabelDraft[],
  originalLabels: Record<string, string>,
): string[] {
  return labels
    .map(({ key, value }) => ({ key: key.trim(), value: value.trim() }))
    .filter(({ key, value }) => originalLabels[key] !== value)
    .map(({ key, value }) => `${key}=${value}`);
}

export function sortedWorkflowLabelEntries(labels: Record<string, string> | null | undefined): [string, string][] {
  return Object.entries(labels ?? {}).sort(([left], [right]) => left.localeCompare(right));
}

export function formatWorkflowLabels(labels: Record<string, string> | null | undefined): string {
  const entries = sortedWorkflowLabelEntries(labels);
  if (entries.length === 0) return "—";
  return entries.map(([key, value]) => `${key}=${value}`).join(", ");
}

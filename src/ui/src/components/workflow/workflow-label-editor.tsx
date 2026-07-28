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

"use client";

import { Plus, X } from "lucide-react";
import { Button } from "@/components/shadcn/button";
import { Input } from "@/components/shadcn/input";
import { MAX_WORKFLOW_LABELS, type WorkflowLabelDraft } from "@/lib/workflow-labels";

export interface WorkflowLabelEditorProps {
  labels: WorkflowLabelDraft[];
  onChange: (labels: WorkflowLabelDraft[]) => void;
  disabled?: boolean;
  error?: string | null;
  /** Count of leading drafts seeded from the workflow's own labels; their keys are locked. */
  lockedLabelCount?: number;
}

export function WorkflowLabelEditor({
  labels,
  onChange,
  disabled = false,
  error,
  lockedLabelCount = 0,
}: WorkflowLabelEditorProps) {
  const updateLabel = (index: number, field: keyof WorkflowLabelDraft, value: string) => {
    onChange(labels.map((label, labelIndex) => (labelIndex === index ? { ...label, [field]: value } : label)));
  };

  const removeLabel = (index: number) => {
    onChange(labels.filter((_, labelIndex) => labelIndex !== index));
  };

  return (
    <div className="space-y-3">
      <p className="text-muted-foreground text-xs">
        Per-run overrides take precedence over labels in the workflow specification.
        {lockedLabelCount > 0 &&
          " Existing keys cannot be removed here; edit the workflow specification to remove one."}
      </p>
      {labels.map((label, index) => {
        const keyIsLocked = index < lockedLabelCount;
        return (
          <div
            key={index}
            className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2"
          >
            <Input
              aria-label={`Workflow label key ${index + 1}`}
              placeholder="key"
              value={label.key}
              disabled={disabled || keyIsLocked}
              aria-invalid={Boolean(error)}
              onChange={(event) => updateLabel(index, "key", event.target.value)}
            />
            <Input
              aria-label={`Workflow label value ${index + 1}`}
              placeholder="value"
              value={label.value}
              disabled={disabled}
              aria-invalid={Boolean(error)}
              onChange={(event) => updateLabel(index, "value", event.target.value)}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Remove workflow label ${index + 1}`}
              disabled={disabled || keyIsLocked}
              onClick={() => removeLabel(index)}
            >
              <X
                className="size-4"
                aria-hidden="true"
              />
            </Button>
          </div>
        );
      })}
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label="Add workflow label"
        disabled={disabled || labels.length >= MAX_WORKFLOW_LABELS}
        onClick={() => onChange([...labels, { key: "", value: "" }])}
      >
        <Plus
          className="size-4"
          aria-hidden="true"
        />
        Add workflow label
      </Button>
      {error && (
        <p
          className="text-xs text-red-600 dark:text-red-400"
          role="alert"
        >
          {error}
        </p>
      )}
    </div>
  );
}

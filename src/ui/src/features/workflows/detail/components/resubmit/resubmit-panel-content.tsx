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
 * ResubmitPanelContent - Content for resubmit workflow panel.
 *
 * Contains collapsible sections for spec preview, pool selection,
 * priority selection, and submit/cancel buttons.
 */

"use client";

import { memo, useState, useCallback } from "react";
import { Loader2 } from "lucide-react";
import type { WorkflowQueryResponse } from "@/lib/api/adapter/types";
import { WorkflowPriority } from "@/lib/api/generated";
import { Button } from "@/components/shadcn/button";
import { usePanelFocus } from "@/components/panel/hooks/use-panel-focus";
import { CollapsibleSection } from "@/components/workflow/collapsible-section";
import { PoolPicker } from "@/components/workflow/pool-picker";
import { PriorityPicker, PRIORITY_LABELS } from "@/components/workflow/priority-picker";
import { useSpecData } from "@/features/workflows/detail/hooks/use-spec-data";
import { SpecSection } from "@/features/workflows/detail/components/resubmit/spec-section";
import { useResubmitForm } from "@/features/workflows/detail/components/resubmit/use-resubmit-form";

export interface ResubmitPanelContentProps {
  workflow: WorkflowQueryResponse;
  onClose?: () => void;
}

export const ResubmitPanelContent = memo(function ResubmitPanelContent({
  workflow,
  onClose,
}: ResubmitPanelContentProps) {
  const {
    content: spec,
    isLoading: isSpecLoading,
    error: specError,
    refetch: refetchSpec,
  } = useSpecData(workflow, "yaml");

  const form = useResubmitForm({
    workflow,
    onSuccess: () => {
      onClose?.();
    },
  });

  const focusPanel = usePanelFocus();
  const [poolOpen, setPoolOpen] = useState(true);
  const [priorityOpen, setPriorityOpen] = useState(true);

  // Return focus to panel after priority selection so ESC works
  const handlePriorityChange = useCallback(
    (newPriority: WorkflowPriority) => {
      form.setPriority(newPriority);
      focusPanel();
    },
    [form, focusPanel],
  );

  const handleCancel = useCallback(() => {
    if (form.isPending) return;
    onClose?.();
  }, [form.isPending, onClose]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Scrollable form sections */}
      <div
        className="scrollbar-styled min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-6"
        role="form"
        aria-label="Resubmit workflow form"
      >
        <SpecSection
          spec={form.spec ?? spec}
          originalSpec={spec}
          isLoading={isSpecLoading}
          isModified={form.spec !== undefined && form.spec !== spec}
          onSpecChange={form.setSpec}
          error={specError}
          onRetry={refetchSpec}
        />

        <CollapsibleSection
          step={2}
          title="Target Pool"
          open={poolOpen}
          onOpenChange={setPoolOpen}
          selectedValue={form.pool || undefined}
        >
          <PoolPicker
            pool={form.pool}
            onChange={form.setPool}
          />
        </CollapsibleSection>

        <CollapsibleSection
          step={3}
          title="Priority Level"
          open={priorityOpen}
          onOpenChange={setPriorityOpen}
          selectedValue={PRIORITY_LABELS[form.priority]}
        >
          <PriorityPicker
            priority={form.priority}
            onChange={handlePriorityChange}
          />
        </CollapsibleSection>
      </div>

      {/* Error message */}
      {form.error && (
        <div
          className="mx-6 mb-2 rounded-md bg-red-50 p-3 text-sm text-red-800 dark:bg-red-900/30 dark:text-red-300"
          role="alert"
        >
          {form.error}
        </div>
      )}

      {/* Action buttons */}
      <div className="bg-muted/30 border-border flex gap-3 border-t p-4">
        <Button
          variant="outline"
          className="flex-1"
          onClick={handleCancel}
          disabled={form.isPending}
        >
          Cancel
        </Button>
        <Button
          className="bg-nvidia hover:bg-nvidia-dark focus-visible:ring-nvidia flex-1 text-white disabled:opacity-50"
          disabled={!form.canSubmit}
          onClick={form.handleSubmit}
          aria-label={`Submit workflow ${workflow.name}`}
        >
          {form.isPending ? (
            <>
              <Loader2
                className="size-4 animate-spin"
                aria-hidden="true"
              />
              Submitting...
            </>
          ) : (
            "Submit"
          )}
        </Button>
      </div>
    </div>
  );
});

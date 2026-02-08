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
 * Contains:
 * - YAML spec preview (collapsible)
 * - Pool selection
 * - Priority selection
 * - Submit/Cancel buttons
 */

"use client";

import { memo, useCallback } from "react";
import { Loader2 } from "lucide-react";
import type { WorkflowQueryResponse } from "@/lib/api/adapter/types";
import { Button } from "@/components/shadcn/button";
import { useSpecData } from "@/app/(dashboard)/workflows/[name]/components/panel/workflow/spec/hooks/useSpecData";
import { SpecSection } from "@/app/(dashboard)/workflows/[name]/components/resubmit/sections/SpecSection";
import { PoolSection } from "@/app/(dashboard)/workflows/[name]/components/resubmit/sections/PoolSection";
import { PrioritySection } from "@/app/(dashboard)/workflows/[name]/components/resubmit/sections/PrioritySection";
import { useResubmitForm } from "@/app/(dashboard)/workflows/[name]/components/resubmit/hooks/useResubmitForm";

// =============================================================================
// Types
// =============================================================================

export interface ResubmitPanelContentProps {
  workflow: WorkflowQueryResponse;
  onClose?: () => void;
}

// =============================================================================
// Component
// =============================================================================

export const ResubmitPanelContent = memo(function ResubmitPanelContent({
  workflow,
  onClose,
}: ResubmitPanelContentProps) {
  const { content: spec, isLoading: isSpecLoading } = useSpecData(workflow.name, "yaml");

  const form = useResubmitForm({
    workflow,
    onSuccess: () => {
      onClose?.();
    },
  });

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
          isLoading={isSpecLoading}
          onSpecChange={form.setSpec}
        />
        <PoolSection
          pool={form.pool}
          onChange={form.setPool}
        />
        <PrioritySection
          priority={form.priority}
          onChange={form.setPriority}
        />
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
            "Submit Workflow"
          )}
        </Button>
      </div>
    </div>
  );
});

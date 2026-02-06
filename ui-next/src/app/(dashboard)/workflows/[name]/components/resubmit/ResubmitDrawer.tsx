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
 * ResubmitDrawer - Responsive workflow resubmission container.
 * Sheet on desktop (>=768px), Drawer on mobile. Form state managed
 * by useResubmitForm; prevents closing during pending mutation.
 */

"use client";

import { useCallback, memo, useEffect } from "react";
import { useMediaQuery } from "@react-hookz/web";
import { RotateCw, Loader2 } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/shadcn/sheet";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from "@/components/shadcn/drawer";
import { Button } from "@/components/shadcn/button";
import type { WorkflowQueryResponse } from "@/lib/api/adapter";
import { useSpecData } from "../panel/workflow/spec/hooks/useSpecData";
import { ResubmitDrawerContent } from "./ResubmitDrawerContent";
import { useResubmitForm, type UseResubmitFormReturn } from "./hooks/useResubmitForm";

export interface ResubmitDrawerProps {
  /** Workflow to resubmit */
  workflow: WorkflowQueryResponse;
  /** Whether the drawer is open */
  open: boolean;
  /** Callback when drawer open state changes */
  onOpenChange: (open: boolean) => void;
}

interface SharedContentProps {
  workflow: WorkflowQueryResponse;
  spec: string | null;
  isSpecLoading: boolean;
  form: UseResubmitFormReturn;
  onCancel: () => void;
}

const SharedContent = memo(function SharedContent({
  workflow,
  spec,
  isSpecLoading,
  form,
  onCancel,
}: SharedContentProps) {
  return (
    <>
      <ResubmitDrawerContent
        spec={spec}
        isSpecLoading={isSpecLoading}
        pool={form.pool}
        onPoolChange={form.setPool}
        priority={form.priority}
        onPriorityChange={form.setPriority}
      />

      {form.error && (
        <div
          className="mx-4 mb-2 rounded-md bg-red-50 p-3 text-sm text-red-800 dark:bg-red-900/30 dark:text-red-300"
          role="alert"
        >
          {form.error}
        </div>
      )}

      <div className="bg-muted/30 border-border flex gap-3 border-t p-4">
        <Button
          variant="outline"
          className="flex-1"
          onClick={onCancel}
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
    </>
  );
});

export const ResubmitDrawer = memo(function ResubmitDrawer({ workflow, open, onOpenChange }: ResubmitDrawerProps) {
  const isDesktop = useMediaQuery("(min-width: 768px)");

  const handleSuccess = useCallback(() => onOpenChange(false), [onOpenChange]);

  const form = useResubmitForm({
    workflow,
    onSuccess: handleSuccess,
  });

  const { content: spec, isLoading: isSpecLoading } = useSpecData(workflow.name, "yaml");

  const handleCancel = useCallback(() => {
    if (form.isPending) return;
    onOpenChange(false);
  }, [onOpenChange, form.isPending]);

  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      if (!newOpen && form.isPending) return;
      onOpenChange(newOpen);
      if (!newOpen) {
        form.reset();
      }
    },
    [onOpenChange, form],
  );

  // Prevent Escape key from bubbling to parent panel when drawer is open
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !form.isPending) {
        e.stopPropagation();
      }
    };

    // Capture phase to catch the event before it bubbles
    document.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => {
      document.removeEventListener("keydown", handleKeyDown, { capture: true });
    };
  }, [open, form.isPending]);

  const sharedContent = (
    <SharedContent
      workflow={workflow}
      spec={spec}
      isSpecLoading={isSpecLoading}
      form={form}
      onCancel={handleCancel}
    />
  );

  if (isDesktop) {
    return (
      <Sheet
        open={open}
        onOpenChange={handleOpenChange}
      >
        <SheetContent
          side="right"
          className="flex w-full flex-col gap-0 p-0 sm:max-w-xl"
        >
          <SheetHeader className="gap-1 border-b px-6 py-5">
            <div className="flex items-center gap-3">
              <RotateCw className="text-nvidia size-5 shrink-0" />
              <div className="flex flex-col gap-0.5">
                <SheetTitle className="text-base">Resubmit Workflow</SheetTitle>
                <SheetDescription>
                  Configure and launch{" "}
                  <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">{workflow.name}</code>
                </SheetDescription>
              </div>
            </div>
          </SheetHeader>
          {sharedContent}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Drawer
      open={open}
      onOpenChange={handleOpenChange}
    >
      <DrawerContent className="flex max-h-[85vh] flex-col gap-0">
        <DrawerHeader className="gap-1 border-b px-6 py-5">
          <div className="flex items-center gap-3">
            <RotateCw className="text-nvidia size-5 shrink-0" />
            <div className="flex flex-col gap-0.5">
              <DrawerTitle className="text-base">Resubmit Workflow</DrawerTitle>
              <DrawerDescription>
                Configure and launch{" "}
                <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">{workflow.name}</code>
              </DrawerDescription>
            </div>
          </div>
        </DrawerHeader>
        {sharedContent}
      </DrawerContent>
    </Drawer>
  );
});

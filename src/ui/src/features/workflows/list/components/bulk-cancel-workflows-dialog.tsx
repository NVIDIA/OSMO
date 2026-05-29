// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
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

import { memo, useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Info, XCircle } from "lucide-react";
import { toast } from "sonner";
import { BrandCheckbox } from "@/components/brand-checkbox";
import { Button } from "@/components/shadcn/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/shadcn/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/shadcn/tooltip";
import type { BulkCancelWorkflowResult } from "@/features/workflows/list/lib/actions";
import { bulkCancelWorkflows } from "@/features/workflows/list/lib/actions";
import { useMounted } from "@/hooks/use-mounted";
import { cn } from "@/lib/utils";

interface BulkCancelWorkflowsDialogProps {
  workflowNames: string[];
  selectedCount: number;
  skippedCount: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: (result: BulkCancelWorkflowResult) => void;
}

export const BulkCancelWorkflowsDialog = memo(function BulkCancelWorkflowsDialog({
  workflowNames,
  selectedCount,
  skippedCount,
  open,
  onOpenChange,
  onComplete,
}: BulkCancelWorkflowsDialogProps) {
  const [message, setMessage] = useState("");
  const [force, setForce] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const isMountedRef = useRef(true);
  const cancelableCount = workflowNames.length;
  const mounted = useMounted();

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!open) {
      setMessage("");
      setForce(false);
      setError(null);
    }
  }, [open]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen && isPending) return;
      onOpenChange(nextOpen);
    },
    [isPending, onOpenChange],
  );

  const handleCancel = useCallback(() => {
    if (isPending) return;
    onOpenChange(false);
  }, [isPending, onOpenChange]);

  const handleConfirm = useCallback(() => {
    setError(null);
    startTransition(async () => {
      try {
        const result = await bulkCancelWorkflows(workflowNames, {
          message: message.trim() || undefined,
          force,
        });

        if (!isMountedRef.current) return;

        onComplete(result);
        if (result.failureCount === 0) {
          toast.success("Bulk cancel complete", {
            description: `${result.successCount} cancellation request${result.successCount === 1 ? "" : "s"} accepted.`,
          });
          onOpenChange(false);
          return;
        }

        const firstFailure = result.results.find((entry) => !entry.success);
        const description = `${result.successCount} accepted. ${result.failureCount} failed${
          firstFailure?.error ? `: ${firstFailure.error}` : "."
        }`;
        toast.warning("Bulk cancel partially completed", { description });
        setError(description);
        if (result.successCount > 0) {
          onOpenChange(false);
        }
      } catch (error) {
        if (!isMountedRef.current) return;
        const description = error instanceof Error ? error.message : String(error);
        const errorMessage = description || "Unexpected error";
        setError(errorMessage);
        toast.error("Bulk cancel failed", { description: errorMessage });
      }
    });
  }, [force, message, onComplete, onOpenChange, workflowNames]);

  if (!mounted) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={handleOpenChange}
    >
      <DialogContent showCloseButton={!isPending}>
        <DialogHeader>
          <div className="flex items-start gap-3">
            <XCircle className="mt-0.5 size-6 shrink-0 text-red-600 dark:text-red-400" />
            <div>
              <DialogTitle>Cancel selected workflows?</DialogTitle>
              <DialogDescription className="mt-2">
                OSMO will send cancel requests for {cancelableCount} running or queued{" "}
                {cancelableCount === 1 ? "workflow" : "workflows"}. Terminal workflows stay unchanged.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm dark:border-zinc-800 dark:bg-zinc-900/60">
            <div className="flex justify-between gap-4 py-0.5">
              <span>Selected workflows</span>
              <strong>{selectedCount}</strong>
            </div>
            <div className="flex justify-between gap-4 py-0.5">
              <span>Cancelable</span>
              <strong>{cancelableCount}</strong>
            </div>
            {skippedCount > 0 && (
              <div className="flex justify-between gap-4 py-0.5">
                <span>Skipped</span>
                <strong>{skippedCount} terminal</strong>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <label
              htmlFor="bulk-cancel-message"
              className="text-sm font-medium"
            >
              Reason (Optional)
            </label>
            <textarea
              id="bulk-cancel-message"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Enter cancellation reason..."
              disabled={isPending}
              rows={3}
              className={cn(
                "placeholder:text-muted-foreground border-input focus-visible:border-ring focus-visible:ring-ring/50 w-full resize-y rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50",
              )}
            />
          </div>

          {error && (
            <div className="rounded-md bg-red-50 p-3 text-sm text-red-800 dark:bg-red-900/30 dark:text-red-300">
              {error}
            </div>
          )}

          <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
            <div className="flex items-center gap-2">
              <BrandCheckbox
                id="bulk-force-cancel"
                checked={force}
                onCheckedChange={setForce}
                disabled={isPending}
              />
              <label
                htmlFor="bulk-force-cancel"
                className="text-sm"
              >
                Force cancel
              </label>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground"
                    aria-label="What is force cancel?"
                  >
                    <Info className="size-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="max-w-xs">
                    Cancels each workflow even if it&apos;s already finished or if a previous cancellation is in
                    progress. Use when normal cancel doesn&apos;t work.
                  </p>
                </TooltipContent>
              </Tooltip>
            </div>

            <div className="flex flex-col-reverse gap-2 sm:ml-auto sm:flex-row">
              <Button
                type="button"
                variant="outline"
                onClick={handleCancel}
                disabled={isPending}
              >
                Keep Running
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={handleConfirm}
                disabled={isPending || cancelableCount === 0}
              >
                {isPending
                  ? "Cancelling..."
                  : `Cancel ${cancelableCount} ${cancelableCount === 1 ? "workflow" : "workflows"}`}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
});

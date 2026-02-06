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
 * CancelWorkflowDialog - Confirmation dialog for workflow cancellation
 *
 * Provides:
 * - Optional cancellation message/reason input
 * - Force cancel checkbox with tooltip explanation
 * - Destructive action styling
 * - Error handling and loading states
 * - Toast notification with manual refresh action
 * - Responsive: Drawer on mobile, Dialog on desktop
 * - Blur effect on backdrop overlay
 */

"use client";

import { useState, useCallback, memo } from "react";
import { useMediaQuery } from "@react-hookz/web";
import { XCircle, Info } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/shadcn/dialog";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from "@/components/shadcn/drawer";
import { Button } from "@/components/shadcn/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/shadcn/tooltip";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { cancelWorkflow } from "@/app/(dashboard)/workflows/actions";
import { cn } from "@/lib/utils";

// =============================================================================
// Types
// =============================================================================

export interface CancelWorkflowDialogProps {
  /** Workflow name to cancel */
  workflowName: string;
  /** Whether the dialog is open */
  open: boolean;
  /** Callback when dialog open state changes */
  onOpenChange: (open: boolean) => void;
  /** Optional refetch function for manual refresh in toast */
  onRefetch?: () => void;
}

// =============================================================================
// Shared Content Component
// =============================================================================

interface CancelWorkflowContentProps {
  message: string;
  setMessage: (message: string) => void;
  force: boolean;
  setForce: (force: boolean) => void;
  isPending: boolean;
  error: string | null;
  handleCancel: () => void;
  handleConfirm: () => void;
}

const CancelWorkflowContent = memo(function CancelWorkflowContent({
  message,
  setMessage,
  force,
  setForce,
  isPending,
  error,
  handleCancel,
  handleConfirm,
}: CancelWorkflowContentProps) {
  return (
    <>
      <div className="flex flex-col gap-4 px-4 sm:px-0">
        {/* Reason/Message Input */}
        <div className="flex flex-col gap-2">
          <label
            htmlFor="cancel-message"
            className="text-sm font-medium"
          >
            Reason (Optional)
          </label>
          <textarea
            id="cancel-message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Enter cancellation reason..."
            disabled={isPending}
            rows={3}
            className={cn(
              "placeholder:text-muted-foreground border-input focus-visible:border-ring focus-visible:ring-ring/50 w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50",
              "resize-y",
            )}
          />
        </div>

        {/* Error Display */}
        {error && (
          <div className="rounded-md bg-red-50 p-3 text-sm text-red-800 dark:bg-red-900/30 dark:text-red-300">
            {error}
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-col gap-6 px-4 pb-4 sm:mt-0 sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:px-0 sm:pb-0">
        {/* Force Checkbox */}
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="force-cancel"
            checked={force}
            onChange={(e) => setForce(e.target.checked)}
            disabled={isPending}
            className="border-input size-4 rounded border"
          />
          <label
            htmlFor="force-cancel"
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
                Cancels the workflow even if it&apos;s already finished or if a previous cancellation is in progress.
                Use when normal cancel doesn&apos;t work.
              </p>
            </TooltipContent>
          </Tooltip>
        </div>

        <div className="flex flex-col-reverse gap-2 sm:ml-auto sm:flex-row">
          <Button
            variant="outline"
            onClick={handleCancel}
            disabled={isPending}
          >
            Keep Running
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={isPending}
          >
            {isPending ? "Cancelling..." : "Confirm"}
          </Button>
        </div>
      </div>
    </>
  );
});

// =============================================================================
// Component
// =============================================================================

export const CancelWorkflowDialog = memo(function CancelWorkflowDialog({
  workflowName,
  open,
  onOpenChange,
  onRefetch,
}: CancelWorkflowDialogProps) {
  const [message, setMessage] = useState("");
  const [force, setForce] = useState(false);
  const isDesktop = useMediaQuery("(min-width: 768px)");

  const { execute, isPending, error, resetError } = useServerMutation(cancelWorkflow, {
    onSuccess: () => {
      // Show success toast with manual refresh action
      toast.success("Workflow cancellation initiated", {
        description: "Status will update to FAILED_CANCELED within seconds to minutes.",
        action: onRefetch
          ? {
              label: "Refresh",
              onClick: onRefetch,
            }
          : undefined,
      });

      // Close dialog and reset form
      onOpenChange(false);
      setMessage("");
      setForce(false);
    },
    successMessage: "Workflow cancellation initiated",
    errorMessagePrefix: "Failed to cancel workflow",
  });

  const handleConfirm = useCallback(() => {
    execute(workflowName, {
      message: message.trim() || undefined,
      force,
    });
  }, [execute, workflowName, message, force]);

  const handleCancel = useCallback(() => {
    if (isPending) return; // Prevent closing during mutation
    onOpenChange(false);
    setMessage("");
    setForce(false);
    resetError();
  }, [onOpenChange, isPending, resetError]);

  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      if (!newOpen && isPending) return; // Prevent closing during mutation
      onOpenChange(newOpen);
      if (!newOpen) {
        setMessage("");
        setForce(false);
        resetError();
      }
    },
    [onOpenChange, isPending, resetError],
  );

  if (isDesktop) {
    return (
      <Dialog
        open={open}
        onOpenChange={handleOpenChange}
      >
        <DialogContent showCloseButton={!isPending}>
          <DialogHeader>
            <div className="flex items-center gap-3">
              <XCircle className="size-6 shrink-0 text-red-600 dark:text-red-400" />
              <div className="flex items-baseline gap-2">
                <DialogTitle>Cancel Workflow</DialogTitle>
                <DialogDescription asChild>
                  <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-sm">{workflowName}</code>
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <CancelWorkflowContent
            message={message}
            setMessage={setMessage}
            force={force}
            setForce={setForce}
            isPending={isPending}
            error={error}
            handleCancel={handleCancel}
            handleConfirm={handleConfirm}
          />
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Drawer
      open={open}
      onOpenChange={handleOpenChange}
    >
      <DrawerContent>
        <DrawerHeader>
          <div className="flex items-center gap-3">
            <XCircle className="size-6 shrink-0 text-red-600 dark:text-red-400" />
            <div className="flex items-baseline gap-2">
              <DrawerTitle>Cancel Workflow</DrawerTitle>
              <DrawerDescription asChild>
                <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-sm">{workflowName}</code>
              </DrawerDescription>
            </div>
          </div>
        </DrawerHeader>

        <CancelWorkflowContent
          message={message}
          setMessage={setMessage}
          force={force}
          setForce={setForce}
          isPending={isPending}
          error={error}
          handleCancel={handleCancel}
          handleConfirm={handleConfirm}
        />
      </DrawerContent>
    </Drawer>
  );
});

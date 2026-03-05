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
 * useSubmitWorkflowForm - Form state for the Submit Workflow overlay.
 *
 * Manages: spec (YAML text), pool selection, priority.
 * All edits go through the YAML editor.
 */

"use client";

import { useState, useCallback, useMemo } from "react";
import { toast } from "sonner";
import { useNavigationRouter } from "@/hooks/use-navigation-router";
import { useServices } from "@/contexts/service-context";
import { WorkflowPriority, useSubmitWorkflowApiPoolPoolNameWorkflowPost } from "@/lib/api/generated";
import { useSubmitWorkflowStore } from "@/stores/submit-workflow-store";
import { useProfile } from "@/lib/api/adapter/hooks";
import { usePoolSelection } from "@/components/workflow/use-pool-selection";
import { detectLocalpathUsage, type LocalpathWarnings } from "@/components/submit-workflow/detect-localpath";

/** Extract a human-readable error message from various error shapes. */
function extractErrorMessage(err: unknown): string {
  if (!err) return "Unknown error";
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null) {
    const obj = err as Record<string, unknown>;
    if ("data" in obj && typeof obj.data === "object" && obj.data !== null) {
      const data = obj.data as Record<string, unknown>;
      if ("message" in data && typeof data.message === "string") return data.message;
      if ("detail" in data) {
        if (typeof data.detail === "string") return data.detail;
        if (Array.isArray(data.detail)) {
          return data.detail
            .map((d: unknown) => (typeof d === "object" && d !== null ? (d as Record<string, unknown>).msg : String(d)))
            .join("; ");
        }
      }
    }
  }
  return String(err);
}

/** Validation result tied to the spec that was validated for freshness detection. */
interface ValidationState {
  spec: string;
  ok: boolean;
  error: string | null;
}

export interface UseSubmitWorkflowFormReturn {
  spec: string;
  setSpec: (spec: string) => void;
  pool: string;
  setPool: (pool: string) => void;
  priority: WorkflowPriority;
  setPriority: (priority: WorkflowPriority) => void;
  localpathWarnings: LocalpathWarnings;
  // Submit
  canSubmit: boolean;
  isPending: boolean;
  error: string | null;
  handleSubmit: () => void;
  // Dry run / preview
  isDryRunPending: boolean;
  dryRunSpec: string | null;
  dryRunError: string | null;
  canDryRun: boolean;
  handleDryRun: () => void;
  clearDryRun: () => void;
  // Validation (results are stale when spec changes)
  isValidatePending: boolean;
  validationOk: boolean | null;
  validationError: string | null;
  canValidate: boolean;
  handleValidate: () => void;
  // Lifecycle
  handleClose: () => void;
}

export function useSubmitWorkflowForm(): UseSubmitWorkflowFormReturn {
  const router = useNavigationRouter();
  const close = useSubmitWorkflowStore((s) => s.close);
  const { announcer } = useServices();

  const { profile } = useProfile();
  const defaultPool = profile?.pool.default ?? "";
  const { pool, setPool, resetPool } = usePoolSelection(defaultPool);

  const [spec, setSpec] = useState("");
  const [priority, setPriority] = useState<WorkflowPriority>(WorkflowPriority.NORMAL);
  const [error, setError] = useState<string | null>(null);
  const [dryRunSpec, setDryRunSpec] = useState<string | null>(null);
  const [dryRunError, setDryRunError] = useState<string | null>(null);
  const [validationState, setValidationState] = useState<ValidationState | null>(null);

  // ── Derived values ────────────────────────────────────────────────────────

  const localpathWarnings = useMemo(() => detectLocalpathUsage(spec), [spec]);

  const isValidationFresh = validationState !== null && validationState.spec === spec;
  const validationOk = isValidationFresh ? (validationState.ok ? true : null) : null;
  const validationError = isValidationFresh ? validationState.error : null;

  // ── Mutation hooks ────────────────────────────────────────────────────────

  const { mutate: submitMutate, isPending } = useSubmitWorkflowApiPoolPoolNameWorkflowPost({
    mutation: {
      onSuccess: (response) => {
        if (response.status === 200) {
          const newName = response.data.name;
          toast.success(`Workflow submitted as ${newName}`, {
            action: {
              label: "View Workflow",
              onClick: () => router.push(`/workflows/${newName}`),
            },
          });
          announcer.announce(`Workflow ${newName} submitted successfully`, "polite");
          close();
        }
      },
      onError: (err) => {
        const msg = extractErrorMessage(err);
        setError(msg);
        announcer.announce(`Failed to submit workflow: ${msg}`, "assertive");
      },
    },
  });

  const { mutate: dryRunMutate, isPending: isDryRunPending } = useSubmitWorkflowApiPoolPoolNameWorkflowPost();

  const { mutate: validateMutate, isPending: isValidatePending } = useSubmitWorkflowApiPoolPoolNameWorkflowPost();

  // ── Derived flags ─────────────────────────────────────────────────────────

  const hasLocalpathBlock = localpathWarnings.hasFileLocalpath || localpathWarnings.hasDatasetLocalpath;

  const canSubmit = pool.length > 0 && spec.trim().length > 0 && !isPending && !hasLocalpathBlock;
  const canDryRun =
    pool.length > 0 && spec.trim().length > 0 && !isDryRunPending && !isValidatePending && !hasLocalpathBlock;
  const canValidate = pool.length > 0 && spec.trim().length > 0 && !isDryRunPending && !isValidatePending;

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleSubmit = useCallback(() => {
    if (!canSubmit) return;
    setError(null);
    submitMutate({
      poolName: pool,
      data: { file: spec },
      params: { priority },
    });
  }, [canSubmit, submitMutate, pool, spec, priority]);

  const handleDryRun = useCallback(() => {
    if (!canDryRun) return;
    setDryRunSpec(null);
    setDryRunError(null);
    dryRunMutate(
      {
        poolName: pool,
        data: { file: spec },
        params: { priority, dry_run: true },
      },
      {
        onSuccess: (response) => {
          if (response.status === 200) {
            setDryRunSpec(response.data.spec ?? null);
          }
        },
        onError: (err) => {
          const msg = extractErrorMessage(err);
          setDryRunError(msg);
          announcer.announce(`Preview failed: ${msg}`, "assertive");
        },
      },
    );
  }, [canDryRun, dryRunMutate, pool, spec, priority, announcer]);

  const clearDryRun = useCallback(() => {
    setDryRunSpec(null);
    setDryRunError(null);
  }, []);

  const handleValidate = useCallback(() => {
    if (!canValidate) return;
    const specAtCall = spec;
    setValidationState(null);
    validateMutate(
      {
        poolName: pool,
        data: { file: spec },
        params: { priority, validation_only: true },
      },
      {
        onSuccess: () => {
          setValidationState({ spec: specAtCall, ok: true, error: null });
          announcer.announce("Workflow spec is valid", "polite");
        },
        onError: (err) => {
          const msg = extractErrorMessage(err);
          setValidationState({ spec: specAtCall, ok: false, error: msg });
          announcer.announce(`Validation failed: ${msg}`, "assertive");
        },
      },
    );
  }, [canValidate, validateMutate, pool, spec, priority, announcer]);

  const handleClose = useCallback(() => {
    if (!isPending) {
      setSpec("");
      resetPool();
      setPriority(WorkflowPriority.NORMAL);
      setError(null);
      setDryRunSpec(null);
      setDryRunError(null);
      setValidationState(null);
      close();
    }
  }, [isPending, close, resetPool]);

  return useMemo(
    () => ({
      spec,
      setSpec,
      pool,
      setPool,
      priority,
      setPriority,
      localpathWarnings,
      canSubmit,
      isPending,
      error,
      handleSubmit,
      isDryRunPending,
      dryRunSpec,
      dryRunError,
      canDryRun,
      handleDryRun,
      clearDryRun,
      isValidatePending,
      validationOk,
      validationError,
      canValidate,
      handleValidate,
      handleClose,
    }),
    [
      spec,
      pool,
      setPool,
      priority,
      localpathWarnings,
      canSubmit,
      isPending,
      error,
      handleSubmit,
      isDryRunPending,
      dryRunSpec,
      dryRunError,
      canDryRun,
      handleDryRun,
      clearDryRun,
      isValidatePending,
      validationOk,
      validationError,
      canValidate,
      handleValidate,
      handleClose,
    ],
  );
}

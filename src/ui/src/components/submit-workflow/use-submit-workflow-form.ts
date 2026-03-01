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
 * Manages: spec (YAML text), pool selection, priority, template variable
 * overrides. Extracts template variable names from spec on each change.
 * Calls the submit workflow API on handleSubmit.
 */

"use client";

import { useState, useCallback, useMemo } from "react";
import { toast } from "sonner";
import { useNavigationRouter } from "@/hooks/use-navigation-router";
import { useServices } from "@/contexts/service-context";
import { WorkflowPriority, useSubmitWorkflowApiPoolPoolNameWorkflowPost } from "@/lib/api/generated";
import { useSubmitWorkflowStore } from "@/stores/submit-workflow-store";
import { useProfile, usePool } from "@/lib/api/adapter/hooks";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract unique {{ variable_name }} identifiers from a YAML spec string. */
function extractTemplateVarNames(spec: string): string[] {
  const vars = new Set<string>();
  const regex = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;
  let match;
  while ((match = regex.exec(spec)) !== null) {
    vars.add(match[1]);
  }
  return Array.from(vars);
}

/** Parse the `name:` field from the top level of a YAML spec. */
function extractWorkflowName(spec: string): string {
  const match = spec.match(/^name:\s*(\S+)/m);
  return match?.[1] ?? "";
}

/** Extract a human-readable error message from various error shapes. */
function extractErrorMessage(err: unknown): string {
  if (!err) return "Unknown error";
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null) {
    const obj = err as Record<string, unknown>;
    if ("data" in obj && typeof obj.data === "object" && obj.data !== null) {
      const data = obj.data as Record<string, unknown>;
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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UseSubmitWorkflowFormReturn {
  /** Current YAML spec content */
  spec: string;
  setSpec: (spec: string) => void;
  /** Workflow name derived from spec's `name:` field */
  workflowName: string;
  /** Selected pool name */
  pool: string;
  setPool: (pool: string) => void;
  /** Selected priority */
  priority: WorkflowPriority;
  setPriority: (priority: WorkflowPriority) => void;
  /** Template variable names detected in spec */
  templateVarNames: string[];
  /** User-provided values for template variables */
  templateVarValues: Record<string, string>;
  setTemplateVarValue: (name: string, value: string) => void;
  /** Whether the form can be submitted */
  canSubmit: boolean;
  /** Whether submission is in flight */
  isPending: boolean;
  /** Error message from last submission attempt */
  error: string | null;
  handleSubmit: () => void;
  handleClose: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useSubmitWorkflowForm(): UseSubmitWorkflowFormReturn {
  const router = useNavigationRouter();
  const close = useSubmitWorkflowStore((s) => s.close);
  const { announcer } = useServices();

  const { profile } = useProfile();

  // Validate the profile's default pool exists before using it as the default.
  // usePool returns null if the pool no longer exists or is inaccessible.
  // TanStack Query deduplicates this fetch with PoolPicker's own usePool call.
  const defaultPool = profile?.pool.default ?? "";
  const { pool: validatedPool, isLoading: isValidatingPool } = usePool(defaultPool, !!defaultPool);

  const [spec, setSpec] = useState("");
  // null = use default (profile's default pool, validated); string = user override
  const [poolOverride, setPoolOverride] = useState<string | null>(null);
  const [priority, setPriority] = useState<WorkflowPriority>(WorkflowPriority.NORMAL);

  const pool = useMemo(() => {
    if (poolOverride !== null) return poolOverride;
    if (!defaultPool || isValidatingPool) return "";
    return validatedPool?.name ?? "";
  }, [poolOverride, defaultPool, validatedPool, isValidatingPool]);

  const setPool = useCallback((value: string) => setPoolOverride(value), []);
  const [templateVarValues, setTemplateVarValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const workflowName = useMemo(() => extractWorkflowName(spec), [spec]);
  const templateVarNames = useMemo(() => extractTemplateVarNames(spec), [spec]);

  const setTemplateVarValue = useCallback((name: string, value: string) => {
    setTemplateVarValues((prev) => ({ ...prev, [name]: value }));
  }, []);

  const { mutate, isPending } = useSubmitWorkflowApiPoolPoolNameWorkflowPost({
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

  const canSubmit = pool.length > 0 && spec.trim().length > 0 && !isPending;

  const handleSubmit = useCallback(() => {
    if (!canSubmit) return;
    setError(null);

    const setStringVariables = Object.entries(templateVarValues)
      .filter(([, value]) => value.trim().length > 0)
      .map(([name, value]) => `${name}=${value}`);

    mutate({
      poolName: pool,
      data: {
        file: spec,
        set_string_variables: setStringVariables.length > 0 ? setStringVariables : undefined,
      },
      params: { priority },
    });
  }, [canSubmit, mutate, pool, spec, priority, templateVarValues]);

  const handleClose = useCallback(() => {
    if (!isPending) {
      setSpec("");
      setPoolOverride(null);
      setPriority(WorkflowPriority.NORMAL);
      setTemplateVarValues({});
      setError(null);
      close();
    }
  }, [isPending, close]);

  return useMemo(
    () => ({
      spec,
      setSpec,
      workflowName,
      pool,
      setPool,
      priority,
      setPriority,
      templateVarNames,
      templateVarValues,
      setTemplateVarValue,
      canSubmit,
      isPending,
      error,
      handleSubmit,
      handleClose,
    }),
    [
      spec,
      workflowName,
      pool,
      setPool,
      priority,
      templateVarNames,
      templateVarValues,
      setTemplateVarValue,
      canSubmit,
      isPending,
      error,
      handleSubmit,
      handleClose,
    ],
  );
}

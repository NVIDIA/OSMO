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
 * SpecModal Component
 *
 * Modal dialog to view the workflow spec (YAML/JSON).
 * Fetches spec from API on demand.
 */

"use client";

import { memo, useEffect, useState } from "react";
import { X, Copy, Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/shadcn/dialog";
import { getWorkflowSpecApiWorkflowNameSpecGet } from "@/lib/api/generated";

// =============================================================================
// Types
// =============================================================================

interface SpecModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workflowName: string;
}

// =============================================================================
// Component
// =============================================================================

export const SpecModal = memo(function SpecModal({ open, onOpenChange, workflowName }: SpecModalProps) {
  const [spec, setSpec] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Fetch spec when modal opens
  useEffect(() => {
    if (!open) {
      setSpec(null);
      setError(null);
      return;
    }

    async function fetchSpec() {
      setLoading(true);
      setError(null);
      try {
        const result = await getWorkflowSpecApiWorkflowNameSpecGet(workflowName, { use_template: false });
        // Try to pretty-print if it's JSON
        try {
          const parsed = JSON.parse(result as string);
          setSpec(JSON.stringify(parsed, null, 2));
        } catch {
          // Not JSON, use as-is
          setSpec(result as string);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load spec");
      } finally {
        setLoading(false);
      }
    }

    fetchSpec();
  }, [open, workflowName]);

  // Copy to clipboard
  const handleCopy = async () => {
    if (!spec) return;
    try {
      await navigator.clipboard.writeText(spec);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API failed, ignore
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
    >
      <DialogContent className="max-h-[80vh] max-w-3xl overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Workflow Spec
            {spec && (
              <button
                type="button"
                onClick={handleCopy}
                className={cn(
                  "ml-auto rounded p-1.5",
                  "text-gray-500 hover:bg-gray-100 hover:text-gray-700",
                  "dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200",
                  "transition-colors duration-150",
                )}
                title="Copy to clipboard"
              >
                {copied ? (
                  <Check className="size-4 text-emerald-500" />
                ) : (
                  <Copy className="size-4" />
                )}
              </button>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-auto rounded-md bg-gray-50 p-4 dark:bg-zinc-900">
          {loading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="size-6 animate-spin text-gray-400 dark:text-zinc-500" />
            </div>
          )}

          {error && (
            <div className="py-4 text-center text-red-600 dark:text-red-400">
              {error}
            </div>
          )}

          {spec && (
            <pre className="whitespace-pre-wrap break-words font-mono text-xs text-gray-800 dark:text-zinc-200">
              {spec}
            </pre>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
});

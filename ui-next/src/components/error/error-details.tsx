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

import { useState } from "react";
import { ChevronDown, Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface ErrorDetailsProps {
  /** Error object */
  error: Error;
  /** Optional className for container */
  className?: string;
}

/**
 * Displays error message with collapsible stack trace.
 *
 * Reusable component for consistent error detail display across
 * error.tsx files and inline error components.
 */
export function ErrorDetails({ error, className }: ErrorDetailsProps) {
  const [showStack, setShowStack] = useState(false);
  const [copied, setCopied] = useState(false);

  // Parse stack trace (remove the first line which is the error message)
  const stackLines = error.stack?.split("\n").slice(1).join("\n").trim();

  const copyToClipboard = async () => {
    const fullError = `${error.message}\n\n${stackLines || ""}`.trim();
    await navigator.clipboard.writeText(fullError);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!error.message && !stackLines) return null;

  return (
    <div className={cn("rounded-lg border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-800", className)}>
      {/* Error message */}
      {error.message && (
        <div className="px-4 py-3">
          <p className="font-mono text-sm text-zinc-700 dark:text-zinc-300">{error.message}</p>
        </div>
      )}

      {/* Stack trace (collapsible) */}
      {stackLines && (
        <>
          <div
            className={cn(
              "flex items-center justify-between px-4 py-2",
              error.message && "border-t border-zinc-200 dark:border-zinc-700",
            )}
          >
            <button
              onClick={() => setShowStack(!showStack)}
              className="flex items-center gap-2 text-left text-xs text-zinc-500 transition-colors hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-300"
            >
              <ChevronDown className={cn("h-3 w-3 transition-transform", showStack && "rotate-180")} />
              Stack trace
            </button>
            <button
              onClick={copyToClipboard}
              data-testid="copy-error-button"
              className="flex items-center gap-1 text-xs text-zinc-400 transition-colors hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300"
              title="Copy error details"
            >
              {copied ? (
                <span data-testid="copy-success">
                  <Check className="mr-1 inline h-3 w-3 text-green-500" />
                  <span className="text-green-500">Copied</span>
                </span>
              ) : (
                <>
                  <Copy className="h-3 w-3" />
                  <span>Copy</span>
                </>
              )}
            </button>
          </div>
          {showStack && (
            <pre className="max-h-64 overflow-auto border-t border-zinc-200 px-4 py-3 font-mono text-xs text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
              {stackLines}
            </pre>
          )}
        </>
      )}
    </div>
  );
}

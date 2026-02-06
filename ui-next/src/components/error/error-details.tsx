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

import { ChevronDown, Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCopy } from "@/hooks/use-copy";
import { Card } from "@/components/shadcn/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/shadcn/collapsible";

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
  const { copied, copy } = useCopy();

  // Parse stack trace (remove the first line which is the error message)
  const stackLines = error.stack?.split("\n").slice(1).join("\n").trim();

  const handleCopy = () => {
    const fullError = `${error.message}\n\n${stackLines || ""}`.trim();
    copy(fullError);
  };

  if (!error.message && !stackLines) return null;

  return (
    <Card className={cn("gap-0 py-0", className)}>
      {/* Error message */}
      {error.message && (
        <div className="px-4 py-3">
          <p className="font-mono text-sm">{error.message}</p>
        </div>
      )}

      {/* Stack trace (collapsible) */}
      {stackLines && (
        <Collapsible>
          <div className={cn("flex items-center justify-between px-4 py-2", error.message && "border-border border-t")}>
            <CollapsibleTrigger className="group text-muted-foreground hover:text-foreground flex items-center gap-2 text-left text-xs transition-colors">
              <ChevronDown className="size-3 transition-transform group-data-[state=open]:rotate-180" />
              Stack trace
            </CollapsibleTrigger>
            <button
              onClick={handleCopy}
              data-testid="copy-error-button"
              className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs transition-colors"
              title="Copy error details"
            >
              {copied ? (
                <span
                  data-testid="copy-success"
                  className="flex items-center gap-1 text-emerald-500"
                >
                  <Check className="size-3" />
                  Copied
                </span>
              ) : (
                <>
                  <Copy className="size-3" />
                  Copy
                </>
              )}
            </button>
          </div>
          <CollapsibleContent>
            <pre className="border-border text-muted-foreground max-h-64 overflow-auto border-t px-4 py-3 font-mono text-xs">
              {stackLines}
            </pre>
          </CollapsibleContent>
        </Collapsible>
      )}
    </Card>
  );
}

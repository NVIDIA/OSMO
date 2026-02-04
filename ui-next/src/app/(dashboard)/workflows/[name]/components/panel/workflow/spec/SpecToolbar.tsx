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
 * SpecToolbar - View toggle and action buttons
 *
 * Provides:
 * - Toggle between YAML and Jinja views
 * - Copy button (copies entire content)
 * - Download button (downloads as file)
 */

"use client";

import { memo, useCallback } from "react";
import { Copy, Download, Check, FileCode, Braces } from "lucide-react";
import { Button } from "@/components/shadcn/button";
import { Separator } from "@/components/shadcn/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/shadcn/tooltip";
import { useCopy } from "@/hooks";
import { useServices } from "@/contexts";
import { toast } from "sonner";
import type { SpecView } from "./hooks/useSpecData";

// =============================================================================
// Types
// =============================================================================

export interface SpecToolbarProps {
  /** Current active view */
  activeView: SpecView;
  /** Callback to change view */
  onViewChange: (view: SpecView) => void;
  /** Current content to copy/download */
  content: string | null;
  /** Workflow name for download filename */
  workflowName: string;
  /** Whether Jinja view is available */
  jinjaAvailable?: boolean;
  /** Whether content is loading */
  isLoading?: boolean;
}

// =============================================================================
// Component
// =============================================================================

export const SpecToolbar = memo(function SpecToolbar({
  activeView,
  onViewChange,
  content,
  workflowName,
  jinjaAvailable = true,
  isLoading = false,
}: SpecToolbarProps) {
  const { copied, copy } = useCopy();
  const { announcer } = useServices();

  // Handle copy
  const handleCopy = useCallback(async () => {
    if (!content) return;

    const success = await copy(content);
    const message = activeView === "yaml" ? "YAML spec copied" : "Jinja template copied";
    if (success) {
      toast.success(message);
      announcer.announce(message, "polite");
    } else {
      toast.error("Failed to copy to clipboard");
    }
  }, [content, copy, activeView, announcer]);

  // Handle download
  const handleDownload = useCallback(() => {
    if (!content) return;

    const extension = activeView === "yaml" ? "yaml" : "j2";
    const filename = `${workflowName}-${activeView === "yaml" ? "spec" : "template"}.${extension}`;
    const mimeType = activeView === "yaml" ? "text/yaml" : "text/plain";

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();

    URL.revokeObjectURL(url);
    const downloadMessage = `Downloaded ${filename}`;
    toast.success(downloadMessage);
    announcer.announce(downloadMessage, "polite");
  }, [content, activeView, workflowName, announcer]);

  const hasContent = Boolean(content);

  return (
    <div
      className="border-border bg-muted/30 flex h-11 items-center justify-between border-b px-3"
      role="toolbar"
      aria-label="Spec viewer controls"
    >
      {/* View toggle */}
      <div
        className="flex items-center gap-1"
        role="radiogroup"
        aria-label="View selection"
      >
        <Button
          variant={activeView === "yaml" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => onViewChange("yaml")}
          className="h-7 gap-1.5 px-2.5"
          role="radio"
          aria-checked={activeView === "yaml"}
          disabled={isLoading}
        >
          <FileCode className="size-3.5" />
          YAML
        </Button>
        <Button
          variant={activeView === "jinja" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => onViewChange("jinja")}
          className="h-7 gap-1.5 px-2.5"
          role="radio"
          aria-checked={activeView === "jinja"}
          disabled={isLoading || !jinjaAvailable}
        >
          <Braces className="size-3.5" />
          Jinja
        </Button>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={handleCopy}
              disabled={!hasContent || isLoading}
              aria-label={copied ? "Copied" : "Copy to clipboard"}
            >
              {copied ? <Check className="size-4 text-green-500" /> : <Copy className="size-4" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{copied ? "Copied!" : "Copy to clipboard"}</TooltipContent>
        </Tooltip>

        <Separator
          orientation="vertical"
          className="mx-1 h-5"
        />

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={handleDownload}
              disabled={!hasContent || isLoading}
              aria-label="Download file"
            >
              <Download className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Download as {activeView === "yaml" ? ".yaml" : ".j2"}</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
});

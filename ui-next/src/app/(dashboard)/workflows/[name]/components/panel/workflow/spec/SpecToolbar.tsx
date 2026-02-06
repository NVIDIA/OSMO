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
 * - Toggle between YAML and Template views
 * - Copy button (copies entire content)
 * - Download button (downloads as file)
 */

"use client";

import { memo, useCallback } from "react";
import { Copy, Download, Check, FileCode, Braces, ExternalLink } from "lucide-react";
import { Button } from "@/components/shadcn/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/shadcn/tooltip";
import { useCopy } from "@/hooks/use-copy";
import { useServices } from "@/contexts/service-context";
import { toast } from "sonner";
import { getBasePathUrl } from "@/lib/config";
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
  isLoading = false,
}: SpecToolbarProps) {
  const { copied, copy } = useCopy();
  const { announcer } = useServices();

  // Handle copy
  const handleCopy = useCallback(async () => {
    if (!content) return;

    const success = await copy(content);
    const message = activeView === "yaml" ? "YAML spec copied" : "Template copied";
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

    const filename = `${workflowName}-${activeView === "yaml" ? "spec" : "template"}.yaml`;
    const mimeType = "text/yaml";

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.style.display = "none";

    // Temporarily add to DOM for better browser compatibility
    document.body.appendChild(link);
    link.click();

    // Clean up after download starts
    setTimeout(() => {
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }, 100);

    const downloadMessage = `Downloading ${filename}...`;
    toast.success(downloadMessage);
    announcer.announce(downloadMessage, "polite");
  }, [content, activeView, workflowName, announcer]);

  const hasContent = Boolean(content);

  return (
    <div
      className="border-border contain-layout-style flex h-11 shrink-0 items-center justify-between border-b bg-white px-3 dark:bg-zinc-900"
      role="toolbar"
      aria-label="Spec viewer controls"
    >
      {/* View toggle - left side is naturally stable */}
      <div
        className="flex shrink-0 items-center gap-1"
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
          disabled={isLoading}
        >
          <Braces className="size-3.5" />
          Template
        </Button>
      </div>

      {/* Actions - GPU layer prevents jitter during resize
       * The right side of justify-between layouts is most affected by sub-pixel
       * rounding during resize. Using gpu-layer promotes to compositor layer,
       * eliminating rounding jitter. shrink-0 prevents flex compression.
       */}
      <div className="gpu-layer flex shrink-0 items-center gap-1">
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
          <TooltipContent>{activeView === "yaml" ? "Download spec" : "Download template"}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              asChild
              disabled={!hasContent || isLoading}
              aria-label={`Open raw ${activeView === "yaml" ? "spec" : "template"} in new tab`}
            >
              <a
                href={getBasePathUrl(
                  `/api/workflow/${encodeURIComponent(workflowName)}/spec${activeView === "jinja" ? "?use_template=true" : ""}`,
                )}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink className="size-4" />
              </a>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Open raw {activeView === "yaml" ? "spec" : "template"} in new tab</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
});

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
 * SpecSection - Collapsible YAML spec editor.
 * Always editable when expanded. Shows "Modified" + "Revert" when changed.
 */

"use client";

import { memo, useState, useCallback } from "react";
import { FileCode } from "lucide-react";
import { Skeleton } from "@/components/shadcn/skeleton";
import { Button } from "@/components/shadcn/button";
import { CodeMirror } from "@/components/code-viewer/CodeMirror";
import { YAML_LANGUAGE } from "@/components/code-viewer/lib/extensions";
import { CollapsibleSection } from "@/app/(dashboard)/workflows/[name]/components/resubmit/sections/CollapsibleSection";

export interface SpecSectionProps {
  /** YAML spec content (either modified or original) */
  spec: string | null;
  /** Original unmodified spec from server (for comparison) */
  originalSpec: string | null;
  /** Whether spec data is loading */
  isLoading: boolean;
  /** Whether the spec has been modified from the original */
  isModified?: boolean;
  /**
   * Callback when spec content changes.
   * - Pass the edited spec if it differs from original
   * - Pass undefined if content matches original (signals to use workflow_id)
   */
  onSpecChange?: (spec: string | undefined) => void;
}

const SpecSkeleton = memo(function SpecSkeleton() {
  return (
    <div
      className="space-y-2 rounded-md bg-zinc-900 p-4"
      aria-label="Loading specification"
    >
      <Skeleton className="h-4 w-3/4 bg-zinc-700/50" />
      <Skeleton className="h-4 w-1/2 bg-zinc-700/50" />
      <Skeleton className="h-4 w-5/8 bg-zinc-700/50" />
      <Skeleton className="h-4 w-2/3 bg-zinc-700/50" />
    </div>
  );
});

const SpecEmpty = memo(function SpecEmpty() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed p-6 text-center">
      <FileCode className="text-muted-foreground size-6" />
      <p className="text-muted-foreground text-sm">No specification available</p>
    </div>
  );
});

export const SpecSection = memo(function SpecSection({
  spec,
  originalSpec,
  isLoading,
  isModified = false,
  onSpecChange,
}: SpecSectionProps) {
  const [open, setOpen] = useState(false);
  // Tracks user edits. When undefined, falls through to the spec prop (original or parent-managed).
  const [overrideSpec, setOverrideSpec] = useState<string | undefined>(undefined);
  const editorValue = overrideSpec ?? spec ?? "";

  const handleChange = useCallback(
    (value: string) => {
      setOverrideSpec(value);
      const hasChanged = value !== originalSpec;
      onSpecChange?.(hasChanged ? value : undefined);
    },
    [originalSpec, onSpecChange],
  );

  const handleRevert = useCallback(() => {
    setOverrideSpec(undefined);
    onSpecChange?.(undefined);
  }, [onSpecChange]);

  const action = isModified ? (
    <div className="flex items-center gap-2">
      <span
        className="text-muted-foreground text-xs italic"
        aria-label="Specification has been modified"
      >
        Modified
      </span>
      <Button
        asChild
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs"
        aria-label="Revert to original specification"
      >
        <span
          role="button"
          tabIndex={0}
          onClick={handleRevert}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              handleRevert();
            }
          }}
        >
          Revert
        </span>
      </Button>
    </div>
  ) : undefined;

  let content: React.ReactNode;
  if (isLoading) {
    content = <SpecSkeleton />;
  } else if (!spec) {
    content = <SpecEmpty />;
  } else {
    content = (
      <div className="h-[calc(100vh-22rem)] overflow-hidden rounded-md border border-zinc-800 bg-zinc-950">
        <CodeMirror
          value={editorValue}
          onChange={handleChange}
          language={YAML_LANGUAGE}
          aria-label="YAML specification editor"
          className="h-full"
        />
      </div>
    );
  }

  return (
    <CollapsibleSection
      step={1}
      title="Workflow Specification"
      open={open}
      onOpenChange={setOpen}
      action={action}
    >
      {content}
    </CollapsibleSection>
  );
});

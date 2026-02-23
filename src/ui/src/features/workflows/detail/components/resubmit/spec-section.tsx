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
import dynamic from "next/dynamic";
import { FileCode } from "lucide-react";
import { Button } from "@/components/shadcn/button";
import { YAML_LANGUAGE } from "@/components/code-viewer/lib/languages";
import { CodeViewerSkeleton } from "@/components/code-viewer/code-viewer-skeleton";
import { CollapsibleSection } from "@/features/workflows/detail/components/resubmit/collapsible-section";

const CodeMirror = dynamic(
  () => import("@/components/code-viewer/code-mirror").then((m) => ({ default: m.CodeMirror })),
  { ssr: false, loading: () => <CodeViewerSkeleton className="absolute inset-0" /> },
);

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
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs"
        aria-label="Revert to original specification"
        onClick={handleRevert}
      >
        Revert
      </Button>
    </div>
  ) : undefined;

  let content: React.ReactNode;
  if (isLoading) {
    content = <CodeViewerSkeleton />;
  } else if (!spec) {
    content = <SpecEmpty />;
  } else {
    content = (
      <div className="border-border relative h-[calc(100vh-22rem)] overflow-hidden rounded-md border">
        <CodeMirror
          value={editorValue}
          onChange={handleChange}
          language={YAML_LANGUAGE}
          aria-label="YAML specification editor"
          className="absolute inset-0"
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

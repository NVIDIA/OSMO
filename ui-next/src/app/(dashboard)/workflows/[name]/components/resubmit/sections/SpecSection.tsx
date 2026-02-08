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
 * SpecSection - Collapsible YAML spec viewer/editor.
 * Shows sophisticated CodeMirror-based viewer with syntax highlighting.
 * Switches to editable mode when "Edit" is clicked.
 */

"use client";

import { memo, useState } from "react";
import { FileCode } from "lucide-react";
import { Skeleton } from "@/components/shadcn/skeleton";
import { CodeMirror } from "@/components/code-viewer/CodeMirror";
import { YAML_LANGUAGE } from "@/components/code-viewer/lib/extensions";
import { CollapsibleSection } from "./CollapsibleSection";

export interface SpecSectionProps {
  /** YAML spec content */
  spec: string | null;
  /** Whether spec data is loading */
  isLoading: boolean;
  /** Callback when spec content changes (for edit mode) */
  onSpecChange?: (spec: string) => void;
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

interface SpecContentProps {
  spec: string | null;
  isLoading: boolean;
  isEditing: boolean;
  editedSpec: string;
  onEditedSpecChange: (value: string) => void;
}

function SpecContent({ spec, isLoading, isEditing, editedSpec, onEditedSpecChange }: SpecContentProps) {
  if (isLoading) return <SpecSkeleton />;

  if (!spec) return <SpecEmpty />;

  // Split into edit vs view mode for type safety
  if (isEditing) {
    return (
      <div className="h-96 overflow-hidden rounded-md border border-zinc-800 bg-zinc-950">
        <CodeMirror
          value={editedSpec}
          onChange={onEditedSpecChange}
          language={YAML_LANGUAGE}
          aria-label="YAML specification editor"
          className="h-full"
        />
      </div>
    );
  }

  return (
    <div className="h-72 overflow-hidden rounded-md border border-zinc-800 bg-zinc-950">
      <CodeMirror
        value={spec}
        language={YAML_LANGUAGE}
        aria-label="YAML specification"
        className="h-full"
        readOnly
      />
    </div>
  );
}

export const SpecSection = memo(function SpecSection({ spec, isLoading, onSpecChange }: SpecSectionProps) {
  const [open, setOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editedSpec, setEditedSpec] = useState(spec ?? "");

  const handleEdit = () => {
    setEditedSpec(spec ?? "");
    setIsEditing(true);
    setOpen(true);
  };

  const handleSave = () => {
    onSpecChange?.(editedSpec);
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditedSpec(spec ?? "");
    setIsEditing(false);
  };

  const actionButton = isEditing ? (
    <div className="flex gap-2">
      <span
        onClick={(e) => {
          e.stopPropagation();
          handleCancel();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
            handleCancel();
          }
        }}
        role="button"
        tabIndex={0}
        className="hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring inline-flex h-7 cursor-pointer items-center justify-center rounded-md px-2 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none"
        aria-label="Cancel editing"
      >
        Cancel
      </span>
      <span
        onClick={(e) => {
          e.stopPropagation();
          handleSave();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
            handleSave();
          }
        }}
        role="button"
        tabIndex={0}
        className="bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-ring inline-flex h-7 cursor-pointer items-center justify-center rounded-md px-2 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none"
        aria-label="Save changes"
      >
        Save
      </span>
    </div>
  ) : (
    <span
      onClick={(e) => {
        e.stopPropagation();
        handleEdit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          handleEdit();
        }
      }}
      role="button"
      tabIndex={0}
      className="text-primary hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring inline-flex h-7 cursor-pointer items-center justify-center rounded-md px-2 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none"
      aria-label="Edit workflow specification"
    >
      Edit
    </span>
  );

  return (
    <CollapsibleSection
      step={1}
      title="Workflow Specification"
      open={open}
      onOpenChange={setOpen}
      action={actionButton}
    >
      <SpecContent
        spec={spec}
        isLoading={isLoading}
        isEditing={isEditing}
        editedSpec={editedSpec}
        onEditedSpecChange={setEditedSpec}
      />
    </CollapsibleSection>
  );
});

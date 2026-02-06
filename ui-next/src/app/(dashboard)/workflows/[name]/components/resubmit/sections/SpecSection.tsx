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
 * SpecSection - Collapsible read-only YAML spec viewer.
 * Starts collapsed by default to reduce cognitive load.
 */

"use client";

import { memo, useState } from "react";
import { FileCode } from "lucide-react";
import { Button } from "@/components/shadcn/button";
import { Skeleton } from "@/components/shadcn/skeleton";
import { CollapsibleSection } from "./CollapsibleSection";

export interface SpecSectionProps {
  /** YAML spec content */
  spec: string | null;
  /** Whether spec data is loading */
  isLoading: boolean;
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

function SpecContent({ spec, isLoading }: SpecSectionProps) {
  if (isLoading) return <SpecSkeleton />;

  if (!spec) return <SpecEmpty />;

  return (
    <div
      className="scrollbar-styled max-h-72 overflow-auto rounded-md bg-zinc-900 p-4"
      role="region"
      aria-label="YAML specification preview"
    >
      <pre className="font-mono text-[0.8125rem] leading-relaxed text-zinc-300">
        <code>{spec}</code>
      </pre>
    </div>
  );
}

export const SpecSection = memo(function SpecSection({ spec, isLoading }: SpecSectionProps) {
  const [open, setOpen] = useState(false);

  const editButton = (
    <Button
      variant="ghost"
      size="sm"
      asChild
      className="text-primary h-7 px-2 text-xs font-medium"
      aria-label="Edit workflow specification"
    >
      <span
        onClick={() => setOpen(true)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        Edit
      </span>
    </Button>
  );

  return (
    <CollapsibleSection
      step={1}
      title="Workflow Specification"
      open={open}
      onOpenChange={setOpen}
      action={editButton}
    >
      <SpecContent
        spec={spec}
        isLoading={isLoading}
      />
    </CollapsibleSection>
  );
});

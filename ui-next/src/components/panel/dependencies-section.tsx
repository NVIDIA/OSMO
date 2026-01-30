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
 * DependenciesSection Component
 *
 * Displays upstream and downstream dependencies in a Card container.
 * Follows the same pattern as LinksSection and DetailsSection for visual consistency.
 */

"use client";

import { memo } from "react";
import { ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
import { Card, CardContent } from "@/components/shadcn/card";
import { cn } from "@/lib/utils";

export interface DependencyItem {
  name: string;
  status: string;
}

export interface DependenciesSectionProps {
  title?: string;
  upstreamItems: DependencyItem[];
  downstreamItems: DependencyItem[];
  onSelect?: (name: string) => void;
  className?: string;
  headerClassName?: string;
  /** Render function for pills - allows custom pill implementation */
  renderPill: (item: DependencyItem, onClick?: () => void) => React.ReactNode;
}

interface DependencyRowProps {
  direction: "upstream" | "downstream";
  items: DependencyItem[];
  onSelect?: (name: string) => void;
  renderPill: DependenciesSectionProps["renderPill"];
}

const DependencyRow = memo(function DependencyRow({ direction, items, onSelect, renderPill }: DependencyRowProps) {
  if (items.length === 0) return null;

  const DirectionIcon = direction === "upstream" ? ArrowDownToLine : ArrowUpFromLine;
  const label = direction === "upstream" ? "Upstream" : "Downstream";

  return (
    <div className="p-3">
      <div className="text-muted-foreground mb-2 flex items-center gap-1.5 text-xs font-medium">
        <DirectionIcon className="size-3" />
        <span>{label}</span>
        <span className="text-muted-foreground/60">({items.length})</span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {items.map((item) => (
          <div key={item.name}>{renderPill(item, onSelect ? () => onSelect(item.name) : undefined)}</div>
        ))}
      </div>
    </div>
  );
});

export const DependenciesSection = memo(function DependenciesSection({
  title = "Dependencies",
  upstreamItems,
  downstreamItems,
  onSelect,
  className,
  headerClassName,
  renderPill,
}: DependenciesSectionProps) {
  const hasUpstream = upstreamItems.length > 0;
  const hasDownstream = downstreamItems.length > 0;

  if (!hasUpstream && !hasDownstream) {
    return null;
  }

  return (
    <section className={className}>
      <h3 className={cn("text-muted-foreground mb-2 text-xs font-semibold tracking-wider uppercase", headerClassName)}>
        {title}
      </h3>
      <Card className="gap-0 overflow-hidden py-0">
        <CardContent className="divide-border divide-y p-0">
          <DependencyRow
            direction="upstream"
            items={upstreamItems}
            onSelect={onSelect}
            renderPill={renderPill}
          />
          <DependencyRow
            direction="downstream"
            items={downstreamItems}
            onSelect={onSelect}
            renderPill={renderPill}
          />
        </CardContent>
      </Card>
    </section>
  );
});

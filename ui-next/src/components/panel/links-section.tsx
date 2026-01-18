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
 * LinksSection - Generic external links section.
 *
 * Consolidates the pattern used in WorkflowDetails.Links and
 * TaskDetails.OverviewTab link rendering.
 *
 * @example
 * ```tsx
 * <LinksSection
 *   title="Links"
 *   links={[
 *     { id: 'dashboard', label: 'Dashboard', description: 'Kubernetes details', url: entity.dashboard_url, icon: BarChart3 },
 *     { id: 'grafana', label: 'Grafana', description: 'Metrics & monitoring', url: entity.grafana_url, icon: Activity },
 *   ]}
 * />
 * ```
 */

"use client";

import { memo, useMemo } from "react";
import { ExternalLink, type LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/shadcn/card";
import { cn } from "@/lib/utils";

// =============================================================================
// Types
// =============================================================================

export interface LinkItem {
  /** Unique identifier */
  id: string;
  /** Link label */
  label: string;
  /** Optional description */
  description?: string;
  /** URL (if falsy, link is filtered out) */
  url?: string | null;
  /** Icon component */
  icon: LucideIcon;
}

export interface LinksSectionProps {
  /** Section title */
  title: string;
  /** Links to display (falsy URLs are automatically filtered) */
  links: LinkItem[];
  /** Additional className for the section */
  className?: string;
  /** Header className override */
  headerClassName?: string;
}

// =============================================================================
// Component
// =============================================================================

export const LinksSection = memo(function LinksSection({
  title,
  links,
  className,
  headerClassName,
}: LinksSectionProps) {
  // Filter to only links with valid URLs
  const visibleLinks = useMemo(() => links.filter((link): link is LinkItem & { url: string } => !!link.url), [links]);

  if (visibleLinks.length === 0) {
    return null;
  }

  return (
    <section className={className}>
      <h3 className={cn("text-muted-foreground mb-2 text-xs font-semibold tracking-wider uppercase", headerClassName)}>
        {title}
      </h3>
      <Card className="gap-0 overflow-hidden py-0">
        <CardContent className="divide-border divide-y p-0">
          {visibleLinks.map((link) => {
            const Icon = link.icon;
            return (
              <a
                key={link.id}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:bg-muted/50 flex items-center gap-3 p-3 transition-colors"
              >
                <Icon className="text-muted-foreground size-4 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{link.label}</div>
                  {link.description && <div className="text-muted-foreground text-xs">{link.description}</div>}
                </div>
                <ExternalLink className="text-muted-foreground/50 size-3.5 shrink-0" />
              </a>
            );
          })}
        </CardContent>
      </Card>
    </section>
  );
});

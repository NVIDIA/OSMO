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
 * GroupOverviewTab Component
 *
 * Overview tab content for GroupDetails panel.
 * Displays group timeline, statistics, and dependencies.
 */

"use client";

import { memo, useMemo, useCallback } from "react";
import { AlertCircle } from "lucide-react";
import { Card, CardContent } from "@/components/shadcn/card";
import { DependenciesSection } from "@/components/panel/dependencies-section";
import { GroupTimeline } from "@/app/(dashboard)/workflows/[name]/components/panel/group/GroupTimeline";
import { DependencyPill } from "@/app/(dashboard)/workflows/[name]/components/panel/views/DependencyPills";
import type { GroupWithLayout } from "@/app/(dashboard)/workflows/[name]/lib/workflow-types";

// =============================================================================
// Constants
// =============================================================================

/** Section header styling */
const SECTION_HEADER = "text-muted-foreground mb-2 text-xs font-semibold tracking-wider uppercase";

// =============================================================================
// Component
// =============================================================================

export interface GroupOverviewTabProps {
  /** The group to display */
  group: GroupWithLayout;
  /** All groups in the workflow (for dependency display) */
  allGroups: GroupWithLayout[];
  /** Callback when selecting a different group (for dependency navigation) */
  onSelectGroup?: (groupName: string) => void;
}

export const GroupOverviewTab = memo(function GroupOverviewTab({
  group,
  allGroups,
  onSelectGroup,
}: GroupOverviewTabProps) {
  // Compute upstream/downstream groups for dependencies
  const upstreamGroups = useMemo(
    () => allGroups.filter((g) => g.downstream_groups?.includes(group.name)),
    [allGroups, group.name],
  );

  const downstreamGroups = useMemo(
    () => allGroups.filter((g) => group.downstream_groups?.includes(g.name)),
    [allGroups, group.downstream_groups],
  );

  // Render function for dependency pills
  const renderDependencyPill = useCallback(
    (item: { name: string; status: string }, onClick?: () => void) => {
      const groupData = allGroups.find((g) => g.name === item.name);
      if (!groupData) return null;
      return (
        <DependencyPill
          group={groupData}
          onClick={onClick}
        />
      );
    },
    [allGroups],
  );

  // Check what content we have
  const hasFailureMessage = !!group.failure_message;
  const hasTimeline = !!(group.scheduling_start_time || group.start_time);
  const hasDependencies = upstreamGroups.length > 0 || downstreamGroups.length > 0;

  return (
    <div className="space-y-6 p-4">
      {/* Failure message - prominent at top when present */}
      {hasFailureMessage && (
        <div>
          <h3 className={SECTION_HEADER}>Error</h3>
          <Card className="gap-0 border-red-600/20 bg-red-600/5 py-0 dark:border-red-400/20 dark:bg-red-400/5">
            <CardContent className="flex items-start gap-1.5 p-3 text-xs text-red-600 dark:text-red-400">
              <AlertCircle className="mt-0.5 size-3 shrink-0" />
              <span>{group.failure_message}</span>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Timeline section */}
      {hasTimeline && (
        <div>
          <h3 className={SECTION_HEADER}>Timeline</h3>
          <Card className="gap-0 overflow-hidden py-0">
            <CardContent className="min-w-0 overflow-hidden p-3">
              <GroupTimeline group={group} />
            </CardContent>
          </Card>
        </div>
      )}

      {/* Dependencies section */}
      {hasDependencies && (
        <DependenciesSection
          upstreamItems={upstreamGroups.map((g) => ({ name: g.name, status: g.status }))}
          downstreamItems={downstreamGroups.map((g) => ({ name: g.name, status: g.status }))}
          onSelect={onSelectGroup}
          renderPill={renderDependencyPill}
        />
      )}
    </div>
  );
});

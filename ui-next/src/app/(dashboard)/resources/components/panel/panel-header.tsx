/**
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * ResourcePanelHeader Component
 *
 * Resource-specific header composing from canonical PanelHeader.
 *
 * Layout:
 * Row 1: Title + Resource type badge            [Resource badge] [Menu] [Close]
 * Row 2: Platform · Backend · Pool count
 */

"use client";

import { memo } from "react";
import { Server, Cpu } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Resource } from "@/lib/api/adapter";
import { getResourceAllocationTypeDisplay } from "../../lib/constants";
import { PanelHeader, PanelTitle, PanelHeaderActions, SeparatedParts } from "@/components/panel";

export interface ResourcePanelHeaderProps {
  resource: Resource;
  onClose: () => void;
  onWidthPreset: (pct: number) => void;
}

export const ResourcePanelHeader = memo(function ResourcePanelHeader({
  resource,
  onClose,
  onWidthPreset,
}: ResourcePanelHeaderProps) {
  const resourceTypeDisplay = getResourceAllocationTypeDisplay(resource.resourceType);

  // Build title content with name and resource type badge
  const titleContent = (
    <>
      <PanelTitle>{resource.name}</PanelTitle>
      <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-medium", resourceTypeDisplay.className)}>
        {resourceTypeDisplay.label}
      </span>
    </>
  );

  // Build subtitle content with platform, backend, and pool count
  const subtitleContent = (
    <SeparatedParts>
      <span className="flex items-center gap-1 text-zinc-600 dark:text-zinc-300">
        <Cpu className="size-3" />
        {resource.platform}
      </span>
      <span className="flex items-center gap-1 text-zinc-500 dark:text-zinc-400">
        <Server className="size-3" />
        {resource.backend}
      </span>
      {resource.poolMemberships.length > 0 && (
        <span className="text-zinc-500 dark:text-zinc-400">
          {resource.poolMemberships.length} pool{resource.poolMemberships.length !== 1 ? "s" : ""}
        </span>
      )}
    </SeparatedParts>
  );

  return (
    <PanelHeader
      title={titleContent}
      actions={
        <PanelHeaderActions
          badge="Resource"
          onWidthPreset={onWidthPreset}
          onClose={onClose}
        />
      }
      subtitle={subtitleContent}
    />
  );
});

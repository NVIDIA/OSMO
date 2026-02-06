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
 * ResubmitDrawerContent - Scrollable form body composing the three
 * collapsible sections (Spec, Pool, Priority).
 */

"use client";

import { memo } from "react";
import { WorkflowPriority } from "@/lib/api/generated";
import { SpecSection } from "./sections/SpecSection";
import { PoolSection } from "./sections/PoolSection";
import { PrioritySection } from "./sections/PrioritySection";

export interface ResubmitDrawerContentProps {
  /** YAML spec content (null while loading) */
  spec: string | null;
  /** Whether spec is loading */
  isSpecLoading: boolean;
  /** Selected pool name */
  pool: string;
  /** Callback when pool changes */
  onPoolChange: (pool: string) => void;
  /** Selected priority */
  priority: WorkflowPriority;
  /** Callback when priority changes */
  onPriorityChange: (priority: WorkflowPriority) => void;
}

export const ResubmitDrawerContent = memo(function ResubmitDrawerContent({
  spec,
  isSpecLoading,
  pool,
  onPoolChange,
  priority,
  onPriorityChange,
}: ResubmitDrawerContentProps) {
  return (
    <div
      className="scrollbar-styled flex-1 overflow-y-auto"
      role="form"
      aria-label="Resubmit workflow configuration"
    >
      <SpecSection
        spec={spec}
        isLoading={isSpecLoading}
      />

      <PoolSection
        pool={pool}
        onChange={onPoolChange}
      />

      <PrioritySection
        priority={priority}
        onChange={onPriorityChange}
      />
    </div>
  );
});

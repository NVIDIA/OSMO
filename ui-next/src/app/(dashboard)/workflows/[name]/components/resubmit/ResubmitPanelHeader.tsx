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
 * ResubmitPanelHeader - Header for resubmit workflow panel.
 *
 * Layout:
 * Row 1: Icon · Title                                      [Close]
 * Row 2: Workflow name code snippet
 */

"use client";

import { memo } from "react";
import { RotateCw } from "lucide-react";
import type { WorkflowQueryResponse } from "@/lib/api/adapter";
import { PanelHeader, PanelTitle } from "@/components/panel";
import { PanelCloseButton } from "@/components/panel/panel-header-controls";

export interface ResubmitPanelHeaderProps {
  workflow: WorkflowQueryResponse;
  onClose: () => void;
}

export const ResubmitPanelHeader = memo(function ResubmitPanelHeader({ workflow, onClose }: ResubmitPanelHeaderProps) {
  return (
    <PanelHeader
      title={
        <div className="flex items-center gap-3">
          <RotateCw className="text-nvidia size-5 shrink-0" />
          <PanelTitle>Resubmit Workflow</PanelTitle>
        </div>
      }
      actions={<PanelCloseButton onClose={onClose} />}
      subtitle={
        <div className="text-sm text-zinc-600 dark:text-zinc-400">
          Configure and launch <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">{workflow.name}</code>
        </div>
      }
    />
  );
});

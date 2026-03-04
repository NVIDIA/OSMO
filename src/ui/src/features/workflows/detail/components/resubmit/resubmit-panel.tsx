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

"use client";

import type { WorkflowQueryResponse } from "@/lib/api/adapter/types";
import { PANEL } from "@/components/panel/lib/panel-constants";
import { ResizablePanel } from "@/components/panel/resizable-panel";
import { useWorkflowsPreferencesStore } from "@/features/workflows/list/stores/workflows-table-store";
import { ResubmitPanelHeader } from "@/features/workflows/detail/components/resubmit/resubmit-panel-header";
import { ResubmitPanelContent } from "@/features/workflows/detail/components/resubmit/resubmit-panel-content";

/** Minimum panel width to keep YAML readable and metadata fitting comfortably. */
const MIN_WIDTH_PX = 520;

export interface ResubmitPanelProps {
  workflow: WorkflowQueryResponse;
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

export function ResubmitPanel({ workflow, open, onClose, children }: ResubmitPanelProps) {
  const storedPanelWidth = useWorkflowsPreferencesStore((s) => s.resubmitPanelWidth);
  const setPanelWidth = useWorkflowsPreferencesStore((s) => s.setResubmitPanelWidth);

  return (
    <ResizablePanel
      open={open}
      onClose={onClose}
      width={storedPanelWidth}
      onWidthChange={setPanelWidth}
      minWidth={PANEL.MIN_WIDTH_PCT}
      maxWidth={PANEL.OVERLAY_MAX_WIDTH_PCT}
      minWidthPx={MIN_WIDTH_PX}
      mainContent={children}
      backdrop
      aria-label={`Resubmit workflow: ${workflow.name}`}
      className="resubmit-panel !bg-white dark:!bg-zinc-900"
    >
      <ResubmitPanelHeader
        workflow={workflow}
        onClose={onClose}
      />
      <ResubmitPanelContent
        workflow={workflow}
        onClose={onClose}
      />
    </ResizablePanel>
  );
}

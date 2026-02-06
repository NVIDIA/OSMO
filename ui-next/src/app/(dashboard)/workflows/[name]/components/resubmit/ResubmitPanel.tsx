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
 * ResubmitPanel - Workflow resubmission panel using ResizablePanel.
 *
 * Follows the same pattern as pool-panel.tsx and resource-panel.tsx:
 * - ResizablePanel for drag-to-resize
 * - Backdrop overlay with click-to-close
 * - Width persisted to localStorage
 * - Consistent with existing panel UX
 */

"use client";

import { useMemo } from "react";
import type { WorkflowQueryResponse } from "@/lib/api/adapter";
import { ResizablePanel, PANEL } from "@/components/panel";
import { useWorkflowsPreferencesStore } from "../../../stores/workflows-table-store";
import { ResubmitPanelHeader } from "./ResubmitPanelHeader";
import { ResubmitPanelContent } from "./ResubmitPanelContent";

// =============================================================================
// Types
// =============================================================================

export interface ResubmitPanelProps {
  /** Workflow to resubmit */
  workflow: WorkflowQueryResponse;
  /** Whether the panel is open */
  open: boolean;
  /** Callback when panel should close */
  onClose: () => void;
  /** Main content to render behind the panel (the workflow detail page) */
  children: React.ReactNode;
}

// =============================================================================
// Component
// =============================================================================

/**
 * ResubmitPanel - Workflow resubmission panel wrapper.
 *
 * Composes from ResizablePanel and adds resubmit-specific:
 * - Header with workflow name and close button
 * - Content with spec preview, pool selection, priority selection
 * - Form state management via useResubmitForm
 *
 * @example
 * ```tsx
 * <ResubmitPanel
 *   workflow={workflow}
 *   open={isOpen}
 *   onClose={handleClose}
 * >
 *   <WorkflowDetailPage workflow={workflow} />
 * </ResubmitPanel>
 * ```
 */
export function ResubmitPanel({ workflow, open, onClose, children }: ResubmitPanelProps) {
  const storedPanelWidth = useWorkflowsPreferencesStore((s) => s.resubmitPanelWidth);
  const setPanelWidth = useWorkflowsPreferencesStore((s) => s.setResubmitPanelWidth);

  // Clamp panel width to max 80% (stored value might exceed constraint)
  const panelWidth = useMemo(() => Math.min(storedPanelWidth, PANEL.OVERLAY_MAX_WIDTH_PCT), [storedPanelWidth]);

  return (
    <ResizablePanel
      open={open}
      onClose={onClose}
      width={panelWidth}
      onWidthChange={setPanelWidth}
      minWidth={PANEL.MIN_WIDTH_PCT}
      maxWidth={PANEL.OVERLAY_MAX_WIDTH_PCT}
      mainContent={children}
      backdrop
      aria-label={`Resubmit workflow: ${workflow.name}`}
      className="resubmit-panel"
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

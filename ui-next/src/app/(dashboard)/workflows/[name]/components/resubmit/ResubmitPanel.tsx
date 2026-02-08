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

import type { WorkflowQueryResponse } from "@/lib/api/adapter/types";
import { PANEL } from "@/components/panel/panel-header-controls";
import { ResizablePanel } from "@/components/panel/resizable-panel";
import { useWorkflowsPreferencesStore } from "@/app/(dashboard)/workflows/stores/workflows-table-store";
import { ResubmitPanelHeader } from "@/app/(dashboard)/workflows/[name]/components/resubmit/ResubmitPanelHeader";
import { ResubmitPanelContent } from "@/app/(dashboard)/workflows/[name]/components/resubmit/ResubmitPanelContent";

// =============================================================================
// Constants
// =============================================================================

/**
 * Resubmit panel-specific constraints.
 *
 * Uses pixel-based minimum for content-aware bounds:
 * - YAML editor optimal: 480-720px content + 96px padding = 576-816px panel
 * - Pool selector optimal: 400-600px content + 96px padding = 496-696px panel
 * - Priority selector optimal: 240-400px content + 96px padding = 336-496px panel
 *
 * Minimum chosen to ensure YAML remains readable and metadata fits comfortably.
 * Maximum uses standard 80% percentage to allow flexibility on large screens.
 */
const RESUBMIT_PANEL = {
  /** Minimum panel width in pixels (YAML readable, metadata fits) */
  MIN_WIDTH_PX: 520,
} as const;

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

  return (
    <ResizablePanel
      open={open}
      onClose={onClose}
      width={storedPanelWidth}
      onWidthChange={setPanelWidth}
      minWidth={PANEL.MIN_WIDTH_PCT}
      maxWidth={PANEL.OVERLAY_MAX_WIDTH_PCT}
      minWidthPx={RESUBMIT_PANEL.MIN_WIDTH_PX}
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

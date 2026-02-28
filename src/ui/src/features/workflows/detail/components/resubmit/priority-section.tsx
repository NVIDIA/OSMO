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
 * PrioritySection - Collapsible wrapper around PriorityPicker for the resubmit drawer.
 */

"use client";

import { memo, useState } from "react";
import { WorkflowPriority } from "@/lib/api/generated";
import { usePanelFocus } from "@/components/panel/hooks/use-panel-focus";
import { PriorityPicker, PRIORITY_LABELS } from "@/components/workflow/priority-picker";
import { CollapsibleSection } from "@/features/workflows/detail/components/resubmit/collapsible-section";

export interface PrioritySectionProps {
  /** Currently selected priority */
  priority: WorkflowPriority;
  /** Callback when priority changes */
  onChange: (priority: WorkflowPriority) => void;
}

export const PrioritySection = memo(function PrioritySection({ priority, onChange }: PrioritySectionProps) {
  const [open, setOpen] = useState(true);
  const focusPanel = usePanelFocus();

  // Return focus to panel after selection so ESC works
  const handleChange = (newPriority: WorkflowPriority) => {
    onChange(newPriority);
    focusPanel();
  };

  return (
    <CollapsibleSection
      step={3}
      title="Priority Level"
      open={open}
      onOpenChange={setOpen}
      selectedValue={PRIORITY_LABELS[priority]}
    >
      <PriorityPicker
        priority={priority}
        onChange={handleChange}
      />
    </CollapsibleSection>
  );
});

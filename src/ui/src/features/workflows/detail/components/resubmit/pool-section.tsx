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
 * PoolSection - Collapsible wrapper around PoolPicker for the resubmit drawer.
 */

"use client";

import { memo, useState } from "react";
import { PoolPicker } from "@/components/workflow/pool-picker";
import { CollapsibleSection } from "@/components/workflow/collapsible-section";

export interface PoolSectionProps {
  /** Currently selected pool name */
  pool: string;
  /** Callback when pool selection changes */
  onChange: (pool: string) => void;
}

export const PoolSection = memo(function PoolSection({ pool, onChange }: PoolSectionProps) {
  const [open, setOpen] = useState(true);

  return (
    <CollapsibleSection
      step={2}
      title="Target Pool"
      open={open}
      onOpenChange={setOpen}
      selectedValue={pool || undefined}
    >
      <PoolPicker
        pool={pool}
        onChange={onChange}
      />
    </CollapsibleSection>
  );
});

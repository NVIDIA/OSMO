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

import { ToggleGroup, ToggleGroupItem } from "@/components/shadcn/toggle-group";
import { PanelRight, Columns2, Maximize2 } from "lucide-react";

/**
 * Available container sizes for testing responsive behavior.
 */
export type ContainerSize = "panel" | "half-screen" | "full-screen";

interface ContainerSizeConfig {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const SIZE_CONFIGS: Record<ContainerSize, ContainerSizeConfig> = {
  panel: {
    label: "Panel",
    icon: PanelRight,
  },
  "half-screen": {
    label: "Half",
    icon: Columns2,
  },
  "full-screen": {
    label: "Full",
    icon: Maximize2,
  },
};

const SIZES = Object.keys(SIZE_CONFIGS) as ContainerSize[];

interface ContainerSizerProps {
  value: ContainerSize;
  onChange: (size: ContainerSize) => void;
}

/**
 * Toggle group for selecting container size.
 * Allows testing the log viewer at different responsive breakpoints.
 */
export function ContainerSizer({ value, onChange }: ContainerSizerProps) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-muted-foreground text-sm font-medium">Container:</label>
      <ToggleGroup
        type="single"
        value={value}
        onValueChange={(v) => v && onChange(v as ContainerSize)}
      >
        {SIZES.map((size) => {
          const config = SIZE_CONFIGS[size];
          const Icon = config.icon;
          return (
            <ToggleGroupItem
              key={size}
              value={size}
              aria-label={config.label}
              className="gap-1.5 px-3"
            >
              <Icon className="h-4 w-4" />
              <span className="text-xs">{config.label}</span>
            </ToggleGroupItem>
          );
        })}
      </ToggleGroup>
    </div>
  );
}

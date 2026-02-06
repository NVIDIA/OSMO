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

import { memo, forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface TabPanelProps {
  tab: string;
  activeTab: string;
  children: React.ReactNode;
  scrollable?: boolean;
  centered?: boolean;
  className?: string;
  padding?: "none" | "standard" | "with-bottom";
  "aria-label"?: string;
}

export const TabPanel = memo(
  forwardRef<HTMLDivElement, TabPanelProps>(function TabPanel(
    {
      tab,
      activeTab,
      children,
      scrollable = true,
      centered = false,
      className,
      padding = "none",
      "aria-label": ariaLabel,
    },
    ref,
  ) {
    const isActive = tab === activeTab;

    return (
      <div
        ref={ref}
        role="tabpanel"
        id={`tabpanel-${tab}`}
        aria-labelledby={`tab-${tab}`}
        aria-label={ariaLabel}
        className={cn(
          "absolute inset-0",
          scrollable && "overflow-y-auto",
          centered && "flex items-center justify-center",
          !isActive && "invisible",
          padding === "standard" && "p-4",
          padding === "with-bottom" && "p-4 pb-16",
          className,
        )}
        // Hidden from screen readers when not active
        aria-hidden={!isActive}
        // Prevent tab focus when hidden
        tabIndex={isActive ? 0 : -1}
      >
        {children}
      </div>
    );
  }),
);

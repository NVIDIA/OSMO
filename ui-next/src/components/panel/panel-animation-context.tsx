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

import { createContext, useContext } from "react";
import type { AnimationPhase } from "@/components/panel/hooks/usePanelAnimation";

interface PanelAnimationContextValue {
  /** Current panel animation phase */
  phase: AnimationPhase;
}

const PanelAnimationContext = createContext<PanelAnimationContextValue | null>(null);

export const PanelAnimationProvider = PanelAnimationContext.Provider;

/**
 * Hook to access the panel's animation state from within panel content.
 * Used to coordinate child component behavior with the panel's animation phases.
 *
 * Example: Defer expensive layout measurements until the panel's entering
 * animation completes to avoid transform storms.
 */
export function usePanelAnimationContext(): PanelAnimationContextValue {
  const context = useContext(PanelAnimationContext);
  if (!context) {
    // Return a safe default for components used outside of panels
    return { phase: "open" };
  }
  return context;
}

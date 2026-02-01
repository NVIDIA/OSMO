//SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.

//Licensed under the Apache License, Version 2.0 (the "License");
//you may not use this file except in compliance with the License.
//You may obtain a copy of the License at

//http://www.apache.org/licenses/LICENSE-2.0

//Unless required by applicable law or agreed to in writing, software
//distributed under the License is distributed on an "AS IS" BASIS,
//WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//See the License for the specific language governing permissions and
//limitations under the License.

//SPDX-License-Identifier: Apache-2.0

/**
 * PanelTransitionContext - Provides panel transition state to nested components
 *
 * Used to coordinate panel resize/snap animations with table column auto-sizing.
 * When the panel is transitioning, tables should suspend ResizeObserver calculations
 * to avoid using intermediate dimensions during CSS animations.
 */

"use client";

import { createContext, useContext } from "react";

interface PanelTransitionContextValue {
  /** True when panel is animating (drag, snap, or CSS transition) */
  isTransitioning: boolean;
}

const PanelTransitionContext = createContext<PanelTransitionContextValue>({
  isTransitioning: false,
});

/**
 * Hook to access panel transition state.
 * Returns whether the panel is currently transitioning (dragging, snapping, or animating).
 */
export function usePanelTransition(): PanelTransitionContextValue {
  return useContext(PanelTransitionContext);
}

export const PanelTransitionProvider = PanelTransitionContext.Provider;

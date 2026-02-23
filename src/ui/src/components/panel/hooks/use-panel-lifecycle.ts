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
 * usePanelLifecycle - Manage panel animation state machine
 *
 * Handles the open/close/closing lifecycle for ResizablePanel to enable
 * smooth slide-out animations before unmounting content.
 *
 * State transitions:
 * - open=false, isClosing=false → Panel closed
 * - open=true, isClosing=false → Panel open
 * - open=true, isClosing=true → Panel closing (animation playing)
 * - After animation: triggers onClosed callback
 */

import { useState, useCallback } from "react";

export interface UsePanelLifecycleOptions {
  /** Whether item is selected (drives open state) */
  hasSelection: boolean;
  /** Callback to clear selection after animation completes */
  onClosed: () => void;
}

export interface UsePanelLifecycleReturn {
  /** Whether panel is open (controls ResizablePanel visibility) */
  isPanelOpen: boolean;
  /** Callback to start closing animation */
  handleClose: () => void;
  /** Callback after animation completes (clears selection) */
  handleClosed: () => void;
}

export function usePanelLifecycle({ hasSelection, onClosed }: UsePanelLifecycleOptions): UsePanelLifecycleReturn {
  const [isClosing, setIsClosing] = useState(false);

  // Panel is open when we have a selection and not closing
  const isPanelOpen = hasSelection && !isClosing;

  // Start closing animation (URL stays until animation completes)
  const handleClose = useCallback(() => {
    setIsClosing(true);
  }, []);

  // After animation completes, clear URL to unmount component
  const handleClosed = useCallback(() => {
    setIsClosing(false);
    onClosed();
  }, [onClosed]);

  return {
    isPanelOpen,
    handleClose,
    handleClosed,
  };
}

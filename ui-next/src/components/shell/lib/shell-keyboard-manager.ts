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
 * Centralized Keyboard Manager for Shell Sessions
 *
 * Problem: When multiple shells are mounted (1 visible + N hidden), each adds its own
 * global window.addEventListener("keydown"), causing N handlers to fire on every keypress.
 *
 * Solution: Single global keyboard listener that delegates to the currently focused shell.
 *
 * Benefits:
 * - Performance: 1 event listener instead of N
 * - Correctness: Only focused shell handles shortcuts
 * - Maintainability: Single source of truth for keyboard shortcuts
 *
 * Usage:
 * ```typescript
 * // In ShellTerminalImpl component:
 * useEffect(() => {
 *   const unregister = shellKeyboardManager.register(taskId, handlers);
 *   return unregister;
 * }, [taskId, handlers]);
 * ```
 */

export interface ShellKeyboardHandlers {
  /** Cmd/Ctrl+F: Toggle search */
  onToggleSearch: () => void;
  /** Cmd/Ctrl+C: Copy selection (only if terminal has selection) */
  onCopySelection: () => void;
  /** Escape: Close search (only if search is open) */
  onCloseSearch: () => void;
  /** Check if this shell should handle the event (e.g., has selection, search is open) */
  shouldHandleCopy: () => boolean;
  shouldHandleEscape: () => boolean;
}

interface RegisteredShell {
  taskId: string;
  handlers: ShellKeyboardHandlers;
  lastFocusTime: number;
}

class ShellKeyboardManager {
  private registeredShells = new Map<string, RegisteredShell>();
  private globalHandlerAttached = false;

  /**
   * Register a shell's keyboard handlers.
   * @param taskId - Unique shell session identifier
   * @param handlers - Keyboard event handlers
   * @returns Unregister function
   */
  register(taskId: string, handlers: ShellKeyboardHandlers): () => void {
    this.registeredShells.set(taskId, {
      taskId,
      handlers,
      lastFocusTime: Date.now(),
    });

    // Attach global handler on first registration
    if (!this.globalHandlerAttached) {
      window.addEventListener("keydown", this.handleGlobalKeyDown);
      this.globalHandlerAttached = true;
    }

    // Return unregister function
    return () => {
      this.registeredShells.delete(taskId);

      // Remove global handler if no shells registered
      if (this.registeredShells.size === 0 && this.globalHandlerAttached) {
        window.removeEventListener("keydown", this.handleGlobalKeyDown);
        this.globalHandlerAttached = false;
      }
    };
  }

  /**
   * Update the last focus time for a shell (called when terminal is focused).
   * @param taskId - Shell session identifier
   */
  markFocused(taskId: string): void {
    const shell = this.registeredShells.get(taskId);
    if (shell) {
      shell.lastFocusTime = Date.now();
    }
  }

  /**
   * Get the most recently focused shell.
   * This is the shell that should handle keyboard shortcuts.
   */
  private getMostRecentlyFocusedShell(): RegisteredShell | undefined {
    let mostRecent: RegisteredShell | undefined;
    let latestTime = 0;

    for (const shell of this.registeredShells.values()) {
      if (shell.lastFocusTime > latestTime) {
        latestTime = shell.lastFocusTime;
        mostRecent = shell;
      }
    }

    return mostRecent;
  }

  /**
   * Global keydown handler - delegates to the focused shell.
   */
  private handleGlobalKeyDown = (e: KeyboardEvent): void => {
    const focusedShell = this.getMostRecentlyFocusedShell();
    if (!focusedShell) return;

    const { handlers } = focusedShell;

    // Cmd/Ctrl+F: Toggle search
    if ((e.metaKey || e.ctrlKey) && e.key === "f") {
      e.preventDefault();
      handlers.onToggleSearch();
      return;
    }

    // Cmd/Ctrl+C: Copy selection (only if terminal has selection)
    if ((e.metaKey || e.ctrlKey) && e.key === "c") {
      if (handlers.shouldHandleCopy()) {
        e.preventDefault();
        handlers.onCopySelection();
      }
      return;
    }

    // Escape: Close search (only if search is open)
    if (e.key === "Escape") {
      if (handlers.shouldHandleEscape()) {
        handlers.onCloseSearch();
      }
      return;
    }
  };
}

// Singleton instance
export const shellKeyboardManager = new ShellKeyboardManager();

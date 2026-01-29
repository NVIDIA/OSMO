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

// Single global keyboard listener that delegates to the most recently focused shell.
// Prevents N handlers firing when multiple shells are mounted (1 visible + N hidden).

export interface ShellKeyboardHandlers {
  onToggleSearch: () => void;
  onCopySelection: () => void;
  onCloseSearch: () => void;
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

  register(taskId: string, handlers: ShellKeyboardHandlers): () => void {
    this.registeredShells.set(taskId, {
      taskId,
      handlers,
      lastFocusTime: Date.now(),
    });

    if (!this.globalHandlerAttached) {
      window.addEventListener("keydown", this.handleGlobalKeyDown);
      this.globalHandlerAttached = true;
    }

    return () => {
      this.registeredShells.delete(taskId);

      if (this.registeredShells.size === 0 && this.globalHandlerAttached) {
        window.removeEventListener("keydown", this.handleGlobalKeyDown);
        this.globalHandlerAttached = false;
      }
    };
  }

  markFocused(taskId: string): void {
    const shell = this.registeredShells.get(taskId);
    if (shell) {
      shell.lastFocusTime = Date.now();
    }
  }

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

  private handleGlobalKeyDown = (e: KeyboardEvent): void => {
    const focusedShell = this.getMostRecentlyFocusedShell();
    if (!focusedShell) return;

    const { handlers } = focusedShell;

    if ((e.metaKey || e.ctrlKey) && e.key === "f") {
      e.preventDefault();
      handlers.onToggleSearch();
      return;
    }

    if ((e.metaKey || e.ctrlKey) && e.key === "c") {
      if (handlers.shouldHandleCopy()) {
        e.preventDefault();
        handlers.onCopySelection();
      }
      return;
    }

    if (e.key === "Escape") {
      if (handlers.shouldHandleEscape()) {
        handlers.onCloseSearch();
      }
    }
  };
}

export const shellKeyboardManager = new ShellKeyboardManager();

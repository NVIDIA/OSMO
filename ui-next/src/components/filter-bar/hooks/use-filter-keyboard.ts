/**
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Keyboard handler hook for FilterBar.
 *
 * Implements the command pattern: reads state, dispatches to action callbacks.
 * Zero nesting via flat switch/case with dedicated handler functions.
 *
 * Responsibilities:
 * - Arrow key chip navigation (left/right through chips + input)
 * - Backspace/Delete chip removal
 * - Escape to close dropdown or blur input
 * - Enter to create chip from typed field:value or open dropdown
 * - Tab to autocomplete single matching suggestion
 */

import { useCallback } from "react";
import type { ParsedInput, SearchField, Suggestion } from "@/components/filter-bar/lib/types";

// ---------------------------------------------------------------------------
// Action interface: all side-effects the keyboard handler may trigger
// ---------------------------------------------------------------------------

export interface FilterKeyboardActions {
  /** Focus a specific chip by index */
  focusChip: (index: number) => void;
  /** Unfocus all chips (set index to -1) */
  unfocusChips: () => void;
  /** Remove the chip at a given index */
  removeChipAtIndex: (index: number) => void;

  /** Reset input value, close dropdown, clear errors */
  resetInput: () => void;
  /** Open the dropdown */
  openDropdown: () => void;
  /** Close the dropdown */
  closeDropdown: () => void;

  /** Try to create a chip from the current parsed field:value. Returns true if created. */
  addChipFromParsedInput: () => boolean;
  /** Select a suggestion value (delegates to handleSelect) */
  selectSuggestion: (value: string) => void;
  /** Fill input with a value (for field prefix completion) */
  fillInput: (value: string) => void;

  /** Show a validation error message */
  showError: (message: string) => void;

  /** Focus the text input element */
  focusInput: () => void;
  /** Blur the text input element */
  blurInput: () => void;

  /** Get cursor position of the input (selectionStart) */
  getInputSelectionStart: () => number | null;
  /** Get cursor selection end */
  getInputSelectionEnd: () => number | null;
}

// ---------------------------------------------------------------------------
// Read-only state the handler needs to make decisions
// ---------------------------------------------------------------------------

export interface FilterKeyboardState<T> {
  chipCount: number;
  focusedChipIndex: number;
  inputValue: string;
  isOpen: boolean;
  parsedInput: ParsedInput<T>;
  selectables: Suggestion<T>[];
  fields: readonly SearchField<T>[];
}

// ---------------------------------------------------------------------------
// Return type
// ---------------------------------------------------------------------------

export interface UseFilterKeyboardReturn {
  handleKeyDown: (e: React.KeyboardEvent) => void;
}

// ---------------------------------------------------------------------------
// Hook implementation
// ---------------------------------------------------------------------------

export function useFilterKeyboard<T>(
  state: FilterKeyboardState<T>,
  actions: FilterKeyboardActions,
): UseFilterKeyboardReturn {
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case "ArrowLeft":
          handleArrowLeft(e, state, actions);
          break;
        case "ArrowRight":
          handleArrowRight(e, state, actions);
          break;
        case "Backspace":
          handleBackspace(e, state, actions);
          break;
        case "Delete":
          handleDelete(e, state, actions);
          break;
        case "Escape":
          handleEscape(e, state, actions);
          break;
        case "Enter":
          handleEnter(e, state, actions);
          break;
        case "Tab":
          handleTab(e, state, actions);
          break;
      }
    },
    [state, actions],
  );

  return { handleKeyDown };
}

// ---------------------------------------------------------------------------
// Per-key handlers (pure functions with zero nesting)
// ---------------------------------------------------------------------------

function handleArrowLeft<T>(
  e: React.KeyboardEvent,
  state: FilterKeyboardState<T>,
  actions: FilterKeyboardActions,
): void {
  const { focusedChipIndex, chipCount } = state;

  // Already navigating chips - move left
  if (focusedChipIndex >= 0) {
    e.preventDefault();
    if (focusedChipIndex > 0) {
      actions.focusChip(focusedChipIndex - 1);
    }
    return;
  }

  // Cursor at start of input - enter chip navigation
  if (chipCount > 0) {
    const atStart = actions.getInputSelectionStart() === 0 && actions.getInputSelectionEnd() === 0;
    if (atStart) {
      e.preventDefault();
      actions.focusChip(chipCount - 1);
    }
  }
}

function handleArrowRight<T>(
  e: React.KeyboardEvent,
  state: FilterKeyboardState<T>,
  actions: FilterKeyboardActions,
): void {
  const { focusedChipIndex, chipCount } = state;

  if (focusedChipIndex < 0) return;

  e.preventDefault();

  if (focusedChipIndex < chipCount - 1) {
    // Move right within chips
    actions.focusChip(focusedChipIndex + 1);
  } else {
    // Past last chip - return to input
    actions.unfocusChips();
    actions.focusInput();
  }
}

function handleBackspace<T>(
  e: React.KeyboardEvent,
  state: FilterKeyboardState<T>,
  actions: FilterKeyboardActions,
): void {
  const { inputValue, chipCount, focusedChipIndex } = state;

  // Only handle when input is empty and chips exist
  if (inputValue !== "" || chipCount === 0) return;

  if (focusedChipIndex >= 0) {
    // Remove the focused chip
    e.preventDefault();
    const nextIndex = chipCount === 1 ? -1 : Math.min(focusedChipIndex, chipCount - 2);
    actions.removeChipAtIndex(focusedChipIndex);
    actions.focusChip(nextIndex);
  } else {
    // No chip focused - focus the last chip
    actions.focusChip(chipCount - 1);
  }
}

function handleDelete<T>(e: React.KeyboardEvent, state: FilterKeyboardState<T>, actions: FilterKeyboardActions): void {
  const { focusedChipIndex, chipCount } = state;

  if (focusedChipIndex < 0) return;

  e.preventDefault();
  const nextIndex = chipCount === 1 ? -1 : Math.min(focusedChipIndex, chipCount - 2);
  actions.removeChipAtIndex(focusedChipIndex);
  actions.focusChip(nextIndex);
}

function handleEscape<T>(e: React.KeyboardEvent, state: FilterKeyboardState<T>, actions: FilterKeyboardActions): void {
  if (state.isOpen) {
    e.preventDefault();
    e.stopPropagation();
    actions.closeDropdown();
  } else {
    actions.blurInput();
  }
}

function handleEnter<T>(e: React.KeyboardEvent, state: FilterKeyboardState<T>, actions: FilterKeyboardActions): void {
  const { parsedInput, isOpen, selectables, inputValue } = state;

  // Priority 1: User typed field:value (e.g., "pool:myvalue") - create chip
  if (parsedInput.hasPrefix && parsedInput.field && parsedInput.query.trim()) {
    e.preventDefault();
    e.stopPropagation();
    if (actions.addChipFromParsedInput()) {
      actions.resetInput();
      actions.focusInput();
    }
    return;
  }

  // Priority 2: Dropdown closed - just open it
  if (!isOpen) {
    e.preventDefault();
    actions.openDropdown();
    return;
  }

  // Priority 3: Dropdown open with suggestions - let cmdk handle selection
  if (isOpen && selectables.length > 0) {
    return;
  }

  // Priority 4: Prefix typed but no value (e.g., "platform:")
  if (parsedInput.hasPrefix && parsedInput.field && !parsedInput.query.trim()) {
    e.preventDefault();
    e.stopPropagation();
    actions.showError(`Enter a value after "${parsedInput.field.prefix}"`);
    return;
  }

  // Priority 5: Unrecognized input with no suggestions
  if (inputValue.trim() && selectables.length === 0) {
    e.preventDefault();
    e.stopPropagation();

    // Generate dynamic error message using available field prefixes
    const { fields } = state;
    const examplePrefixes = fields.slice(0, 2).map((f) => `"${f.prefix}"`);
    const prefixText = examplePrefixes.length > 0 ? examplePrefixes.join(" or ") : "a filter prefix";

    actions.showError(`Use a filter prefix like ${prefixText} to create filters`);
  }
}

function handleTab<T>(e: React.KeyboardEvent, state: FilterKeyboardState<T>, actions: FilterKeyboardActions): void {
  // Only forward Tab (not Shift+Tab), and only when there's input
  if (e.shiftKey || !state.inputValue.trim()) return;

  const { selectables } = state;

  // Single matching value - autocomplete it
  const valueItems = selectables.filter((s) => s.type === "value");
  if (valueItems.length === 1) {
    e.preventDefault();
    actions.selectSuggestion(valueItems[0].value);
    return;
  }

  // Single matching field prefix - complete it
  if (selectables.length === 1 && selectables[0].type === "field") {
    e.preventDefault();
    actions.fillInput(selectables[0].value);
  }
}

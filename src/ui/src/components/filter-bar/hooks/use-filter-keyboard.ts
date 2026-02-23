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
 * Keyboard handler hook for FilterBar.
 *
 * Navigation model:
 * - Tab / ArrowDown / ArrowRight (at end of input) → navigate forward
 * - Shift-Tab / ArrowUp / ArrowLeft (at start of input) → navigate backward
 * - All directional keys share a single `navigate` path: enter mode → cycle → re-snapshot
 * - Enter commits the current level (field→value, preset select, or chip creation)
 * - Escape goes back one level or closes the dropdown
 * - ArrowLeft / ArrowRight handle chip navigation first, then suggestion navigation at boundaries
 */

import { useState, useCallback, useMemo } from "react";
import type { FieldSuggestion, ParsedInput, SearchField, Suggestion } from "@/components/filter-bar/lib/types";

// ---------------------------------------------------------------------------
// External interfaces
// ---------------------------------------------------------------------------

/** Read-only state from the parent hook */
export interface FilterKeyboardState<T> {
  chipCount: number;
  focusedChipIndex: number;
  inputValue: string;
  isOpen: boolean;
  parsedInput: ParsedInput<T>;
  /** Live selectables (before any freezing) — includes preset suggestions when input is empty */
  selectables: Suggestion<T>[];
  fields: readonly SearchField<T>[];
}

/** Side-effect actions the keyboard handler may trigger in the parent */
export interface FilterKeyboardActions {
  focusChip: (index: number) => void;
  unfocusChips: () => void;
  removeChipAtIndex: (index: number) => void;
  resetInput: () => void;
  openDropdown: () => void;
  closeDropdown: () => void;
  addChipFromParsedInput: () => boolean;
  addTextChip: (value: string) => void;
  selectSuggestion: (value: string) => void;
  fillInput: (value: string) => void;
  showError: (message: string) => void;
  focusInput: () => void;
  blurInput: () => void;
  getInputSelectionStart: () => number | null;
  getInputSelectionEnd: () => number | null;
}

interface UseFilterKeyboardReturn<T> {
  handleKeyDown: (e: React.KeyboardEvent) => void;
  /** Value of the highlighted suggestion for dropdown visual state */
  highlightedSuggestionValue: string | undefined;
  /** Selectables to render (snapshotted during navigation, live otherwise) */
  displaySelectables: Suggestion<T>[];
  /** Current navigation level (null = not navigating) */
  navigationLevel: "field" | "value" | null;
  /** Reset all navigation state */
  resetNavigation: () => void;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/**
 * One item in the navigation cycle.
 * Wraps any Suggestion<T> with an inputValue to fill when highlighted.
 * Presets use inputValue="" (they don't modify the input).
 */
interface CycleItem<T> {
  value: string;
  inputValue: string;
  suggestion: Suggestion<T>;
}

type NavigationState<T> =
  | { level: null }
  | { level: "field"; items: CycleItem<T>[]; highlightedIndex: number }
  | { level: "value"; items: CycleItem<T>[]; highlightedIndex: number };

interface NavCtx<T> {
  state: NavigationState<T>;
  setState: (state: NavigationState<T>) => void;
  reset: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useFilterKeyboard<T>(
  state: FilterKeyboardState<T>,
  actions: FilterKeyboardActions,
): UseFilterKeyboardReturn<T> {
  const [navState, setNavState] = useState<NavigationState<T>>({ level: null });

  // During navigation: frozen cycle items drive the display.
  // When items are [] (post level-transition), fall back to live selectables — the input
  // was just updated so useSuggestions already has the right content ready.
  const displaySelectables = useMemo(() => {
    if (navState.level === null || navState.items.length === 0) return state.selectables;
    return navState.items.map((c) => c.suggestion);
  }, [navState, state.selectables]);

  const highlightedSuggestionValue =
    navState.level !== null && navState.highlightedIndex >= 0 && navState.highlightedIndex < navState.items.length
      ? navState.items[navState.highlightedIndex].value
      : undefined;

  const resetNavigation = useCallback(() => setNavState({ level: null }), []);

  const nav = useMemo<NavCtx<T>>(
    () => ({ state: navState, setState: setNavState, reset: resetNavigation }),
    [navState, resetNavigation],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case "Tab":
          navigate(e, e.shiftKey ? "backward" : "forward", state, nav, actions);
          break;
        case "ArrowDown":
          navigate(e, "forward", state, nav, actions);
          break;
        case "ArrowUp":
          navigate(e, "backward", state, nav, actions);
          break;
        case "ArrowRight":
          onArrowRight(e, state, nav, actions);
          break;
        case "ArrowLeft":
          onArrowLeft(e, state, nav, actions);
          break;
        case "Backspace":
          onBackspace(e, state, actions);
          break;
        case "Delete":
          onDelete(e, state, actions);
          break;
        case "Escape":
          onEscape(e, state, actions, nav);
          break;
        case "Enter":
          onEnter(e, state, actions, nav);
          break;
      }
    },
    [state, actions, nav],
  );

  return {
    handleKeyDown,
    highlightedSuggestionValue,
    displaySelectables,
    navigationLevel: navState.level,
    resetNavigation,
  };
}

// ---------------------------------------------------------------------------
// Key handlers
// ---------------------------------------------------------------------------

/**
 * Unified directional navigation — called by Tab, ArrowDown, ArrowUp, and horizontal
 * arrows when the cursor is at an input boundary.
 *
 * State machine:
 *   not navigating + nothing to show  → return (Tab bubbles for browser focus management)
 *   not navigating + items available  → enterNavigationMode (snapshot + highlight)
 *   navigating    + items frozen      → advanceCycle
 *   navigating    + items [] (post-transition) → re-snapshot, then highlight
 */
function navigate<T>(
  e: React.KeyboardEvent,
  direction: "forward" | "backward",
  state: FilterKeyboardState<T>,
  nav: NavCtx<T>,
  actions: FilterKeyboardActions,
): void {
  if (nav.state.level === null && (!state.isOpen || state.selectables.length === 0)) return;

  e.preventDefault();
  e.stopPropagation();

  if (nav.state.level !== null) {
    if (nav.state.items.length === 0) {
      enterNavigationMode(state, nav, actions, direction);
    } else {
      advanceCycle(direction, nav, actions);
    }
    return;
  }

  enterNavigationMode(state, nav, actions, direction);
}

/**
 * ArrowRight: chip navigation → then forward suggestion navigation at end of input.
 * When a chip is focused, moves to the next chip (or returns to the input).
 * When cursor is at end of input, delegates to navigate("forward").
 */
function onArrowRight<T>(
  e: React.KeyboardEvent,
  state: FilterKeyboardState<T>,
  nav: NavCtx<T>,
  actions: FilterKeyboardActions,
): void {
  const { focusedChipIndex, chipCount } = state;

  if (focusedChipIndex >= 0) {
    e.preventDefault();
    if (focusedChipIndex < chipCount - 1) {
      actions.focusChip(focusedChipIndex + 1);
    } else {
      actions.unfocusChips();
      actions.focusInput();
    }
    return;
  }

  const atEnd =
    actions.getInputSelectionStart() === state.inputValue.length &&
    actions.getInputSelectionEnd() === state.inputValue.length;
  if (atEnd) navigate(e, "forward", state, nav, actions);
}

/**
 * ArrowLeft: chip navigation → then backward suggestion navigation at start of input.
 * When a chip is focused, moves to the previous chip.
 * When cursor is at start of input and chips exist, focuses the last chip.
 * When cursor is at start and no chips, delegates to navigate("backward").
 */
function onArrowLeft<T>(
  e: React.KeyboardEvent,
  state: FilterKeyboardState<T>,
  nav: NavCtx<T>,
  actions: FilterKeyboardActions,
): void {
  const { focusedChipIndex, chipCount } = state;

  if (focusedChipIndex >= 0) {
    e.preventDefault();
    if (focusedChipIndex > 0) actions.focusChip(focusedChipIndex - 1);
    return;
  }

  const atStart = actions.getInputSelectionStart() === 0 && actions.getInputSelectionEnd() === 0;
  if (!atStart) return;

  if (chipCount > 0) {
    e.preventDefault();
    actions.focusChip(chipCount - 1);
  } else {
    navigate(e, "backward", state, nav, actions);
  }
}

function onBackspace<T>(e: React.KeyboardEvent, state: FilterKeyboardState<T>, actions: FilterKeyboardActions): void {
  const { inputValue, chipCount, focusedChipIndex } = state;

  if (inputValue !== "" || chipCount === 0) return;

  if (focusedChipIndex >= 0) {
    e.preventDefault();
    const nextIndex = chipCount === 1 ? -1 : Math.min(focusedChipIndex, chipCount - 2);
    actions.removeChipAtIndex(focusedChipIndex);
    actions.focusChip(nextIndex);
  } else {
    actions.focusChip(chipCount - 1);
  }
}

function onDelete<T>(e: React.KeyboardEvent, state: FilterKeyboardState<T>, actions: FilterKeyboardActions): void {
  const { focusedChipIndex, chipCount } = state;
  if (focusedChipIndex < 0) return;

  e.preventDefault();
  const nextIndex = chipCount === 1 ? -1 : Math.min(focusedChipIndex, chipCount - 2);
  actions.removeChipAtIndex(focusedChipIndex);
  actions.focusChip(nextIndex);
}

function onEscape<T>(
  e: React.KeyboardEvent,
  state: FilterKeyboardState<T>,
  actions: FilterKeyboardActions,
  nav: NavCtx<T>,
): void {
  if (nav.state.level === "value") {
    e.preventDefault();
    e.stopPropagation();
    nav.setState({ level: "field", items: [], highlightedIndex: -1 });
    actions.fillInput("");
    return;
  }

  if (nav.state.level === "field") {
    e.preventDefault();
    e.stopPropagation();
    nav.reset();
    actions.fillInput("");
    return;
  }

  if (state.isOpen) {
    e.preventDefault();
    e.stopPropagation();
    actions.closeDropdown();
    return;
  }

  actions.blurInput();
}

function onEnter<T>(
  e: React.KeyboardEvent,
  state: FilterKeyboardState<T>,
  actions: FilterKeyboardActions,
  nav: NavCtx<T>,
): void {
  const { parsedInput, isOpen, inputValue } = state;

  if (!isOpen) {
    e.preventDefault();
    actions.openDropdown();
    return;
  }

  if (nav.state.level !== null) {
    e.preventDefault();
    e.stopPropagation();

    if (nav.state.level === "field" && nav.state.highlightedIndex >= 0) {
      const current = nav.state.items[nav.state.highlightedIndex];
      if (!current) return;

      if (current.suggestion.type === "preset") {
        actions.selectSuggestion(current.suggestion.value);
        return;
      }

      actions.fillInput(current.inputValue);
      nav.setState({ level: "value", items: [], highlightedIndex: -1 });
      return;
    }

    if (nav.state.level === "value" && nav.state.highlightedIndex >= 0) {
      if (parsedInput.hasPrefix && parsedInput.field && parsedInput.query.trim()) {
        if (actions.addChipFromParsedInput()) {
          actions.resetInput();
          actions.focusInput();
        }
      }
      return;
    }

    return;
  }

  if (parsedInput.hasPrefix && parsedInput.field && parsedInput.query.trim()) {
    e.preventDefault();
    e.stopPropagation();
    if (actions.addChipFromParsedInput()) {
      actions.resetInput();
      actions.focusInput();
    }
    return;
  }

  if (parsedInput.hasPrefix && parsedInput.field && !parsedInput.query.trim()) {
    e.preventDefault();
    e.stopPropagation();
    actions.showError(`Enter a value after "${parsedInput.field.prefix}"`);
    return;
  }

  if (inputValue.trim()) {
    e.preventDefault();
    e.stopPropagation();
    actions.addTextChip(inputValue.trim());
    actions.resetInput();
    actions.focusInput();
  }
}

// ---------------------------------------------------------------------------
// Navigation primitives
// ---------------------------------------------------------------------------

function advanceCycle<T>(direction: "forward" | "backward", nav: NavCtx<T>, actions: FilterKeyboardActions): void {
  if (nav.state.level === null || nav.state.items.length === 0) return;

  const nextIdx =
    direction === "forward"
      ? (nav.state.highlightedIndex + 1) % nav.state.items.length
      : nav.state.highlightedIndex <= 0
        ? nav.state.items.length - 1
        : nav.state.highlightedIndex - 1;

  nav.setState({ ...nav.state, highlightedIndex: nextIdx });

  const item = nav.state.items[nextIdx];
  if (item) actions.fillInput(item.inputValue);
}

function buildFieldCycleItems<T>(selectables: Suggestion<T>[]): CycleItem<T>[] {
  return selectables.map((s) => ({
    value: s.value,
    inputValue: s.type === "preset" ? "" : s.value,
    suggestion: s,
  }));
}

function buildValueCycleItems<T>(selectables: Suggestion<T>[]): CycleItem<T>[] {
  return selectables
    .filter((s): s is FieldSuggestion<T> => s.type !== "preset")
    .map((s) => ({
      value: s.value,
      inputValue: s.field.prefix ? `${s.field.prefix}${s.value}` : s.value,
      suggestion: s,
    }));
}

/**
 * Snapshot current selectables into a cycle list and highlight the starting item.
 * direction="forward" → index 0; direction="backward" → last index (wrap-around feel).
 */
function enterNavigationMode<T>(
  state: FilterKeyboardState<T>,
  nav: NavCtx<T>,
  actions: FilterKeyboardActions,
  direction: "forward" | "backward" = "forward",
): void {
  const { selectables, parsedInput } = state;
  const hasFields = selectables.some((s) => s.type === "field");
  const hasValues = selectables.some((s) => s.type === "value");
  const hasPresets = selectables.some((s) => s.type === "preset");

  if ((hasFields || hasPresets) && !parsedInput.hasPrefix) {
    const items = buildFieldCycleItems(selectables);
    const startIdx = direction === "forward" ? 0 : items.length - 1;
    nav.setState({ level: "field", items, highlightedIndex: startIdx });
    const first = items[startIdx];
    if (first) actions.fillInput(first.inputValue);
  } else if (hasValues && parsedInput.hasPrefix) {
    const items = buildValueCycleItems(selectables);
    const startIdx = direction === "forward" ? 0 : items.length - 1;
    nav.setState({ level: "value", items, highlightedIndex: startIdx });
    const first = items[startIdx];
    if (first) actions.fillInput(first.inputValue);
  }
}

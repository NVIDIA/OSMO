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
 * Owns hierarchical navigation state (Tab-cycling through field/value
 * levels) and dispatches keyboard events to handler functions.
 *
 * Navigation model:
 * - Tab cycles through a snapshot (cycleItems) of presets + suggestions
 * - Enter commits the current level (field→value, preset select, or chip)
 * - Escape goes back one level or closes the dropdown
 *
 * Non-navigation keys (arrows, backspace, delete) are pure functions.
 * Navigation keys (Tab, Enter, Escape) receive a NavCtx with internal state.
 */

import { useState, useCallback, useMemo } from "react";
import type { ParsedInput, SearchField, Suggestion } from "@/components/filter-bar/lib/types";

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
  /** Live selectables (before any freezing) */
  selectables: Suggestion<T>[];
  fields: readonly SearchField<T>[];
  /** Preset cmdk values (e.g. "preset:status-failed") for field-level cycling */
  presetValues: string[];
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

export interface UseFilterKeyboardReturn<T> {
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

/** A preset item in the Tab-cycling rotation */
interface PresetCycleItem {
  kind: "preset";
  /** cmdk value (e.g., "preset:status-failed") */
  value: string;
}

/** A suggestion item in the Tab-cycling rotation */
interface SuggestionCycleItem<T> {
  kind: "suggestion";
  /** cmdk value for dropdown highlighting */
  value: string;
  /** Value to fill in the input */
  inputValue: string;
  /** Original suggestion (used for dropdown display) */
  suggestion: Suggestion<T>;
}

/** An item in the Tab-cycling rotation (presets + suggestions) */
type CycleItem<T> = PresetCycleItem | SuggestionCycleItem<T>;

/** Bundled navigation context passed to handler functions */
interface NavCtx<T> {
  level: "field" | "value" | null;
  highlightedIndex: number;
  /** Combined cycle list (presets + suggestions) for Tab rotation */
  cycleItems: CycleItem<T>[] | null;
  setLevel: (level: "field" | "value" | null) => void;
  setHighlightedIndex: (index: number) => void;
  setCycleItems: (items: CycleItem<T>[] | null) => void;
  reset: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useFilterKeyboard<T>(
  state: FilterKeyboardState<T>,
  actions: FilterKeyboardActions,
): UseFilterKeyboardReturn<T> {
  // ========== Internal navigation state ==========
  const [navLevel, setNavLevel] = useState<"field" | "value" | null>(null);
  const [highlightedIdx, setHighlightedIdx] = useState(-1);
  const [cycleItems, setCycleItems] = useState<CycleItem<T>[] | null>(null);

  // ========== Derived ==========

  // Display selectables: frozen suggestions from cycleItems during navigation, live otherwise
  const displaySelectables = useMemo(() => {
    if (!cycleItems) return state.selectables;
    return cycleItems
      .filter((c): c is SuggestionCycleItem<T> => c.kind === "suggestion")
      .map((c) => c.suggestion);
  }, [cycleItems, state.selectables]);

  // Highlighted value from the cycle list (presets and suggestions share a .value field)
  const highlightedSuggestionValue =
    highlightedIdx >= 0 && cycleItems && highlightedIdx < cycleItems.length
      ? cycleItems[highlightedIdx].value
      : undefined;

  const resetNavigation = useCallback(() => {
    setNavLevel(null);
    setHighlightedIdx(-1);
    setCycleItems(null);
  }, []);

  // ========== Navigation context (memoized bundle for handlers) ==========

  const nav = useMemo<NavCtx<T>>(
    () => ({
      level: navLevel,
      highlightedIndex: highlightedIdx,
      cycleItems,
      setLevel: setNavLevel,
      setHighlightedIndex: setHighlightedIdx,
      setCycleItems,
      reset: resetNavigation,
    }),
    [navLevel, highlightedIdx, cycleItems, resetNavigation],
  );

  // ========== Main handler ==========

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case "ArrowLeft":
          onArrowLeft(e, state, actions);
          break;
        case "ArrowRight":
          onArrowRight(e, state, actions);
          break;
        case "ArrowUp":
        case "ArrowDown":
          onArrowVertical(e, nav, actions);
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
        case "Tab":
          onTab(e, state, actions, nav);
          break;
      }
    },
    [state, actions, nav],
  );

  return {
    handleKeyDown,
    highlightedSuggestionValue,
    displaySelectables,
    navigationLevel: navLevel,
    resetNavigation,
  };
}

// ---------------------------------------------------------------------------
// Non-navigation handlers (pure - no nav state needed)
// ---------------------------------------------------------------------------

function onArrowLeft<T>(e: React.KeyboardEvent, state: FilterKeyboardState<T>, actions: FilterKeyboardActions): void {
  const { focusedChipIndex, chipCount } = state;

  if (focusedChipIndex >= 0) {
    e.preventDefault();
    if (focusedChipIndex > 0) {
      actions.focusChip(focusedChipIndex - 1);
    }
    return;
  }

  if (chipCount > 0) {
    const atStart = actions.getInputSelectionStart() === 0 && actions.getInputSelectionEnd() === 0;
    if (atStart) {
      e.preventDefault();
      actions.focusChip(chipCount - 1);
    }
  }
}

function onArrowRight<T>(e: React.KeyboardEvent, state: FilterKeyboardState<T>, actions: FilterKeyboardActions): void {
  const { focusedChipIndex, chipCount } = state;

  if (focusedChipIndex < 0) return;

  e.preventDefault();

  if (focusedChipIndex < chipCount - 1) {
    actions.focusChip(focusedChipIndex + 1);
  } else {
    actions.unfocusChips();
    actions.focusInput();
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

// ---------------------------------------------------------------------------
// Navigation handlers (use NavCtx for hierarchical Tab/Enter/Escape)
// ---------------------------------------------------------------------------

function onEscape<T>(
  e: React.KeyboardEvent,
  state: FilterKeyboardState<T>,
  actions: FilterKeyboardActions,
  nav: NavCtx<T>,
): void {
  // Go back from value level → field level
  if (nav.level === "value") {
    e.preventDefault();
    e.stopPropagation();
    nav.setLevel("field");
    nav.setHighlightedIndex(-1);
    nav.setCycleItems(null);
    actions.fillInput("");
    return;
  }

  // Go back from field level → exit navigation
  if (nav.level === "field") {
    e.preventDefault();
    e.stopPropagation();
    nav.reset();
    actions.fillInput("");
    return;
  }

  // Close dropdown
  if (state.isOpen) {
    e.preventDefault();
    e.stopPropagation();
    actions.closeDropdown();
    return;
  }

  // Blur input
  actions.blurInput();
}

function onEnter<T>(
  e: React.KeyboardEvent,
  state: FilterKeyboardState<T>,
  actions: FilterKeyboardActions,
  nav: NavCtx<T>,
): void {
  const { parsedInput, isOpen, inputValue } = state;

  // Dropdown closed → open it
  if (!isOpen) {
    e.preventDefault();
    actions.openDropdown();
    return;
  }

  // Navigation: commit current level
  if (nav.level !== null) {
    e.preventDefault();
    e.stopPropagation();

    // Field level → commit selected item
    if (nav.level === "field" && nav.highlightedIndex >= 0) {
      const items = nav.cycleItems ?? [];
      const current = items[nav.highlightedIndex];
      if (!current) return;

      if (current.kind === "preset") {
        // Preset: select it (handleSelect deals with "preset:" prefix)
        actions.selectSuggestion(current.value);
        return;
      }

      // Field: transition to value level
      actions.fillInput(current.inputValue);
      nav.setLevel("value");
      nav.setHighlightedIndex(-1);
      nav.setCycleItems(null);
      return;
    }

    // Value level → create chip
    if (nav.level === "value" && nav.highlightedIndex >= 0) {
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

  // Manual: field:value → create chip
  if (parsedInput.hasPrefix && parsedInput.field && parsedInput.query.trim()) {
    e.preventDefault();
    e.stopPropagation();
    if (actions.addChipFromParsedInput()) {
      actions.resetInput();
      actions.focusInput();
    }
    return;
  }

  // Prefix without value (e.g., "platform:")
  if (parsedInput.hasPrefix && parsedInput.field && !parsedInput.query.trim()) {
    e.preventDefault();
    e.stopPropagation();
    actions.showError(`Enter a value after "${parsedInput.field.prefix}"`);
    return;
  }

  // Plain text → text search chip
  if (inputValue.trim()) {
    e.preventDefault();
    e.stopPropagation();
    actions.addTextChip(inputValue.trim());
    actions.resetInput();
    actions.focusInput();
  }
}

function onTab<T>(
  e: React.KeyboardEvent,
  state: FilterKeyboardState<T>,
  actions: FilterKeyboardActions,
  nav: NavCtx<T>,
): void {
  const { selectables, isOpen, presetValues } = state;

  // No suggestions/presets and not navigating → let browser handle Tab
  if (nav.level === null && selectables.length === 0 && presetValues.length === 0) return;

  // Already navigating → cycle through items (or re-snapshot if empty after level transition)
  if (nav.level !== null) {
    e.preventDefault();
    if (nav.cycleItems && nav.cycleItems.length > 0) {
      advanceCycle(e.shiftKey ? "backward" : "forward", nav, actions);
    } else {
      // Cycle list empty after level transition (Enter field→value or Escape value→field).
      // Re-snapshot current live selectables to resume cycling.
      enterNavigationMode(state, nav, actions);
    }
    return;
  }

  // Single-match autocomplete (only when user has typed something)
  const hasInput = !!state.inputValue.trim();
  if (hasInput) {
    const valueItems = selectables.filter((s) => s.type === "value");
    if (valueItems.length === 1) {
      e.preventDefault();
      actions.selectSuggestion(valueItems[0].value);
      return;
    }
    if (selectables.length === 1 && selectables[0].type === "field") {
      e.preventDefault();
      actions.fillInput(selectables[0].value);
      return;
    }
  }

  // Multiple cycleable items + dropdown open → enter navigation mode
  // At field level, presets count as cycleable items alongside field suggestions
  const presetCount = !state.parsedInput.hasPrefix ? presetValues.length : 0;
  const cycleCount = presetCount + selectables.length;
  if (cycleCount > 1 && isOpen) {
    e.preventDefault();
    enterNavigationMode(state, nav, actions);
  }
}

// ---------------------------------------------------------------------------
// Navigation cycling (shared by Tab and Arrow keys)
// ---------------------------------------------------------------------------

/** Advance the cycle index in the given direction and fill the input accordingly */
function advanceCycle<T>(direction: "forward" | "backward", nav: NavCtx<T>, actions: FilterKeyboardActions): void {
  const items = nav.cycleItems ?? [];
  if (items.length === 0) return;

  const nextIdx =
    direction === "forward"
      ? (nav.highlightedIndex + 1) % items.length
      : nav.highlightedIndex <= 0
        ? items.length - 1
        : nav.highlightedIndex - 1;

  nav.setHighlightedIndex(nextIdx);
  const item = items[nextIdx];
  if (item) {
    actions.fillInput(item.kind === "preset" ? "" : item.inputValue);
  }
}

/** ArrowUp/ArrowDown: during navigation, cycle through the same list as Tab */
function onArrowVertical<T>(e: React.KeyboardEvent, nav: NavCtx<T>, actions: FilterKeyboardActions): void {
  // Not navigating → let cmdk handle arrow navigation
  if (nav.level === null) return;

  e.preventDefault();
  e.stopPropagation();
  advanceCycle(e.key === "ArrowDown" ? "forward" : "backward", nav, actions);
}

/** Build a cycle list for field-level cycling (presets first, then field suggestions) */
function buildFieldCycleItems<T>(presetValues: string[], selectables: Suggestion<T>[]): CycleItem<T>[] {
  const presets: CycleItem<T>[] = presetValues.map((v) => ({ kind: "preset", value: v }));
  const fields: CycleItem<T>[] = selectables.map((s) => ({
    kind: "suggestion",
    value: s.value,
    inputValue: s.value,
    suggestion: s,
  }));
  return [...presets, ...fields];
}

/** Build a cycle list for value-level cycling */
function buildValueCycleItems<T>(selectables: Suggestion<T>[]): CycleItem<T>[] {
  return selectables.map((s) => ({
    kind: "suggestion",
    value: s.value,
    inputValue: s.field?.prefix ? `${s.field.prefix}${s.value}` : s.value,
    suggestion: s,
  }));
}

/** Enter navigation mode: snapshot current suggestions into a cycle list and highlight the first item */
function enterNavigationMode<T>(state: FilterKeyboardState<T>, nav: NavCtx<T>, actions: FilterKeyboardActions): void {
  const { selectables, parsedInput, presetValues } = state;
  const hasFields = selectables.some((s) => s.type === "field");
  const hasValues = selectables.some((s) => s.type === "value");
  const hasPresets = presetValues.length > 0;

  if ((hasFields || hasPresets) && !parsedInput.hasPrefix) {
    // Field level: cycle through presets + field prefixes
    const items = buildFieldCycleItems(presetValues, selectables);
    nav.setLevel("field");
    nav.setCycleItems(items);
    nav.setHighlightedIndex(0);
    const first = items[0];
    if (first) actions.fillInput(first.kind === "preset" ? "" : first.inputValue);
  } else if (hasValues && parsedInput.hasPrefix) {
    // Value level: cycle through values
    const items = buildValueCycleItems(selectables);
    nav.setLevel("value");
    nav.setCycleItems(items);
    nav.setHighlightedIndex(0);
    const first = items[0];
    if (first?.kind === "suggestion") actions.fillInput(first.inputValue);
  }
}

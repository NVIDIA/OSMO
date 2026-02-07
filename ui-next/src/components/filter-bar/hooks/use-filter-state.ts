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
 * Orchestration hook for FilterBar.
 *
 * Composes useChips + useSuggestions + useFilterKeyboard + local state
 * into a single interface that the FilterBar component consumes.
 *
 * Responsibilities:
 * - Own all local state (input value, dropdown open, focused chip)
 * - Compose child hooks (useChips, useSuggestions, useFilterKeyboard)
 * - Derive computed values (showPresets, showSuggestions, showDropdown)
 * - Provide stable action handlers (useCallback)
 * - Single source of truth for resetInput (was duplicated 4x)
 *
 * The component becomes pure composition: refs + useId + JSX.
 */

import { useState, useCallback, useMemo } from "react";
import type { SearchChip, SearchField, SearchPreset, Suggestion, ParsedInput } from "../lib/types";
import { isAsyncField } from "../lib/types";
import { useChips } from "./use-chips";
import { useSuggestions } from "./use-suggestions";
import { useFilterKeyboard } from "./use-filter-keyboard";
import type { FilterKeyboardActions, FilterKeyboardState } from "./use-filter-keyboard";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface UseFilterStateOptions<T> {
  chips: SearchChip[];
  onChipsChange: (chips: SearchChip[]) => void;
  data: T[];
  fields: readonly SearchField<T>[];
  displayMode?: "free" | "used";
  presets?: { label: string; items: SearchPreset[] }[];
}

// ---------------------------------------------------------------------------
// Return type
// ---------------------------------------------------------------------------

export interface UseFilterStateReturn<T> {
  // State
  inputValue: string;
  isOpen: boolean;
  focusedChipIndex: number;
  validationError: string | null;

  // Derived
  parsedInput: ParsedInput<T>;
  suggestions: Suggestion<T>[];
  selectables: Suggestion<T>[];
  hints: Suggestion<T>[];
  flatPresets: SearchPreset[];
  showPresets: boolean;
  showSuggestions: boolean;
  showDropdown: boolean;
  /** Whether the active field is an async field currently loading data */
  isFieldLoading: boolean;
  /** Label for the loading field (e.g., "users") */
  loadingFieldLabel: string | undefined;

  // Actions (stable refs)
  handleSelect: (value: string) => void;
  handleInputChange: (value: string) => void;
  handleFocus: () => void;
  handleChipRemove: (index: number) => void;
  handleClearAll: () => void;
  handleBlur: (containerEl: HTMLElement | null, relatedTarget: EventTarget | null) => void;
  handleBackdropDismiss: () => void;
  handleKeyDown: (e: React.KeyboardEvent) => void;
  resetInput: () => void;

  // From useChips (needed by component for preset rendering)
  isPresetActive: (preset: SearchPreset) => boolean;

  // Input ref helpers (keyboard hook needs these)
  setInputRefCallbacks: (callbacks: InputRefCallbacks) => void;
}

/** Callbacks the orchestration hook needs from the component's inputRef */
export interface InputRefCallbacks {
  focus: () => void;
  blur: () => void;
  getSelectionStart: () => number | null;
  getSelectionEnd: () => number | null;
}

// ---------------------------------------------------------------------------
// Hook implementation
// ---------------------------------------------------------------------------

export function useFilterState<T>({
  chips,
  onChipsChange,
  data,
  fields,
  displayMode,
  presets,
}: UseFilterStateOptions<T>): UseFilterStateReturn<T> {
  // ========== Local state ==========
  const [inputValue, setInputValue] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [focusedChipIndex, setFocusedChipIndex] = useState(-1);

  // Input ref callbacks (set by the component after render)
  // Using useState to avoid stale closures - the setter is stable
  const [inputCallbacks, setInputRefCallbacks] = useState<InputRefCallbacks>(() => ({
    focus: () => {},
    blur: () => {},
    getSelectionStart: () => null,
    getSelectionEnd: () => null,
  }));

  // ========== Composed hooks ==========

  const {
    addChip,
    removeChip,
    clearChips,
    isPresetActive,
    togglePreset,
    validationError,
    setValidationError,
    clearValidationError,
  } = useChips({
    chips,
    onChipsChange,
    data,
    fields,
    displayMode,
  });

  const { parsedInput, suggestions, flatPresets } = useSuggestions({
    inputValue,
    fields,
    data,
    chips,
    presets,
  });

  // ========== Derived values ==========

  const selectables = useMemo(() => suggestions.filter((s) => s.type !== "hint"), [suggestions]);
  const hints = useMemo(() => suggestions.filter((s) => s.type === "hint"), [suggestions]);

  const showPresets = isOpen && !!presets && presets.length > 0 && inputValue === "";
  const showSuggestions = isOpen && suggestions.length > 0;

  // Async field loading: when user has typed a prefix that matches an async field that is still loading
  const isFieldLoading = !!(
    parsedInput.field &&
    parsedInput.hasPrefix &&
    isAsyncField(parsedInput.field) &&
    parsedInput.field.isLoading
  );
  const loadingFieldLabel = isFieldLoading && parsedInput.field ? parsedInput.field.label : undefined;

  const showDropdown = showPresets || showSuggestions || !!validationError || isFieldLoading;

  // ========== Single source of truth: resetInput ==========

  const resetInput = useCallback(() => {
    setInputValue("");
    setIsOpen(false);
    clearValidationError();
  }, [clearValidationError]);

  // ========== Action handlers ==========

  const handleSelect = useCallback(
    (value: string) => {
      // Preset selection
      if (value.startsWith("preset:")) {
        const presetId = value.slice(7);
        const preset = flatPresets.find((p) => p.id === presetId);
        if (preset) {
          togglePreset(preset);
          setInputValue("");
          setIsOpen(false);
          inputCallbacks.focus();
        }
        return;
      }

      // Find the suggestion by value
      const suggestion = suggestions.find((s) => s.value === value || s.label === value);
      if (!suggestion || suggestion.type === "hint") return;

      if (suggestion.type === "field") {
        // Field prefix selected - fill input with prefix
        setInputValue(suggestion.value);
        inputCallbacks.focus();
      } else {
        // Value selected - create chip
        if (addChip(suggestion.field, suggestion.value)) {
          setInputValue("");
          setIsOpen(false);
          inputCallbacks.focus();
        }
      }
    },
    [suggestions, flatPresets, addChip, togglePreset, inputCallbacks],
  );

  const handleInputChange = useCallback(
    (value: string) => {
      setInputValue(value);
      setIsOpen(true);
      clearValidationError();
      setFocusedChipIndex(-1);
    },
    [clearValidationError],
  );

  const handleFocus = useCallback(() => {
    setIsOpen(true);
    setFocusedChipIndex(-1);
  }, []);

  const handleChipRemove = useCallback(
    (index: number) => {
      removeChip(index);
      setFocusedChipIndex(-1);
    },
    [removeChip],
  );

  const handleClearAll = useCallback(() => {
    clearChips();
  }, [clearChips]);

  const handleBlur = useCallback(
    (containerEl: HTMLElement | null, relatedTarget: EventTarget | null) => {
      if (containerEl && !containerEl.contains(relatedTarget as Node)) {
        setIsOpen(false);
        clearValidationError();
      }
    },
    [clearValidationError],
  );

  const handleBackdropDismiss = useCallback(() => {
    setIsOpen(false);
    clearValidationError();
  }, [clearValidationError]);

  // ========== Keyboard hook ==========

  const keyboardState: FilterKeyboardState<T> = useMemo(
    () => ({
      chipCount: chips.length,
      focusedChipIndex,
      inputValue,
      isOpen,
      parsedInput,
      selectables,
    }),
    [chips.length, focusedChipIndex, inputValue, isOpen, parsedInput, selectables],
  );

  const keyboardActions: FilterKeyboardActions = useMemo(
    () => ({
      focusChip: setFocusedChipIndex,
      unfocusChips: () => setFocusedChipIndex(-1),
      removeChipAtIndex: removeChip,
      resetInput,
      openDropdown: () => setIsOpen(true),
      closeDropdown: () => setIsOpen(false),
      addChipFromParsedInput: () => {
        if (parsedInput.field && parsedInput.query.trim()) {
          return addChip(parsedInput.field, parsedInput.query.trim());
        }
        return false;
      },
      selectSuggestion: handleSelect,
      fillInput: setInputValue,
      showError: setValidationError,
      focusInput: () => inputCallbacks.focus(),
      blurInput: () => inputCallbacks.blur(),
      getInputSelectionStart: () => inputCallbacks.getSelectionStart(),
      getInputSelectionEnd: () => inputCallbacks.getSelectionEnd(),
    }),
    [removeChip, resetInput, parsedInput, addChip, handleSelect, setValidationError, inputCallbacks],
  );

  const { handleKeyDown } = useFilterKeyboard(keyboardState, keyboardActions);

  // ========== Return ==========

  return {
    // State
    inputValue,
    isOpen,
    focusedChipIndex,
    validationError,

    // Derived
    parsedInput,
    suggestions,
    selectables,
    hints,
    flatPresets,
    showPresets,
    showSuggestions,
    showDropdown,
    isFieldLoading,
    loadingFieldLabel,

    // Actions
    handleSelect,
    handleInputChange,
    handleFocus,
    handleChipRemove,
    handleClearAll,
    handleBlur,
    handleBackdropDismiss,
    handleKeyDown,
    resetInput,

    // From useChips
    isPresetActive,

    // Ref helpers
    setInputRefCallbacks,
  };
}

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
 * Composes useChips + useSuggestions + useFilterKeyboard into a single
 * interface that the FilterBar component consumes.
 *
 * Responsibilities:
 * - Own local UI state (input value, dropdown open, focused chip)
 * - Compose child hooks
 * - Derive computed values (showDropdown)
 * - Provide stable action handlers
 *
 * Navigation state (Tab-cycling levels, frozen suggestions) is owned by
 * useFilterKeyboard - this hook only reads its outputs.
 */

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import type { SearchChip, SearchField, SearchPreset, Suggestion } from "@/components/filter-bar/lib/types";
import { isAsyncField } from "@/components/filter-bar/lib/types";
import { useChips } from "@/components/filter-bar/hooks/use-chips";
import { useSuggestions } from "@/components/filter-bar/hooks/use-suggestions";
import { useFilterKeyboard } from "@/components/filter-bar/hooks/use-filter-keyboard";
import type { FilterKeyboardActions, FilterKeyboardState } from "@/components/filter-bar/hooks/use-filter-keyboard";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

interface UseFilterStateOptions<T> {
  chips: SearchChip[];
  onChipsChange: (chips: SearchChip[]) => void;
  data: T[];
  fields: readonly SearchField<T>[];
  displayMode?: "free" | "used";
  presets?: { label: string; items: SearchPreset[] }[];
}

// ---------------------------------------------------------------------------
// Return type (only what the FilterBar component actually consumes)
// ---------------------------------------------------------------------------

interface UseFilterStateReturn<T> {
  // State
  inputValue: string;
  focusedChipIndex: number;
  validationError: string | null;

  // Derived
  selectables: Suggestion<T>[];
  hints: Suggestion<T>[];
  showDropdown: boolean;
  isFieldLoading: boolean;
  loadingFieldLabel: string | undefined;
  highlightedSuggestionValue: string | undefined;

  // Actions
  handleSelect: (value: string) => void;
  handleInputChange: (value: string) => void;
  handleFocus: () => void;
  handleChipRemove: (index: number) => void;
  handleClearAll: () => void;
  handleBlur: (containerEl: HTMLElement | null, relatedTarget: EventTarget | null) => void;
  handleBackdropDismiss: () => void;
  handleKeyDown: (e: React.KeyboardEvent) => void;

  // Preset state
  isPresetActive: (preset: SearchPreset) => boolean;

  // Ref setup
  setInputRefCallbacks: (callbacks: InputRefCallbacks) => void;
}

/** Callbacks the component provides for imperative input access */
interface InputRefCallbacks {
  focus: () => void;
  blur: () => void;
  getSelectionStart: () => number | null;
  getSelectionEnd: () => number | null;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useFilterState<T>({
  chips,
  onChipsChange,
  data,
  fields,
  displayMode,
  presets,
}: UseFilterStateOptions<T>): UseFilterStateReturn<T> {
  // ========== Local UI state ==========

  const [inputValue, setInputValue] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [focusedChipIndex, setFocusedChipIndex] = useState(-1);

  // ========== Input ref (stable ref, not state - avoids extra render on mount) ==========

  const inputCallbacksRef = useRef<InputRefCallbacks>({
    focus: () => {},
    blur: () => {},
    getSelectionStart: () => null,
    getSelectionEnd: () => null,
  });

  const setInputRefCallbacks = useCallback((callbacks: InputRefCallbacks) => {
    inputCallbacksRef.current = callbacks;
  }, []);

  // ========== Bridge: keyboard hook's resetNavigation (populated after hook call) ==========

  const resetNavigationRef = useRef<() => void>(() => {});

  // ========== Composed hooks ==========

  const {
    addChip,
    addTextChip,
    removeChip,
    clearChips,
    isPresetActive,
    togglePreset,
    validationError,
    setValidationError,
    clearValidationError,
  } = useChips({ chips, onChipsChange, data, fields, displayMode });

  const { parsedInput, selectables, hints } = useSuggestions({
    inputValue,
    fields,
    data,
    chips,
    presets,
  });

  // ========== Actions ==========

  const resetInput = useCallback(() => {
    setInputValue("");
    setIsOpen(false);
    clearValidationError();
    resetNavigationRef.current();
  }, [clearValidationError]);

  const handleSelect = useCallback(
    (value: string) => {
      resetNavigationRef.current();

      // Preset selection — preset suggestions are in selectables (type === "preset")
      if (value.startsWith("preset:")) {
        const suggestion = selectables.find((s) => s.value === value);
        if (suggestion?.type === "preset") {
          togglePreset(suggestion.preset);
          setInputValue("");
          setIsOpen(false);
          inputCallbacksRef.current.focus();
        }
        return;
      }

      // Find the field/value suggestion by value
      const suggestion = selectables.find((s) => s.value === value || s.label === value);
      // Narrow to FieldSuggestion (not preset, not hint)
      if (!suggestion || suggestion.type === "hint" || suggestion.type === "preset") return;

      if (suggestion.type === "field") {
        // Field prefix selected - fill input with prefix
        setInputValue(suggestion.value);
        inputCallbacksRef.current.focus();
      } else {
        // Value selected - create chip
        if (addChip(suggestion.field, suggestion.value)) {
          setInputValue("");
          setIsOpen(false);
          inputCallbacksRef.current.focus();
        }
      }
    },
    [selectables, addChip, togglePreset],
  );

  const handleInputChange = useCallback(
    (value: string) => {
      setInputValue(value);
      setIsOpen(true);
      clearValidationError();
      setFocusedChipIndex(-1);
      resetNavigationRef.current();
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
    setInputValue("");
    setIsOpen(false);
    clearValidationError();
    resetNavigationRef.current();
  }, [clearChips, clearValidationError]);

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

  const keyboardState = useMemo<FilterKeyboardState<T>>(
    () => ({
      chipCount: chips.length,
      focusedChipIndex,
      inputValue,
      isOpen,
      parsedInput,
      selectables,
      fields,
    }),
    [chips.length, focusedChipIndex, inputValue, isOpen, parsedInput, selectables, fields],
  );

  const keyboardActions = useMemo<FilterKeyboardActions>(
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
      addTextChip,
      selectSuggestion: handleSelect,
      fillInput: setInputValue,
      showError: setValidationError,
      focusInput: () => inputCallbacksRef.current.focus(),
      blurInput: () => inputCallbacksRef.current.blur(),
      getInputSelectionStart: () => inputCallbacksRef.current.getSelectionStart(),
      getInputSelectionEnd: () => inputCallbacksRef.current.getSelectionEnd(),
    }),
    [removeChip, resetInput, parsedInput, addChip, handleSelect, setValidationError, addTextChip],
  );

  const { handleKeyDown, highlightedSuggestionValue, displaySelectables, navigationLevel, resetNavigation } =
    useFilterKeyboard(keyboardState, keyboardActions);

  // Wire up the bridge ref so resetInput/handleInputChange/handleClearAll can reset navigation
  useEffect(() => {
    resetNavigationRef.current = resetNavigation;
  }, [resetNavigation]);

  // ========== Derived from keyboard + suggestions ==========

  // Only show async loading state when NOT in keyboard navigation
  const isFieldLoading = !!(
    navigationLevel === null &&
    parsedInput.field &&
    parsedInput.hasPrefix &&
    isAsyncField(parsedInput.field) &&
    parsedInput.field.isLoading
  );
  const loadingFieldLabel = isFieldLoading && parsedInput.field ? parsedInput.field.label : undefined;

  // Hints belong to a committed field context. At field level (browsing fields),
  // no field is committed so hints don't apply. At value level or when typing
  // with a prefix, hints flow naturally from the matched field.
  const visibleHints = navigationLevel === "field" ? [] : hints;

  const hasContent = displaySelectables.length > 0 || visibleHints.length > 0;
  // Preset suggestions are in displaySelectables when input is empty, so hasContent covers them.
  const showDropdown = (isOpen && hasContent) || !!validationError || isFieldLoading;

  // ========== Return ==========

  return {
    inputValue,
    focusedChipIndex,
    validationError,
    selectables: displaySelectables,
    hints: visibleHints,
    showDropdown,
    isFieldLoading,
    loadingFieldLabel,
    highlightedSuggestionValue,
    handleSelect,
    handleInputChange,
    handleFocus,
    handleChipRemove,
    handleClearAll,
    handleBlur,
    handleBackdropDismiss,
    handleKeyDown,
    isPresetActive,
    setInputRefCallbacks,
  };
}

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
 * Hook for managing search chips - add, remove, validate, and toggle presets.
 *
 * This is core business logic for chip management, independent of how
 * the UI is rendered. Works with any dropdown implementation.
 */

import { useCallback, useState } from "react";
import type { SearchField, SearchChip, SearchPreset } from "../lib";

export interface UseChipsOptions<T> {
  /** Current chips */
  chips: SearchChip[];
  /** Callback when chips change */
  onChipsChange: (chips: SearchChip[]) => void;
  /** Data for validation */
  data: T[];
  /** Field definitions */
  fields: readonly SearchField<T>[];
  /** Display mode for resolving shorthand fields */
  displayMode?: "free" | "used";
}

export interface UseChipsReturn<T> {
  /** Add a chip for a field/value pair (validates first). Returns true if added. */
  addChip: (field: SearchField<T>, value: string) => boolean;
  /** Remove a chip by index */
  removeChip: (index: number) => void;
  /** Clear all chips */
  clearChips: () => void;
  /** Check if a preset is currently active */
  isPresetActive: (preset: SearchPreset) => boolean;
  /** Toggle a preset on/off */
  togglePreset: (preset: SearchPreset) => void;
  /** Current validation error (null if none) */
  validationError: string | null;
  /** Set a validation error manually */
  setValidationError: (error: string | null) => void;
  /** Clear the validation error */
  clearValidationError: () => void;
}

/**
 * Hook for managing search chip state and operations.
 *
 * Core responsibilities:
 * - Adding chips with validation (custom validators, requiresValidValue)
 * - Removing chips
 * - Preset toggling
 * - Field resolution for shorthand fields
 * - Duplicate prevention
 *
 * This hook is UI-agnostic and can work with any dropdown implementation
 * (custom, cmdk, radix, etc.)
 */
export function useChips<T>({
  chips,
  onChipsChange,
  data,
  fields,
  displayMode,
}: UseChipsOptions<T>): UseChipsReturn<T> {
  const [validationError, setValidationError] = useState<string | null>(null);

  const addChip = useCallback(
    (field: SearchField<T>, value: string): boolean => {
      // Custom validation function takes precedence
      if (field.validate) {
        const result = field.validate(value);
        if (result !== true) {
          setValidationError(typeof result === "string" ? result : "Invalid value");
          return false;
        }
      }
      // For fields that require valid values, check if the value is in the allowed list
      else if (field.requiresValidValue) {
        const validValues = field.getValues(data);
        const isValid = validValues.some((v) => v.toLowerCase() === value.toLowerCase());
        if (!isValid) {
          setValidationError(`"${value}" is not a valid option`);
          return false;
        }
      }

      // Clear any validation error
      setValidationError(null);

      // Resolve shorthand fields to explicit form
      let resolvedField = field;
      let resolvedLabel = `${field.label}: ${value}`;
      let chipVariant = field.variant;

      if (field.resolveTo && displayMode) {
        const targetFieldId = field.resolveTo({ displayMode });
        const targetField = fields.find((f) => f.id === targetFieldId);
        if (targetField) {
          resolvedField = targetField;
          resolvedLabel = `${targetField.label}: ${value}`;
          chipVariant = targetField.variant;
        }
      }

      // Don't add duplicate chips
      const exists = chips.some((c) => c.field === resolvedField.id && c.value.toLowerCase() === value.toLowerCase());
      if (!exists) {
        onChipsChange([
          ...chips,
          {
            field: resolvedField.id,
            value,
            label: resolvedLabel,
            variant: chipVariant,
          },
        ]);
      }

      return true;
    },
    [chips, onChipsChange, data, displayMode, fields],
  );

  const removeChip = useCallback(
    (index: number) => {
      onChipsChange(chips.filter((_, i) => i !== index));
    },
    [chips, onChipsChange],
  );

  const clearChips = useCallback(() => {
    onChipsChange([]);
  }, [onChipsChange]);

  /**
   * Get the chips for a preset (supports both single and multi-chip presets).
   */
  const getPresetChips = useCallback((preset: SearchPreset): SearchChip[] => {
    if (preset.chips && preset.chips.length > 0) {
      return preset.chips;
    }
    if (preset.chip) {
      return [preset.chip];
    }
    return [];
  }, []);

  /**
   * Check if a preset is currently active.
   * For multi-chip presets, ALL chips must be present for the preset to be active.
   */
  const isPresetActive = useCallback(
    (preset: SearchPreset) => {
      const presetChips = getPresetChips(preset);
      if (presetChips.length === 0) return false;

      // All preset chips must be present
      return presetChips.every((presetChip) =>
        chips.some((c) => c.field === presetChip.field && c.value === presetChip.value),
      );
    },
    [chips, getPresetChips],
  );

  /**
   * Toggle a preset on/off.
   * For multi-chip presets:
   * - If active (all present): remove ALL preset chips
   * - If inactive: add ALL missing preset chips
   */
  const togglePreset = useCallback(
    (preset: SearchPreset) => {
      const presetChips = getPresetChips(preset);
      if (presetChips.length === 0) return;

      if (isPresetActive(preset)) {
        // Remove all preset chips
        const presetChipSet = new Set(presetChips.map((c) => `${c.field}:${c.value}`));
        onChipsChange(chips.filter((c) => !presetChipSet.has(`${c.field}:${c.value}`)));
      } else {
        // Add missing preset chips
        const existingSet = new Set(chips.map((c) => `${c.field}:${c.value}`));
        const newChips = [...chips];

        for (const presetChip of presetChips) {
          if (!existingSet.has(`${presetChip.field}:${presetChip.value}`)) {
            newChips.push(presetChip);
          }
        }

        onChipsChange(newChips);
      }
    },
    [chips, onChipsChange, isPresetActive, getPresetChips],
  );

  const clearValidationError = useCallback(() => {
    setValidationError(null);
  }, []);

  return {
    addChip,
    removeChip,
    clearChips,
    isPresetActive,
    togglePreset,
    validationError,
    setValidationError,
    clearValidationError,
  };
}

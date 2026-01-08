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
 * SmartSearch - Intelligent search with chip-based filters.
 *
 * Architecture:
 *
 * lib/ - Pure TypeScript (no React)
 *   - types.ts: SearchField, SearchChip, SearchPreset, Suggestion, ParsedInput
 *   - filter.ts: filterByChips function
 *   - filter.test.ts: Tests for filterByChips
 *
 * hooks/ - Core React hooks (NEVER changes with UI swap)
 *   - use-chips.ts: Chip management (add, remove, validate, presets)
 *   - use-suggestions.ts: Prefix parsing, suggestion generation
 *
 * Flat files - UI layer (REPLACEABLE by cmdk/shadcn)
 *   - use-dropdown-navigation.ts: Keyboard navigation → cmdk handles this
 *   - components.tsx: DropdownHint, DropdownItem, DropdownFooter → CommandItem
 *   - styles.ts: dropdownStyles can be swapped, chipStyles stay
 *
 * When migrating to cmdk:
 *   1. Add components/shadcn/command.tsx
 *   2. Import Command in smart-search.tsx
 *   3. Replace dropdown JSX with Command/CommandList/CommandItem
 *   4. Remove useDropdownNavigation usage
 *   5. Keep: lib/*, hooks/*, ChipLabel, PresetButton/Group, chipStyles
 */

// ============================================================================
// Main Component
// ============================================================================

export { SmartSearch } from "./smart-search";

// ============================================================================
// Library (lib/) - Pure TypeScript, no React
// ============================================================================

// Types
export type {
  ChipVariant,
  SearchField,
  SearchChip,
  SearchPreset,
  PresetRenderProps,
  SmartSearchProps,
  Suggestion,
  ParsedInput,
} from "./lib";

// Pure functions
export { filterByChips } from "./lib";

// ============================================================================
// Hooks (hooks/) - Core React hooks, never change with UI swap
// ============================================================================

export { useChips, type UseChipsOptions, type UseChipsReturn } from "./hooks";
export { useSuggestions, type UseSuggestionsOptions, type UseSuggestionsReturn } from "./hooks";

// ============================================================================
// UI Layer - Replaceable by cmdk/shadcn
// ============================================================================

// Navigation hook (remove when using cmdk)
export {
  useDropdownNavigation,
  type UseDropdownNavigationOptions,
  type UseDropdownNavigationReturn,
} from "./use-dropdown-navigation";

// Components
export {
  // KEEP - core to SmartSearch
  ChipLabel,
  PresetButton,
  PresetGroup,
  // REPLACEABLE - by cmdk CommandItem, CommandEmpty, etc.
  DropdownHint,
  DropdownItem,
  DropdownFooter,
} from "./components";

// Styles
export { dropdownStyles, inputStyles, chipStyles, chipVariantStyles } from "./styles";

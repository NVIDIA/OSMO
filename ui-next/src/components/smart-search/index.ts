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
 * Built on cmdk (via shadcn/ui Command) for keyboard navigation,
 * fuzzy search, and accessibility.
 *
 * Architecture:
 *
 * lib/ - Pure TypeScript (no React)
 *   - types.ts: SearchField, SearchChip, SearchPreset, Suggestion, ParsedInput
 *   - filter.ts: filterByChips function
 *
 * hooks/ - Core React hooks
 *   - use-chips.ts: Chip management (add, remove, validate, presets)
 *   - use-suggestions.ts: Prefix parsing, suggestion generation
 *
 * UI Layer
 *   - smart-search.tsx: Main component using cmdk Command
 *   - components.tsx: ChipLabel, PresetButton/Group
 *   - styles.ts: Shared styles for chips and inputs
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
// Hooks (hooks/) - Core React hooks
// ============================================================================

export { useChips, type UseChipsOptions, type UseChipsReturn } from "./hooks";
export { useSuggestions, type UseSuggestionsOptions, type UseSuggestionsReturn } from "./hooks";

// ============================================================================
// UI Components
// ============================================================================

export { ChipLabel, PresetButton, PresetGroup } from "./components";

// Styles
export { dropdownStyles, inputStyles, chipStyles, chipVariantStyles } from "./styles";

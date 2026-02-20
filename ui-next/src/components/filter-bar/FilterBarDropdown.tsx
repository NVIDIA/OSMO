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
 * FilterBarDropdown - Dropdown panel with presets, hints, and virtualized suggestions.
 *
 * Features:
 * - Automatic virtualization when suggestion content exceeds container height
 * - CSS containment and GPU-accelerated positioning for 60fps scrolling
 * - Works with both sync and async fields
 * - Smooth fallback to regular rendering for small lists
 *
 * Virtualization strategy:
 * - CommandGroup wraps the virtualizer scroll container
 * - CommandItems are rendered only for visible rows (+ overscan)
 * - cmdk keyboard navigation works within the visible window
 * - Users filter by typing to narrow large lists, not by arrowing through all items
 */

"use client";

import { memo, useRef, useMemo, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { CommandList, CommandItem, CommandGroup } from "@/components/shadcn/command";
import { useVirtualizerCompat } from "@/hooks/use-virtualizer-compat";
import type { SearchPreset, Suggestion } from "@/components/filter-bar/lib/types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Height of each suggestion row in pixels (matches CommandItem py-1.5 + text-sm) */
const ROW_HEIGHT = 32;

/**
 * Maximum visible height of the dropdown content area.
 * Derived from the dropdown container's max-h-[300px] minus space for
 * validation error (~36px), presets (~44px), hints (~36px), and footer (~32px).
 * This is the scroll viewport for suggestions only.
 */
const MAX_SUGGESTIONS_HEIGHT = 300;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface FilterBarDropdownProps<T> {
  /** Whether the dropdown is visible */
  showDropdown: boolean;
  /** Current validation error message */
  validationError: string | null;
  /** Whether to show preset buttons */
  showPresets: boolean;
  /** Preset groups to display */
  presets?: { label: string; items: SearchPreset[] }[];
  /** Non-interactive hint items */
  hints: Suggestion<T>[];
  /** Selectable suggestion items (field prefixes + values) */
  selectables: Suggestion<T>[];
  /** Called when a suggestion or preset is selected */
  onSelect: (value: string) => void;
  /** Called when backdrop is clicked to dismiss */
  onBackdropClick: (e: React.MouseEvent) => void;
  /** Check if a preset is currently active */
  isPresetActive: (preset: SearchPreset) => boolean;
  /** Whether the active field is an async field currently loading data */
  isFieldLoading?: boolean;
  /** Label for the loading field (e.g., "users") - shown in loading message */
  loadingFieldLabel?: string;
  /** Currently highlighted cmdk value — drives scroll-into-view */
  highlightedSuggestionValue?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function FilterBarDropdownInner<T>({
  showDropdown,
  validationError,
  showPresets,
  presets,
  hints,
  selectables,
  onSelect,
  onBackdropClick,
  isPresetActive,
  isFieldLoading,
  loadingFieldLabel,
  highlightedSuggestionValue,
}: FilterBarDropdownProps<T>) {
  const listRef = useRef<HTMLDivElement>(null);

  // Scroll the highlighted CommandItem into view (presets + non-virtualized suggestions).
  // For virtualized suggestions, VirtualizedSuggestions handles its own scrollToIndex.
  useEffect(() => {
    if (!highlightedSuggestionValue || !listRef.current) return;
    // Use rAF so the DOM has updated after React's render (especially after virtualizer re-render)
    requestAnimationFrame(() => {
      const el = listRef.current?.querySelector<HTMLElement>(
        `[cmdk-item][data-value="${CSS.escape(highlightedSuggestionValue)}"]`,
      );
      el?.scrollIntoView({ block: "nearest" });
    });
  }, [highlightedSuggestionValue]);

  if (!showDropdown) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed-below-header z-40"
        onClick={onBackdropClick}
        aria-hidden="true"
      />

      {/* Dropdown panel */}
      <div
        ref={listRef}
        className="fb-dropdown bg-popover"
        data-error={validationError ? "" : undefined}
      >
        {/* Validation error */}
        {validationError && <div className="fb-validation-error">⚠ {validationError}</div>}

        {/* Scrollable content area - cmdk handles keyboard navigation */}
        <CommandList className="max-h-none min-h-0 flex-1 overflow-y-auto">
          {/* Presets (shown when input is empty) */}
          {showPresets && (
            <PresetsSection
              presets={presets}
              onSelect={onSelect}
              isPresetActive={isPresetActive}
            />
          )}

          {/* Hints (non-interactive, shown above suggestions) */}
          {hints.length > 0 && <HintsSection hints={hints} />}

          {/* Async field loading state */}
          {isFieldLoading ? (
            <LoadingSection label={loadingFieldLabel} />
          ) : (
            /* Suggestions - virtualized when large */
            selectables.length > 0 && (
              <SuggestionsSection
                selectables={selectables}
                onSelect={onSelect}
                highlightedSuggestionValue={highlightedSuggestionValue}
              />
            )
          )}
        </CommandList>

        {/* Footer */}
        <div className="fb-footer border-border">
          <kbd className="fb-footer-kbd">↑↓</kbd> <kbd className="fb-footer-kbd">Tab</kbd> fill{" "}
          <kbd className="fb-footer-kbd">Enter</kbd> accept <kbd className="fb-footer-kbd">Esc</kbd> undo
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Presets Section
// ---------------------------------------------------------------------------

interface PresetsSectionProps {
  presets?: { label: string; items: SearchPreset[] }[];
  onSelect: (value: string) => void;
  isPresetActive: (preset: SearchPreset) => boolean;
}

const PresetsSection = memo(function PresetsSection({ presets, onSelect, isPresetActive }: PresetsSectionProps) {
  if (!presets) return null;

  return (
    <>
      {presets.map((group) => (
        <CommandGroup
          key={group.label}
          heading={group.label}
          className="fb-preset-group"
        >
          {group.items.map((preset) => (
            <CommandItem
              key={preset.id}
              value={`preset:${preset.id}`}
              onSelect={onSelect}
              className="group w-auto bg-transparent p-0"
            >
              {preset.render({ active: isPresetActive(preset), focused: false })}
            </CommandItem>
          ))}
        </CommandGroup>
      ))}
    </>
  );
});

// ---------------------------------------------------------------------------
// Hints Section
// ---------------------------------------------------------------------------

interface HintsSectionProps<T> {
  hints: Suggestion<T>[];
}

function HintsSectionInner<T>({ hints }: HintsSectionProps<T>) {
  return (
    <div className="fb-section-border">
      {hints.map((hint, index) => (
        <div
          key={`hint-${hint.field.id}-${index}`}
          className="fb-dropdown-item fb-hint"
        >
          {hint.label}
        </div>
      ))}
    </div>
  );
}

const HintsSection = memo(HintsSectionInner) as typeof HintsSectionInner;

// ---------------------------------------------------------------------------
// Loading Section (async field data loading)
// ---------------------------------------------------------------------------

interface LoadingSectionProps {
  label?: string;
}

const LoadingSection = memo(function LoadingSection({ label }: LoadingSectionProps) {
  return (
    <div
      className="fb-dropdown-item fb-loading"
      role="status"
      aria-live="polite"
    >
      <Loader2 className="text-muted-foreground size-4 animate-spin" />
      <span className="text-muted-foreground">Loading {label ? label.toLowerCase() : "suggestions"}...</span>
    </div>
  );
});

// ---------------------------------------------------------------------------
// Suggestions Section (with automatic virtualization)
// ---------------------------------------------------------------------------

interface SuggestionsSectionProps<T> {
  selectables: Suggestion<T>[];
  onSelect: (value: string) => void;
  highlightedSuggestionValue?: string;
}

function SuggestionsSectionInner<T>({ selectables, onSelect, highlightedSuggestionValue }: SuggestionsSectionProps<T>) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Automatic virtualization: only when content exceeds visible area
  const totalContentHeight = selectables.length * ROW_HEIGHT;
  const shouldVirtualize = totalContentHeight > MAX_SUGGESTIONS_HEIGHT;

  if (!shouldVirtualize) {
    return (
      <RegularSuggestions
        selectables={selectables}
        onSelect={onSelect}
      />
    );
  }

  return (
    <VirtualizedSuggestions
      selectables={selectables}
      onSelect={onSelect}
      scrollRef={scrollRef}
      highlightedSuggestionValue={highlightedSuggestionValue}
    />
  );
}

const SuggestionsSection = memo(SuggestionsSectionInner) as typeof SuggestionsSectionInner;

// ---------------------------------------------------------------------------
// Regular (non-virtualized) Suggestions
// ---------------------------------------------------------------------------

interface RegularSuggestionsProps<T> {
  selectables: Suggestion<T>[];
  onSelect: (value: string) => void;
}

function RegularSuggestionsInner<T>({ selectables, onSelect }: RegularSuggestionsProps<T>) {
  return (
    <CommandGroup>
      {selectables.map((suggestion, index) => (
        <SuggestionItem
          key={`${suggestion.type}-${suggestion.field.id}-${suggestion.value}-${index}`}
          suggestion={suggestion}
          onSelect={onSelect}
        />
      ))}
    </CommandGroup>
  );
}

const RegularSuggestions = memo(RegularSuggestionsInner) as typeof RegularSuggestionsInner;

// ---------------------------------------------------------------------------
// Virtualized Suggestions
// ---------------------------------------------------------------------------

interface VirtualizedSuggestionsProps<T> {
  selectables: Suggestion<T>[];
  onSelect: (value: string) => void;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  highlightedSuggestionValue?: string;
}

function VirtualizedSuggestionsInner<T>({
  selectables,
  onSelect,
  scrollRef,
  highlightedSuggestionValue,
}: VirtualizedSuggestionsProps<T>) {
  const virtualizer = useVirtualizerCompat({
    count: selectables.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 5,
  });

  // Scroll the virtualizer to the highlighted item so it's rendered in the DOM
  const highlightedIdx = useMemo(
    () => (highlightedSuggestionValue ? selectables.findIndex((s) => s.value === highlightedSuggestionValue) : -1),
    [highlightedSuggestionValue, selectables],
  );

  useEffect(() => {
    if (highlightedIdx >= 0) {
      virtualizer.scrollToIndex(highlightedIdx, { align: "auto" });
    }
  }, [highlightedIdx, virtualizer]);

  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();

  return (
    <CommandGroup className="p-0">
      {/* Scroll container with CSS containment for performance */}
      <div
        ref={scrollRef}
        className="fb-suggestions-scroll"
      >
        {/* Spacer element sized to total content height */}
        <div
          className="relative w-full"
          style={{ height: totalSize }}
        >
          {virtualItems.map((virtualRow) => {
            const suggestion = selectables[virtualRow.index];
            return (
              <div
                key={`${suggestion.type}-${suggestion.field.id}-${suggestion.value}-${virtualRow.index}`}
                className="gpu-layer absolute left-0 w-full"
                style={{
                  height: virtualRow.size,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <SuggestionItem
                  suggestion={suggestion}
                  onSelect={onSelect}
                />
              </div>
            );
          })}
        </div>
      </div>
    </CommandGroup>
  );
}

const VirtualizedSuggestions = memo(VirtualizedSuggestionsInner) as typeof VirtualizedSuggestionsInner;

// ---------------------------------------------------------------------------
// Single Suggestion Item (shared between regular and virtualized)
// ---------------------------------------------------------------------------

interface SuggestionItemProps<T> {
  suggestion: Suggestion<T>;
  onSelect: (value: string) => void;
}

function SuggestionItemInner<T>({ suggestion, onSelect }: SuggestionItemProps<T>) {
  return (
    <CommandItem
      value={suggestion.value}
      onSelect={onSelect}
      className="flex items-center gap-1"
    >
      <span className="flex items-center gap-2">
        {suggestion.type === "field" ? (
          <span className="fb-suggestion-field-prefix">{suggestion.label}</span>
        ) : (
          <span>{suggestion.label}</span>
        )}
      </span>
      {suggestion.hint && <span className="text-muted-foreground ml-2 shrink-0 text-xs">{suggestion.hint}</span>}
    </CommandItem>
  );
}

const SuggestionItem = memo(SuggestionItemInner) as typeof SuggestionItemInner;

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const FilterBarDropdown = memo(FilterBarDropdownInner) as typeof FilterBarDropdownInner;

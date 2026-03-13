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
 * FilterBarDatePicker - Thin wrapper around DateRangePicker that adds
 * FilterBar-specific keyboard cycling, focus sentinels, and the
 * onCommit(string) interface expected by the filter bar.
 */

"use client";

import { memo, useRef, useEffect, useCallback } from "react";
import { DATE_RANGE_PRESETS } from "@/lib/date-range-utils";
import { DATE_CUSTOM_FROM, DATE_CUSTOM_TO, DATE_CUSTOM_APPLY } from "@/components/filter-bar/lib/types";
import { DateRangePicker, type DateRangePickerResult } from "@/components/date-range-picker/date-range-picker";

interface FilterBarDatePickerProps {
  /** Called when a date or range is committed. Value is preset label, ISO date, or ISO range. */
  onCommit: (value: string) => void;
  /** Preset label currently highlighted via keyboard navigation (shows active indicator). */
  highlightedLabel?: string;
  /** Called when Tab/Shift-Tab should wrap the cycle (e.g. Tab past Apply, Shift-Tab on From). */
  onCycleStep?: (direction: "forward" | "backward", fromValue: string) => void;
  /** Called when Escape is pressed to close the date picker / dropdown. */
  onClose?: () => void;
}

export const FilterBarDatePicker = memo(function FilterBarDatePicker({
  onCommit,
  highlightedLabel,
  onCycleStep,
  onClose,
}: FilterBarDatePickerProps) {
  const fromRef = useRef<HTMLInputElement>(null);
  const toRef = useRef<HTMLInputElement>(null);
  const applyRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (highlightedLabel === DATE_CUSTOM_FROM) {
      fromRef.current?.focus();
    } else if (highlightedLabel === DATE_CUSTOM_TO) {
      toRef.current?.focus();
    } else if (highlightedLabel === DATE_CUSTOM_APPLY) {
      applyRef.current?.focus();
    }
  }, [highlightedLabel]);

  // Resolve refs to the date picker's inner inputs/button on mount.
  // The general DateRangePicker uses ids "drp-from", "drp-to" for its inputs.
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const from = container.querySelector<HTMLInputElement>("#drp-from");
    const to = container.querySelector<HTMLInputElement>("#drp-to");
    const apply = container.querySelector<HTMLButtonElement>(".fb-date-apply");
    if (from) (fromRef as React.MutableRefObject<HTMLInputElement | null>).current = from;
    if (to) (toRef as React.MutableRefObject<HTMLInputElement | null>).current = to;
    if (apply) (applyRef as React.MutableRefObject<HTMLButtonElement | null>).current = apply;
  }, []);

  const handleCommit = useCallback(
    (result: DateRangePickerResult) => {
      onCommit(result.value);
    },
    [onCommit],
  );

  return (
    <div
      ref={containerRef}
      role="none"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          e.preventDefault();
          onClose?.();
        } else if (e.key === "Tab" && !e.shiftKey && e.target === applyRef.current) {
          e.preventDefault();
          onCycleStep?.("forward", DATE_CUSTOM_APPLY);
        } else {
          e.stopPropagation();
        }
      }}
    >
      <DateRangePicker
        presets={DATE_RANGE_PRESETS}
        activePresetLabel={highlightedLabel}
        onCommit={handleCommit}
      />
      {/* Focus sentinel for keyboard cycling */}
      <span
        tabIndex={0}
        aria-hidden="true"
        className="sr-only"
        onFocus={() => onCycleStep?.("forward", DATE_CUSTOM_APPLY)}
      />
    </div>
  );
});

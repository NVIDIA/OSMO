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
 * FilterBarDatePicker - Date/range picker panel rendered inside the FilterBar dropdown.
 *
 * B1 "Split Rail" layout: preset list on the left with active indicator,
 * stacked From/To date inputs on the right.
 *
 * Selecting a preset or applying custom dates calls onCommit(value) where value
 * is either a preset label ("last 7 days"), a single ISO date ("2026-03-11"),
 * or an ISO range ("2026-03-01..2026-03-11").
 */

"use client";

import { useState, useCallback, useMemo, memo, useRef, useEffect } from "react";
import { DATE_RANGE_PRESETS } from "@/lib/date-range-utils";
import { DATE_CUSTOM_FROM, DATE_CUSTOM_TO, DATE_CUSTOM_APPLY } from "@/components/filter-bar/lib/types";
import { MONTHS_SHORT } from "@/lib/format-date";

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

/** Format a UTC YYYY-MM-DD string as "Mar 4" or "Mar 4 '25" (if year differs from currentYear). */
function fmtUtcDate(isoDate: string, currentYear: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  const mon = MONTHS_SHORT[d.getUTCMonth()];
  const day = d.getUTCDate();
  const year = d.getUTCFullYear();
  return year !== currentYear ? `${mon} ${day} '${String(year).slice(2)}` : `${mon} ${day}`;
}

/**
 * Build hint text from the raw preset value (before next-midnight adjustment).
 * Single date → "Mar 11"; range → "Mar 4 – Mar 11".
 */
function buildPresetHint(rawValue: string, currentYear: number): string {
  if (rawValue.includes("..")) {
    const sep = rawValue.indexOf("..");
    return `${fmtUtcDate(rawValue.slice(0, sep), currentYear)} – ${fmtUtcDate(rawValue.slice(sep + 2), currentYear)}`;
  }
  return fmtUtcDate(rawValue, currentYear);
}

export const FilterBarDatePicker = memo(function FilterBarDatePicker({
  onCommit,
  highlightedLabel,
  onCycleStep,
  onClose,
}: FilterBarDatePickerProps) {
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const fromRef = useRef<HTMLInputElement>(null);
  const toRef = useRef<HTMLInputElement>(null);
  const applyRef = useRef<HTMLButtonElement>(null);

  // When keyboard navigation highlights a custom input sentinel, move DOM focus there.
  // For the To input, also open the calendar picker — programmatic focus() always lands
  // at the first sub-field (MM), but entering backward should start at the calendar end.
  useEffect(() => {
    if (highlightedLabel === DATE_CUSTOM_FROM) {
      fromRef.current?.focus();
    } else if (highlightedLabel === DATE_CUSTOM_TO) {
      toRef.current?.focus();
    } else if (highlightedLabel === DATE_CUSTOM_APPLY) {
      applyRef.current?.focus();
    }
  }, [highlightedLabel]);

  // Compute once per render (client-only component, only mounted on interaction).
  const currentYear = useMemo(() => new Date().getUTCFullYear(), []);

  const presetHints = useMemo(
    () => Object.fromEntries(DATE_RANGE_PRESETS.map((p) => [p.label, buildPresetHint(p.getValue(), currentYear)])),
    [currentYear],
  );

  // toDate must be strictly after fromDate (same minute = zero-second window after +1min adjustment)
  const rangeError = !!fromDate && !!toDate && toDate <= fromDate;

  const handleApply = useCallback(() => {
    if (!fromDate || rangeError) return;
    if (toDate) {
      onCommit(`${fromDate}..${toDate}`);
    } else {
      onCommit(fromDate);
    }
  }, [fromDate, toDate, rangeError, onCommit]);

  const handleFromChange = useCallback((value: string) => {
    setFromDate(value);
    // Clear "to" if it's now at or before "from" (equal = invalid range after +1min adjustment)
    setToDate((prev) => (prev && prev <= value ? "" : prev));
  }, []);

  return (
    <div
      className="fb-date-picker"
      role="none"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          e.preventDefault();
          onClose?.();
        } else {
          e.stopPropagation();
        }
      }}
    >
      <div className="fb-date-split">
        {/* Left rail: presets with right-aligned date hints */}
        <div className="fb-date-rail">
          <div className="fb-date-section-label">Presets</div>
          {DATE_RANGE_PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              tabIndex={-1}
              className="fb-date-preset-row"
              data-active={highlightedLabel === preset.label ? "" : undefined}
              onClick={() => onCommit(preset.label)}
            >
              <span className="fb-date-preset-label">{preset.label}</span>
              <span className="fb-date-preset-hint">{presetHints[preset.label]}</span>
            </button>
          ))}
        </div>

        {/* Right: custom range */}
        <div className="fb-date-custom">
          <div className="fb-date-section-label">Custom range</div>
          <div className="fb-date-field">
            <label
              className="fb-date-label"
              htmlFor="fb-date-from"
            >
              From
            </label>
            <input
              ref={fromRef}
              id="fb-date-from"
              type="datetime-local"
              value={fromDate}
              onChange={(e) => handleFromChange(e.target.value)}
              className="fb-date-input"
            />
          </div>
          <div className="fb-date-field">
            <label
              className="fb-date-label"
              htmlFor="fb-date-to"
            >
              To
            </label>
            <input
              ref={toRef}
              id="fb-date-to"
              type="datetime-local"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              min={fromDate || undefined}
              className="fb-date-input"
              data-error={rangeError ? "" : undefined}
              aria-invalid={rangeError}
              aria-describedby={rangeError ? "fb-date-range-error" : undefined}
            />
            {rangeError && (
              <span
                id="fb-date-range-error"
                className="fb-date-error"
                role="alert"
              >
                &ldquo;To&rdquo; must be after &ldquo;From&rdquo;
              </span>
            )}
          </div>
          <button
            ref={applyRef}
            type="button"
            onClick={handleApply}
            disabled={!fromDate || rangeError}
            onKeyDown={(e) => {
              if (e.key === "Tab" && !e.shiftKey) {
                e.preventDefault();
                onCycleStep?.("forward", DATE_CUSTOM_APPLY);
              }
            }}
            className="fb-date-apply"
          >
            Apply →
          </button>
        </div>
      </div>
      {/* Focus sentinel: the last focusable element inside the picker.
          When Tab exits Apply (or To when Apply is disabled), the browser naturally
          focuses this sentinel. onFocus immediately redirects back into the cycle,
          keeping focus trapped inside the filter bar. It must live inside the picker
          (inside the container) so handleBlur sees relatedTarget as within-container. */}
      <span
        tabIndex={0}
        aria-hidden="true"
        className="sr-only"
        onFocus={() => onCycleStep?.("forward", DATE_CUSTOM_APPLY)}
      />
    </div>
  );
});

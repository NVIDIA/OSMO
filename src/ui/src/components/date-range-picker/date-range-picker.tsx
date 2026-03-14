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

"use client";

import { useState, useCallback, useMemo, memo } from "react";
import { MONTHS_SHORT } from "@/lib/format-date";
import "@/components/date-range-picker/date-range-picker.css";

export interface DateRangePresetItem {
  label: string;
  getValue: () => string;
}

export interface DateRangePickerResult {
  /** Either a preset label, a single ISO datetime, or a "from..to" range */
  value: string;
  kind: "preset" | "custom";
}

interface DateRangePickerProps {
  presets?: DateRangePresetItem[];
  activePresetLabel?: string;
  /** Pre-fill the "From" input (datetime-local format: "YYYY-MM-DDTHH:MM") */
  initialFrom?: string;
  /** Pre-fill the "To" input (datetime-local format: "YYYY-MM-DDTHH:MM") */
  initialTo?: string;
  onCommit: (result: DateRangePickerResult) => void;
}

function fmtUtcDate(isoDate: string, currentYear: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  const mon = MONTHS_SHORT[d.getUTCMonth()];
  const day = d.getUTCDate();
  const year = d.getUTCFullYear();
  return year !== currentYear ? `${mon} ${day} '${String(year).slice(2)}` : `${mon} ${day}`;
}

function buildPresetHint(rawValue: string, currentYear: number): string {
  if (rawValue.includes("..")) {
    const sep = rawValue.indexOf("..");
    return `${fmtUtcDate(rawValue.slice(0, sep), currentYear)} – ${fmtUtcDate(rawValue.slice(sep + 2), currentYear)}`;
  }
  return fmtUtcDate(rawValue, currentYear);
}

export const DateRangePicker = memo(function DateRangePicker({
  presets,
  activePresetLabel,
  initialFrom,
  initialTo,
  onCommit,
}: DateRangePickerProps) {
  const [fromDate, setFromDate] = useState(initialFrom ?? "");
  const [toDate, setToDate] = useState(initialTo ?? "");

  const hasPresets = presets != null && presets.length > 0;

  const currentYear = useMemo(() => new Date().getUTCFullYear(), []);

  const presetHints = useMemo(
    () =>
      hasPresets ? Object.fromEntries(presets.map((p) => [p.label, buildPresetHint(p.getValue(), currentYear)])) : {},
    [presets, currentYear, hasPresets],
  );

  const rangeError = !!fromDate && !!toDate && toDate <= fromDate;

  const handleApply = useCallback(() => {
    if (!fromDate || rangeError) return;
    const value = toDate ? `${fromDate}..${toDate}` : fromDate;
    onCommit({ value, kind: "custom" });
  }, [fromDate, toDate, rangeError, onCommit]);

  const handleFromChange = useCallback((value: string) => {
    setFromDate(value);
    setToDate((prev) => (prev && prev <= value ? "" : prev));
  }, []);

  const customRangePanel = (
    <div className="fb-date-custom">
      {hasPresets && <div className="fb-date-section-label">Custom range</div>}
      <div className="fb-date-field">
        <label
          className="fb-date-label"
          htmlFor="drp-from"
        >
          From
        </label>
        <input
          id="drp-from"
          type="datetime-local"
          value={fromDate}
          onChange={(e) => handleFromChange(e.target.value)}
          className="fb-date-input"
        />
      </div>
      <div className="fb-date-field">
        <label
          className="fb-date-label"
          htmlFor="drp-to"
        >
          To
        </label>
        <input
          id="drp-to"
          type="datetime-local"
          value={toDate}
          onChange={(e) => setToDate(e.target.value)}
          min={fromDate || undefined}
          className="fb-date-input"
          data-error={rangeError ? "" : undefined}
          aria-invalid={rangeError}
          aria-describedby={rangeError ? "drp-range-error" : undefined}
        />
        {rangeError && (
          <span
            id="drp-range-error"
            className="fb-date-error"
            role="alert"
          >
            &ldquo;To&rdquo; must be after &ldquo;From&rdquo;
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={handleApply}
        disabled={!fromDate || rangeError}
        className="fb-date-apply"
      >
        Apply →
      </button>
    </div>
  );

  if (!hasPresets) {
    return (
      <div
        className="fb-date-picker"
        role="none"
      >
        {customRangePanel}
      </div>
    );
  }

  return (
    <div
      className="fb-date-picker"
      role="none"
    >
      <div className="fb-date-split">
        <div className="fb-date-rail">
          <div className="fb-date-section-label">Presets</div>
          {presets.map((preset) => (
            <button
              key={preset.label}
              type="button"
              className="fb-date-preset-row"
              data-active={activePresetLabel === preset.label ? "" : undefined}
              onClick={() => onCommit({ value: preset.label, kind: "preset" })}
            >
              <span className="fb-date-preset-label">{preset.label}</span>
              <span className="fb-date-preset-hint">{presetHints[preset.label]}</span>
            </button>
          ))}
        </div>
        {customRangePanel}
      </div>
    </div>
  );
});

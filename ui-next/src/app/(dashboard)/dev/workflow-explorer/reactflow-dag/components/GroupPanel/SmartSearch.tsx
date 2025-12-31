// Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

/**
 * SmartSearch Component
 *
 * Intelligent search input with chip-based filters, autocomplete suggestions,
 * and support for field-specific queries (status:, node:, duration:, etc.).
 *
 * Features:
 * - Chip-based filter accumulation
 * - Field prefix detection (e.g., "status:", "node:")
 * - Smart suggestions based on data
 * - Natural language time parsing via chrono-node
 * - GPU-accelerated dropdown
 */

"use client";

import { useState, useMemo, useCallback, memo, useRef, useEffect, useDeferredValue, startTransition } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

// ============================================================================
// Lazy-loaded chrono-node with idle prefetch
// ============================================================================

/**
 * chrono-node is lazy-loaded to reduce initial bundle size (~40KB).
 * It's prefetched during browser idle time, so it's ready when needed.
 */
let chronoModule: typeof import("chrono-node") | null = null;
let chronoLoadPromise: Promise<typeof import("chrono-node")> | null = null;

// Prefetch during browser idle time (non-blocking)
if (typeof window !== "undefined" && "requestIdleCallback" in window) {
  requestIdleCallback(
    () => {
      chronoLoadPromise = import("chrono-node").then((m) => {
        chronoModule = m;
        return m;
      });
    },
    { timeout: 5000 } // Load within 5 seconds even if not idle
  );
} else if (typeof window !== "undefined") {
  // Fallback for browsers without requestIdleCallback (Safari)
  setTimeout(() => {
    chronoLoadPromise = import("chrono-node").then((m) => {
      chronoModule = m;
      return m;
    });
  }, 2000);
}

/**
 * Get chrono module, loading it if not already loaded.
 * Returns null if not yet loaded (sync access).
 */
function getChronoSync(): typeof import("chrono-node") | null {
  return chronoModule;
}

/**
 * Ensure chrono is loaded (for prefetch on focus).
 */
function ensureChronoLoaded(): void {
  if (!chronoModule && !chronoLoadPromise) {
    chronoLoadPromise = import("chrono-node").then((m) => {
      chronoModule = m;
      return m;
    });
  }
}
import { STATE_CATEGORIES, STATE_CATEGORY_NAMES, STATUS_LABELS, type StateCategory } from "../../utils/status";
import type { TaskWithDuration, SearchChip, SearchField } from "../../types/table";

// ============================================================================
// Field Definitions
// ============================================================================

/**
 * Parse duration string like "1m", "30s", "2h", "1h30m" into milliseconds.
 */
function parseDurationString(str: string): number | null {
  const normalized = str.toLowerCase().trim();
  if (!normalized) return null;

  let totalMs = 0;
  let remaining = normalized;

  const regex = /^(\d+(?:\.\d+)?)\s*(h|m|s|ms)/;
  let hasMatch = false;

  while (remaining.length > 0) {
    const match = regex.exec(remaining);
    if (match) {
      hasMatch = true;
      const num = parseFloat(match[1]);
      const unit = match[2];
      switch (unit) {
        case "h": totalMs += num * 60 * 60 * 1000; break;
        case "m": totalMs += num * 60 * 1000; break;
        case "s": totalMs += num * 1000; break;
        case "ms": totalMs += num; break;
      }
      remaining = remaining.slice(match[0].length).trim();
    } else {
      break;
    }
  }

  if (hasMatch && remaining.length === 0) return totalMs;
  if (!hasMatch && /^\d+(?:\.\d+)?$/.test(normalized)) {
    return parseFloat(normalized) * 1000;
  }
  return null;
}

/**
 * Compare a value using operator prefix (>, >=, <, <=, =).
 */
function compareWithOperator(
  taskValue: number,
  filterValue: string,
  parser: (s: string) => number | null,
): boolean {
  const trimmed = filterValue.trim();
  let operator = ">=";
  let valueStr = trimmed;

  if (trimmed.startsWith(">=")) { operator = ">="; valueStr = trimmed.slice(2); }
  else if (trimmed.startsWith("<=")) { operator = "<="; valueStr = trimmed.slice(2); }
  else if (trimmed.startsWith(">")) { operator = ">"; valueStr = trimmed.slice(1); }
  else if (trimmed.startsWith("<")) { operator = "<"; valueStr = trimmed.slice(1); }
  else if (trimmed.startsWith("=")) { operator = "="; valueStr = trimmed.slice(1); }

  const compareValue = parser(valueStr.trim());
  if (compareValue === null) return false;

  switch (operator) {
    case ">": return taskValue > compareValue;
    case ">=": return taskValue >= compareValue;
    case "<": return taskValue < compareValue;
    case "<=": return taskValue <= compareValue;
    case "=": return taskValue === compareValue;
    default: return false;
  }
}

// LRU cache for chrono parsing
const chronoCache = new Map<string, Date | null>();
const CHRONO_CACHE_MAX = 100;

/**
 * Parse natural language date string using chrono-node.
 * Uses LRU cache for performance.
 * Returns null if chrono isn't loaded yet (shouldn't happen with prefetch).
 */
function parseDateTime(input: string): Date | null {
  if (!input?.trim()) return null;
  const key = input.trim().toLowerCase();
  if (chronoCache.has(key)) return chronoCache.get(key)!;

  // Get chrono module (may be null if not yet loaded)
  const chrono = getChronoSync();
  if (!chrono) return null; // Chrono not loaded yet - graceful degradation

  const result = chrono.parseDate(input);
  if (chronoCache.size >= CHRONO_CACHE_MAX) {
    const firstKey = chronoCache.keys().next().value;
    if (firstKey) chronoCache.delete(firstKey);
  }
  chronoCache.set(key, result);
  return result;
}

function normalizeTimeFilter(input: string): { display: string; value: string; operator: string } | null {
  let operator = ">=";
  let dateStr = input.trim();

  if (dateStr.startsWith(">=")) { operator = ">="; dateStr = dateStr.slice(2).trim(); }
  else if (dateStr.startsWith("<=")) { operator = "<="; dateStr = dateStr.slice(2).trim(); }
  else if (dateStr.startsWith(">")) { operator = ">"; dateStr = dateStr.slice(1).trim(); }
  else if (dateStr.startsWith("<")) { operator = "<"; dateStr = dateStr.slice(1).trim(); }
  else if (dateStr.startsWith("=")) { operator = "="; dateStr = dateStr.slice(1).trim(); }

  const lastMatch = dateStr.toLowerCase().match(/^last\s+(\d+)\s*(h|d|m|w|hours?|days?|minutes?|weeks?)$/);
  let parsed: Date | null = null;

  if (lastMatch) {
    const num = parseInt(lastMatch[1]);
    const unit = lastMatch[2];
    const now = Date.now();
    let offsetMs = 0;

    if (unit.startsWith("h")) offsetMs = num * 60 * 60 * 1000;
    else if (unit.startsWith("d")) offsetMs = num * 24 * 60 * 60 * 1000;
    else if (unit.startsWith("m")) offsetMs = num * 60 * 1000;
    else if (unit.startsWith("w")) offsetMs = num * 7 * 24 * 60 * 60 * 1000;

    parsed = new Date(now - offsetMs);
  } else {
    parsed = parseDateTime(dateStr);
  }

  if (!parsed) return null;

  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const hours = parsed.getHours();
  const hour12 = hours % 12 || 12;
  const ampm = hours >= 12 ? "PM" : "AM";

  let displayDate = `${months[parsed.getMonth()]} ${parsed.getDate()}`;
  if (parsed.getFullYear() !== new Date().getFullYear()) {
    displayDate += `, ${parsed.getFullYear()}`;
  }
  displayDate += ` ${hour12}:${parsed.getMinutes().toString().padStart(2, "0")} ${ampm}`;

  const operatorSymbol = operator === ">=" ? "" : operator;
  return {
    display: operatorSymbol + displayDate,
    value: `${operator}${parsed.toISOString()}`,
    operator,
  };
}

function matchTimeFilter(taskTime: number, filterValue: string): boolean {
  let operator = ">=";
  let isoStr = filterValue;

  if (filterValue.startsWith(">=")) { operator = ">="; isoStr = filterValue.slice(2); }
  else if (filterValue.startsWith("<=")) { operator = "<="; isoStr = filterValue.slice(2); }
  else if (filterValue.startsWith(">")) { operator = ">"; isoStr = filterValue.slice(1); }
  else if (filterValue.startsWith("<")) { operator = "<"; isoStr = filterValue.slice(1); }
  else if (filterValue.startsWith("=")) { operator = "="; isoStr = filterValue.slice(1); }

  const isoDate = new Date(isoStr);
  if (!isNaN(isoDate.getTime())) {
    const compareTime = isoDate.getTime();
    switch (operator) {
      case ">": return taskTime > compareTime;
      case ">=": return taskTime >= compareTime;
      case "<": return taskTime < compareTime;
      case "<=": return taskTime <= compareTime;
      case "=": return new Date(taskTime).toDateString() === isoDate.toDateString();
      default: return taskTime >= compareTime;
    }
  }

  const parsed = parseDateTime(isoStr);
  if (parsed) {
    const compareTime = parsed.getTime();
    switch (operator) {
      case ">": return taskTime > compareTime;
      case ">=": return taskTime >= compareTime;
      case "<": return taskTime < compareTime;
      case "<=": return taskTime <= compareTime;
      case "=": return new Date(taskTime).toDateString() === parsed.toDateString();
      default: return taskTime >= compareTime;
    }
  }

  return false;
}

function statusMatchesState(status: string, state: string): boolean {
  const category = STATE_CATEGORIES[state.toLowerCase() as StateCategory];
  return category?.has(status) ?? false;
}

const SEARCH_FIELDS: SearchField[] = [
  {
    id: "name",
    label: "Name",
    prefix: "",
    getValues: (tasks) => [...new Set(tasks.map((t) => t.name))].slice(0, 10),
    match: (task, value) => task.name.toLowerCase().includes(value.toLowerCase()),
  },
  {
    id: "state",
    label: "State",
    prefix: "state:",
    getValues: () => STATE_CATEGORY_NAMES,
    match: (task, value) => statusMatchesState(task.status, value),
  },
  {
    id: "status",
    label: "Status",
    prefix: "status:",
    getValues: (tasks) => [...new Set(tasks.map((t) => t.status))],
    match: (task, value) => task.status.toLowerCase() === value.toLowerCase(),
  },
  {
    id: "node",
    label: "Node",
    prefix: "node:",
    getValues: (tasks) => [...new Set(tasks.map((t) => t.node_name).filter(Boolean) as string[])],
    match: (task, value) => task.node_name?.toLowerCase().includes(value.toLowerCase()) ?? false,
  },
  {
    id: "ip",
    label: "IP",
    prefix: "ip:",
    getValues: (tasks) => [...new Set(tasks.map((t) => t.pod_ip).filter(Boolean) as string[])],
    match: (task, value) => task.pod_ip?.includes(value) ?? false,
  },
  {
    id: "exit",
    label: "Exit Code",
    prefix: "exit:",
    getValues: (tasks) => [...new Set(tasks.map((t) => t.exit_code?.toString()).filter(Boolean) as string[])],
    match: (task, value) => task.exit_code?.toString() === value,
  },
  {
    id: "retry",
    label: "Retry",
    prefix: "retry:",
    getValues: (tasks) => [...new Set(tasks.map((t) => t.retry_id.toString()))],
    match: (task, value) => task.retry_id.toString() === value,
  },
  {
    id: "duration",
    label: "Duration",
    prefix: "duration:",
    getValues: () => [],
    match: (task, value) => {
      const durationMs = (task.duration ?? 0) * 1000;
      return compareWithOperator(durationMs, value, parseDurationString);
    },
  },
  {
    id: "started",
    label: "Started",
    prefix: "started:",
    getValues: () => ["last 10m", "last 1h", "last 24h", "last 7d", "today", "yesterday"],
    match: (task, value) => {
      if (!task.start_time) return false;
      return matchTimeFilter(new Date(task.start_time).getTime(), value);
    },
  },
  {
    id: "ended",
    label: "Ended",
    prefix: "ended:",
    getValues: () => ["last 10m", "last 1h", "last 24h", "last 7d", "today", "yesterday"],
    match: (task, value) => {
      if (!task.end_time) return false;
      return matchTimeFilter(new Date(task.end_time).getTime(), value);
    },
  },
];

const SEARCH_FIELDS_MAP = new Map(SEARCH_FIELDS.map((f) => [f.id, f]));

const FIELD_HINTS: Record<string, string> = {
  state: "state category",
  status: "specific status",
  node: "node name",
  ip: "pod IP address",
  exit: "exit code",
  retry: "retry attempt ID",
  duration: "5m (≥5m), <1h, =30s",
  started: "last 2h, >yesterday, <Dec 25 9am",
  ended: "last 2h, >yesterday, <Dec 25 9am",
};

// Fields that can only have one active filter
const SINGULAR_FIELDS = new Set(["started", "ended", "duration"]);

// ============================================================================
// Component
// ============================================================================

interface SmartSearchProps {
  tasks: TaskWithDuration[];
  chips: SearchChip[];
  onChipsChange: (chips: SearchChip[]) => void;
  placeholder?: string;
}

export const SmartSearch = memo(function SmartSearch({
  tasks,
  chips,
  onChipsChange,
  placeholder = "Search tasks...",
}: SmartSearchProps) {
  const [inputValue, setInputValue] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const deferredInputValue = useDeferredValue(inputValue);
  const deferredTasks = useDeferredValue(tasks);

  const addChip = useCallback((newChip: SearchChip) => {
    startTransition(() => {
      if (SINGULAR_FIELDS.has(newChip.field)) {
        const filtered = chips.filter((c) => c.field !== newChip.field);
        onChipsChange([...filtered, newChip]);
      } else {
        onChipsChange([...chips, newChip]);
      }
    });
  }, [chips, onChipsChange]);

  const parsedInput = useMemo(() => {
    for (const field of SEARCH_FIELDS) {
      if (field.prefix && deferredInputValue.toLowerCase().startsWith(field.prefix)) {
        return { field, query: deferredInputValue.slice(field.prefix.length), hasPrefix: true };
      }
    }
    return { field: null, query: deferredInputValue, hasPrefix: false };
  }, [deferredInputValue]);

  type SuggestionItem = {
    type: "field" | "value" | "state-parent" | "state-child" | "hint";
    field: SearchField;
    value: string;
    count: number;
    display: string;
    indent?: boolean;
  };

  const suggestions = useMemo(() => {
    const items: SuggestionItem[] = [];
    const query = deferredInputValue.toLowerCase().trim();
    const stateField = SEARCH_FIELDS_MAP.get("state")!;
    const statusField = SEARCH_FIELDS_MAP.get("status")!;

    // Pre-compute status counts
    const statusCounts = new Map<string, number>();
    const stateCounts = new Map<StateCategory, number>();

    for (const task of deferredTasks) {
      statusCounts.set(task.status, (statusCounts.get(task.status) ?? 0) + 1);
    }

    for (const [state, statuses] of Object.entries(STATE_CATEGORIES) as [StateCategory, Set<string>][]) {
      let count = 0;
      for (const status of statuses) {
        count += statusCounts.get(status) ?? 0;
      }
      stateCounts.set(state, count);
    }

    if (!query) {
      SEARCH_FIELDS.filter((f) => f.prefix && f.id !== "state").forEach((field) => {
        items.push({
          type: "field",
          field,
          value: field.prefix,
          count: 0,
          display: `${field.prefix} — ${FIELD_HINTS[field.id] ?? field.label.toLowerCase()}`,
        });
      });
    } else if (parsedInput.hasPrefix && parsedInput.field) {
      const field = parsedInput.field;
      const prefixQuery = parsedInput.query.toLowerCase();
      const values = field.getValues(deferredTasks);

      const freeFormFields = ["duration", "started", "ended"];
      if (freeFormFields.includes(field.id) && FIELD_HINTS[field.id]) {
        items.push({
          type: "hint",
          field,
          value: "",
          count: 0,
          display: `Format: ${FIELD_HINTS[field.id]}`,
        });
      }

      values.filter((v) => v.toLowerCase().includes(prefixQuery)).slice(0, 8).forEach((value) => {
        const count = deferredTasks.filter((t) => field.match(t, value)).length;
        items.push({
          type: "value",
          field,
          value,
          count,
          display: `${field.prefix}${value}`,
        });
      });
    } else {
      const matchingStates = STATE_CATEGORY_NAMES.filter((s) => s.includes(query));

      if (matchingStates.length > 0) {
        matchingStates.forEach((state) => {
          const totalCount = stateCounts.get(state) ?? 0;
          if (totalCount === 0) return;

          items.push({
            type: "state-parent",
            field: stateField,
            value: state,
            count: totalCount,
            display: `All ${state}`,
          });

          const statuses = [...STATE_CATEGORIES[state]];
          statuses.forEach((status) => {
            const count = statusCounts.get(status) ?? 0;
            if (count > 0) {
              items.push({
                type: "state-child",
                field: statusField,
                value: status,
                count,
                display: STATUS_LABELS[status] || status,
                indent: true,
              });
            }
          });
        });
      }

      SEARCH_FIELDS.filter((f) => f.prefix && f.prefix.startsWith(query) && f.id !== "state").forEach((field) => {
        items.push({
          type: "field",
          field,
          value: field.prefix,
          count: 0,
          display: `${field.prefix} — ${FIELD_HINTS[field.id] ?? field.label.toLowerCase()}`,
        });
      });

      if (matchingStates.length === 0 || query.length > 3) {
        const nameField = SEARCH_FIELDS_MAP.get("name")!;
        deferredTasks.filter((t) => t.name.toLowerCase().includes(query)).slice(0, 5).forEach((task) => {
          items.push({
            type: "value",
            field: nameField,
            value: task.name,
            count: 1,
            display: task.name,
          });
        });
      }

      const nodeField = SEARCH_FIELDS_MAP.get("node")!;
      const matchingNodes = [...new Set(
        deferredTasks.filter((t) => t.node_name?.toLowerCase().includes(query)).map((t) => t.node_name).filter(Boolean) as string[]
      )].slice(0, 3);

      matchingNodes.forEach((node) => {
        const count = deferredTasks.filter((t) => t.node_name === node).length;
        items.push({
          type: "value",
          field: nodeField,
          value: node,
          count,
          display: `node:${node}`,
        });
      });
    }

    return items;
  }, [deferredInputValue, parsedInput, deferredTasks]);

  useEffect(() => {
    setHighlightedIndex(0);
  }, [suggestions.length]);

  const handleSelect = useCallback((index: number) => {
    const selected = suggestions[index];
    if (!selected || selected.type === "hint") return;

    if (selected.type === "field") {
      setInputValue(selected.value);
      inputRef.current?.focus();
    } else {
      const isTimeField = selected.field.id === "started" || selected.field.id === "ended";
      const normalizedTime = isTimeField ? normalizeTimeFilter(selected.value) : null;

      let chipValue: string;
      let chipLabel: string;

      if (normalizedTime) {
        chipValue = normalizedTime.value;
        chipLabel = `${selected.field.prefix}${normalizedTime.display}`;
      } else if (selected.type === "state-parent") {
        chipValue = selected.value;
        chipLabel = selected.value;
      } else if (selected.type === "state-child") {
        chipValue = selected.value;
        chipLabel = `status:${selected.value}`;
      } else {
        chipValue = selected.value;
        chipLabel = selected.display;
      }

      addChip({ field: selected.field.id, value: chipValue, label: chipLabel });
      setInputValue("");
      setShowDropdown(false);
    }
  }, [suggestions, addChip]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIndex((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" || e.key === "Tab") {
      const selectableSuggestions = suggestions.filter((s) => s.type !== "hint");
      const highlightedItem = suggestions[highlightedIndex];

      if (selectableSuggestions.length > 0 && showDropdown && highlightedItem?.type !== "hint") {
        e.preventDefault();
        handleSelect(highlightedIndex);
      } else if (parsedInput.hasPrefix && parsedInput.field && parsedInput.query.trim()) {
        e.preventDefault();
        const field = parsedInput.field;
        const value = parsedInput.query.trim();

        const isValidDuration = field.id === "duration" && parseDurationString(value.replace(/^[><=]+/, "")) !== null;
        const isTimeField = field.id === "started" || field.id === "ended";
        const normalizedTime = isTimeField ? normalizeTimeFilter(value) : null;
        const isValidTime = isTimeField && normalizedTime !== null;
        const isValidOther = field.id !== "duration" && !isTimeField;

        if (isValidDuration || isValidTime || isValidOther) {
          const chipValue = normalizedTime ? normalizedTime.value : value;
          const chipLabel = normalizedTime ? `${field.prefix}${normalizedTime.display}` : `${field.prefix}${value}`;

          addChip({ field: field.id, value: chipValue, label: chipLabel });
          setInputValue("");
          setShowDropdown(false);
        }
      }
    } else if (e.key === "Backspace" && !inputValue && chips.length > 0) {
      onChipsChange(chips.slice(0, -1));
    } else if (e.key === "Escape") {
      // If dropdown is open, close it and stop propagation (don't close panel)
      if (showDropdown) {
        e.preventDefault();
        e.stopPropagation();
        // Also stop the native event to prevent document-level listeners
        e.nativeEvent.stopImmediatePropagation();
        setInputValue("");
        setShowDropdown(false);
      } else {
        // Dropdown already closed, let event bubble to close panel
        inputRef.current?.blur();
      }
    }
  }, [suggestions, highlightedIndex, showDropdown, handleSelect, inputValue, chips, onChipsChange, parsedInput, addChip]);

  const removeChip = useCallback((index: number) => {
    onChipsChange(chips.filter((_, i) => i !== index));
  }, [chips, onChipsChange]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
        !inputRef.current?.contains(e.target as Node)
      ) {
        setInputValue("");
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="relative">
      <div
        className={cn(
          "flex flex-wrap items-center gap-1.5 rounded-md border px-2 py-1.5 text-sm",
          "border-gray-300 bg-gray-50 dark:border-zinc-700 dark:bg-zinc-800/50",
          "focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500",
        )}
        onClick={() => { inputRef.current?.focus(); setShowDropdown(true); }}
      >
        <Search className="size-4 shrink-0 text-gray-400 dark:text-zinc-400" />

        {chips.map((chip, index) => (
          <span
            key={`${chip.field}-${chip.value}-${index}`}
            className="inline-flex items-center gap-1 rounded bg-blue-900/40 px-2 py-0.5 text-xs font-medium text-blue-300"
          >
            {chip.label}
            <button
              onClick={(e) => { e.stopPropagation(); removeChip(index); }}
              className="hover:text-blue-200"
            >
              <X className="size-3" />
            </button>
          </span>
        ))}

        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => { setInputValue(e.target.value); setShowDropdown(true); }}
          onFocus={() => { ensureChronoLoaded(); }}
          onKeyDown={handleKeyDown}
          placeholder={chips.length === 0 ? placeholder : "Add filter..."}
          className="min-w-[7.5rem] flex-1 bg-transparent text-gray-900 dark:text-zinc-200 outline-none placeholder:text-gray-400 dark:placeholder:text-zinc-500"
        />
      </div>

      {showDropdown && suggestions.length > 0 && (
        <div
          ref={dropdownRef}
          className="dag-dropdown absolute inset-x-0 top-full z-50 mt-1 max-h-80 overflow-auto overscroll-contain rounded-md border border-gray-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-800"
        >
          {inputValue === "" && (
            <div className="border-b border-gray-200 dark:border-zinc-700 p-2">
              <div className="flex flex-wrap gap-1.5">
                {STATE_CATEGORY_NAMES.map((state) => {
                  const statusesInCategory = [...STATE_CATEGORIES[state]];
                  const statusesWithTasks = statusesInCategory.filter((s) => tasks.some((t) => t.status === s));
                  const count = tasks.filter((t) => STATE_CATEGORIES[state].has(t.status)).length;
                  if (count === 0) return null;

                  return (
                    <button
                      key={state}
                      onClick={() => {
                        const statusField = SEARCH_FIELDS.find((f) => f.id === "status")!;
                        const chipsWithoutStatus = chips.filter((c) => c.field !== "status");
                        const newChips = statusesWithTasks.map((status) => ({
                          field: statusField.id,
                          value: status,
                          label: `status:${status}`,
                        }));
                        onChipsChange([...chipsWithoutStatus, ...newChips]);
                        setInputValue("");
                        setShowDropdown(false);
                      }}
                      className={cn(
                        "flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors",
                        "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-600",
                      )}
                    >
                      <span className={cn(
                        "size-2 rounded-full",
                        state === "completed" && "bg-emerald-500",
                        state === "running" && "bg-blue-500",
                        state === "failed" && "bg-red-500",
                        state === "pending" && "bg-gray-400 dark:bg-zinc-400",
                      )} />
                      <span>{state}</span>
                      <span className="text-gray-400 dark:text-zinc-400">{count}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {suggestions.map((item, index) =>
            item.type === "hint" ? (
              <div key={`${item.type}-${index}`} className="px-3 py-2 text-sm italic text-gray-500 dark:text-zinc-400">
                {item.display}
              </div>
            ) : (
              <button
                key={`${item.type}-${item.value}-${index}`}
                onClick={() => handleSelect(index)}
                onMouseEnter={() => setHighlightedIndex(index)}
                className={cn(
                  "flex w-full items-center justify-between px-3 py-2 text-left text-sm",
                  item.indent && "pl-6",
                  item.type === "state-parent" && "font-medium",
                  item.type === "state-child" && "text-gray-500 dark:text-zinc-400",
                  index === highlightedIndex
                    ? "bg-blue-100 text-blue-900 dark:bg-blue-900/30 dark:text-blue-100"
                    : "text-gray-700 hover:bg-gray-100 dark:text-zinc-300 dark:hover:bg-zinc-700",
                )}
              >
                <span className={cn(
                  item.type === "field" && "text-gray-500 dark:text-zinc-400",
                  item.type === "state-parent" && "flex items-center gap-2",
                )}>
                  {item.type === "state-parent" && (
                    <span className={cn(
                      "size-2 rounded-full",
                      item.value === "completed" && "bg-emerald-500",
                      item.value === "running" && "bg-blue-500",
                      item.value === "failed" && "bg-red-500",
                      item.value === "pending" && "bg-gray-400 dark:bg-zinc-400",
                    )} />
                  )}
                  {item.display}
                </span>
                {(item.type === "value" || item.type === "state-parent" || item.type === "state-child") && item.count > 0 && (
                  <span className="text-xs text-gray-400 dark:text-zinc-500">{item.count}</span>
                )}
              </button>
            )
          )}
          {inputValue && (
            <div className="border-t border-gray-200 dark:border-zinc-700 px-3 py-2 text-xs text-gray-500 dark:text-zinc-400">
              Press <kbd className="rounded bg-gray-200 dark:bg-zinc-700 px-1">Enter</kbd> to add filter,{" "}
              <kbd className="rounded bg-gray-200 dark:bg-zinc-700 px-1">Esc</kbd> to close
            </div>
          )}
        </div>
      )}
    </div>
  );
});

// ============================================================================
// Filter Helper
// ============================================================================

/**
 * Filter tasks by search chips.
 * Same-field chips use OR logic, different fields use AND logic.
 */
export function filterTasksByChips(tasks: TaskWithDuration[], chips: SearchChip[]): TaskWithDuration[] {
  if (chips.length === 0) return tasks;

  const chipGroups: Array<{ field: SearchField; values: string[] }> = [];
  const fieldGroupMap = new Map<string, number>();

  for (const chip of chips) {
    const field = SEARCH_FIELDS_MAP.get(chip.field);
    if (!field) continue;

    let groupIdx = fieldGroupMap.get(chip.field);
    if (groupIdx === undefined) {
      groupIdx = chipGroups.length;
      fieldGroupMap.set(chip.field, groupIdx);
      chipGroups.push({ field, values: [] });
    }
    chipGroups[groupIdx].values.push(chip.value);
  }

  const numGroups = chipGroups.length;
  if (numGroups === 0) return tasks;

  if (numGroups === 1) {
    const { field, values } = chipGroups[0];
    if (values.length === 1) {
      return tasks.filter((task) => field.match(task, values[0]));
    }
    return tasks.filter((task) => values.some((v) => field.match(task, v)));
  }

  return tasks.filter((task) => {
    for (const { field, values } of chipGroups) {
      if (!values.some((v) => field.match(task, v))) return false;
    }
    return true;
  });
}

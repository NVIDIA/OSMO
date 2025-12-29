// Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

"use client";

import { useState, useMemo, useCallback, memo, useRef, useEffect, useDeferredValue, startTransition } from "react";
import { faker } from "@faker-js/faker";
import {
  X,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  GripVertical,
  Search,
  Check,
  AlertCircle,
  Clock,
  Loader2,
  Circle,
  ExternalLink,
  Terminal,
  ScrollText,
  PanelLeftClose,
  PanelLeft,
  Columns2,
  Columns,
  MoreVertical,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useVirtualizerCompat } from "@/lib/hooks";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  horizontalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import * as chrono from "chrono-node";

// Simple horizontal-only modifier (no boundary restrictions that might cause issues)
const restrictHorizontal = ({ transform }: { transform: { x: number; y: number; scaleX: number; scaleY: number } }) => ({
  ...transform,
  y: 0,
});

// =============================================================================
// Import backend-aligned types from generated API spec (prevents drift!)
// =============================================================================

import {
  TaskGroupStatus,
  type TaskQueryResponse,
  type GroupQueryResponse,
} from "@/lib/api/generated";

// Import status helpers aligned with backend types
import {
  isFailedStatus,
  calculateDuration,
  formatDuration,
} from "@/app/(dashboard)/dev/workflow-explorer/workflow-types";

// =============================================================================
// Performance: GPU-accelerated CSS styles (defined once, reused)
// Uses composite layer promotion for silky smooth animations
// =============================================================================

const GPU_ACCELERATED_STYLE: React.CSSProperties = {
  willChange: "transform",
  transform: "translate3d(0, 0, 0)",
  backfaceVisibility: "hidden",
};

// Strict containment for maximum layout isolation
const CONTAIN_STYLE: React.CSSProperties = {
  contain: "layout style paint",
};

// For virtual list items - maximum isolation
const VIRTUAL_ITEM_STYLE: React.CSSProperties = {
  contain: "strict",
  contentVisibility: "auto",
};

// Pre-computed constants (prevents object recreation on render)
const ROW_HEIGHT = 40;


// =============================================================================
// Persistence (with debounced writes)
// =============================================================================

const STORAGE_KEY = "group-panel-settings";
const DEBOUNCE_MS = 300;

interface PersistedSettings {
  panelPct: number;
  visibleOptionalIds: ColumnId[];
  sort: SortState;
}

let settingsCache: Partial<PersistedSettings> | null = null;

function loadPersistedSettings(): Partial<PersistedSettings> {
  if (typeof window === "undefined") return {};
  if (settingsCache) return settingsCache;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return {};
    settingsCache = JSON.parse(stored) as Partial<PersistedSettings>;
    return settingsCache;
  } catch {
    return {};
  }
}

let saveTimeout: ReturnType<typeof setTimeout> | null = null;
function savePersistedSettings(settings: Partial<PersistedSettings>): void {
  if (typeof window === "undefined") return;
  if (saveTimeout) clearTimeout(saveTimeout);
  settingsCache = { ...settingsCache, ...settings };
  saveTimeout = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settingsCache));
    } catch {
      // Ignore storage errors
    }
  }, DEBOUNCE_MS);
}

function usePersistedState<T>(
  key: keyof PersistedSettings,
  defaultValue: T,
): [T, (value: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    const persisted = loadPersistedSettings();
    return (persisted[key] as T) ?? defaultValue;
  });

  useEffect(() => {
    savePersistedSettings({ [key]: value } as Partial<PersistedSettings>);
  }, [key, value]);

  return [value, setValue];
}

// =============================================================================
// Extended Task type for UI (adds computed fields to backend TaskQueryResponse)
// =============================================================================

/**
 * Task with computed fields for UI display.
 * Extends the backend TaskQueryResponse with duration computed from timestamps.
 */
interface TaskWithDuration extends TaskQueryResponse {
  /** Computed duration in seconds (from start_time/end_time) */
  duration: number | null;
}

/**
 * Group structure matching backend GroupQueryResponse
 */
interface MockGroup {
  name: string;
  status: TaskGroupStatus;
  start_time?: string;
  end_time?: string;
  tasks: TaskWithDuration[];
}

// =============================================================================
// Column Configuration (static, computed once)
// =============================================================================

type ColumnId = "status" | "name" | "duration" | "node" | "podIp" | "exitCode" | "startTime" | "endTime" | "retry";
type ColumnWidth = number | { min: number; share: number };

interface ColumnDef {
  id: ColumnId;
  label: string;        // Short label for table header
  menuLabel: string;    // Full label for dropdown menu
  width: ColumnWidth;
  align: "left" | "right";
  sortable: boolean;
}

interface OptionalColumnDef extends ColumnDef {
  defaultVisible: boolean;
}

const MANDATORY_COLUMNS: ColumnDef[] = [
  { id: "status", label: "", menuLabel: "Status", width: 24, align: "left", sortable: true },
  { id: "name", label: "Name", menuLabel: "Name", width: { min: 150, share: 3 }, align: "left", sortable: true },
];

const OPTIONAL_COLUMNS: OptionalColumnDef[] = [
  { id: "duration", label: "Duration", menuLabel: "Duration", width: 90, align: "right", sortable: true, defaultVisible: true },
  { id: "node", label: "Node", menuLabel: "Node Name", width: { min: 80, share: 1 }, align: "left", sortable: true, defaultVisible: true },
  { id: "podIp", label: "IP", menuLabel: "IP", width: { min: 95, share: 0.5 }, align: "left", sortable: true, defaultVisible: false },
  { id: "exitCode", label: "Exit", menuLabel: "Exit Code", width: 55, align: "right", sortable: true, defaultVisible: false },
  { id: "startTime", label: "Start", menuLabel: "Start Time", width: 115, align: "right", sortable: true, defaultVisible: false },
  { id: "endTime", label: "End", menuLabel: "End Time", width: 115, align: "right", sortable: true, defaultVisible: false },
  { id: "retry", label: "Retry", menuLabel: "Retry ID", width: 60, align: "right", sortable: true, defaultVisible: false },
];

// Alphabetically sorted column list for stable menu order (by menuLabel)
const OPTIONAL_COLUMNS_ALPHABETICAL = [...OPTIONAL_COLUMNS].sort((a, b) => a.menuLabel.localeCompare(b.menuLabel));

const ALL_COLUMNS: ColumnDef[] = [
  ...MANDATORY_COLUMNS,
  ...OPTIONAL_COLUMNS.map(({ defaultVisible, ...rest }) => rest),
];

const DEFAULT_VISIBLE_OPTIONAL: ColumnId[] = OPTIONAL_COLUMNS.filter((c) => c.defaultVisible).map((c) => c.id);

const COLUMN_MAP = new Map(ALL_COLUMNS.map((c) => [c.id, c]));
const OPTIONAL_COLUMN_MAP = new Map(OPTIONAL_COLUMNS.map((c) => [c.id, c]));

type SortColumn = ColumnId;
type SortDirection = "asc" | "desc";

interface SortState {
  column: SortColumn | null;
  direction: SortDirection;
}

// =============================================================================
// Status Utilities (using backend-aligned helpers + pre-computed lookups)
// =============================================================================

// Pre-computed status category lookup for O(1) access
const STATUS_CATEGORY_MAP: Record<TaskGroupStatus, "waiting" | "running" | "completed" | "failed"> = {
  [TaskGroupStatus.SUBMITTING]: "waiting",
  [TaskGroupStatus.WAITING]: "waiting",
  [TaskGroupStatus.PROCESSING]: "waiting",
  [TaskGroupStatus.SCHEDULING]: "waiting",
  [TaskGroupStatus.INITIALIZING]: "running",
  [TaskGroupStatus.RUNNING]: "running",
  [TaskGroupStatus.COMPLETED]: "completed",
  [TaskGroupStatus.RESCHEDULED]: "completed",
  [TaskGroupStatus.FAILED]: "failed",
  [TaskGroupStatus.FAILED_CANCELED]: "failed",
  [TaskGroupStatus.FAILED_SERVER_ERROR]: "failed",
  [TaskGroupStatus.FAILED_BACKEND_ERROR]: "failed",
  [TaskGroupStatus.FAILED_EXEC_TIMEOUT]: "failed",
  [TaskGroupStatus.FAILED_QUEUE_TIMEOUT]: "failed",
  [TaskGroupStatus.FAILED_IMAGE_PULL]: "failed",
  [TaskGroupStatus.FAILED_UPSTREAM]: "failed",
  [TaskGroupStatus.FAILED_EVICTED]: "failed",
  [TaskGroupStatus.FAILED_START_ERROR]: "failed",
  [TaskGroupStatus.FAILED_START_TIMEOUT]: "failed",
  [TaskGroupStatus.FAILED_PREEMPTED]: "failed",
};

// Pre-computed sort order for status
const STATUS_ORDER: Record<TaskGroupStatus, number> = {
  [TaskGroupStatus.FAILED]: 0,
  [TaskGroupStatus.FAILED_CANCELED]: 1,
  [TaskGroupStatus.FAILED_SERVER_ERROR]: 2,
  [TaskGroupStatus.FAILED_BACKEND_ERROR]: 3,
  [TaskGroupStatus.FAILED_EXEC_TIMEOUT]: 4,
  [TaskGroupStatus.FAILED_QUEUE_TIMEOUT]: 5,
  [TaskGroupStatus.FAILED_IMAGE_PULL]: 6,
  [TaskGroupStatus.FAILED_UPSTREAM]: 7,
  [TaskGroupStatus.FAILED_EVICTED]: 8,
  [TaskGroupStatus.FAILED_START_ERROR]: 9,
  [TaskGroupStatus.FAILED_START_TIMEOUT]: 10,
  [TaskGroupStatus.FAILED_PREEMPTED]: 11,
  [TaskGroupStatus.RUNNING]: 12,
  [TaskGroupStatus.INITIALIZING]: 13,
  [TaskGroupStatus.PROCESSING]: 14,
  [TaskGroupStatus.SCHEDULING]: 15,
  [TaskGroupStatus.SUBMITTING]: 16,
  [TaskGroupStatus.WAITING]: 17,
  [TaskGroupStatus.RESCHEDULED]: 18,
  [TaskGroupStatus.COMPLETED]: 19,
};

function getStatusOrder(status: TaskGroupStatus): number {
  return STATUS_ORDER[status] ?? 99;
}

// =============================================================================
// Stats computation - SINGLE PASS for all stats
// =============================================================================

interface TaskStats {
  total: number;
  completed: number;
  running: number;
  failed: number;
  pending: number;
  subStats: Map<TaskGroupStatus, number>;
  earliestStart: number | null;
  latestEnd: number | null;
  hasRunning: boolean;
}

function computeAllStats(tasks: TaskWithDuration[]): TaskStats {
  const subStats = new Map<TaskGroupStatus, number>();
  let completed = 0;
  let running = 0;
  let failed = 0;
  let earliestStart: number | null = null;
  let latestEnd: number | null = null;
  let hasRunning = false;

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    const status = task.status;

    subStats.set(status, (subStats.get(status) ?? 0) + 1);

    const cat = STATUS_CATEGORY_MAP[status];
    if (cat === "completed") completed++;
    else if (cat === "running") {
      running++;
      hasRunning = true;
    }
    else if (cat === "failed") failed++;

    if (task.start_time) {
      const t = new Date(task.start_time).getTime();
      if (earliestStart === null || t < earliestStart) earliestStart = t;
    }
    if (task.end_time) {
      const t = new Date(task.end_time).getTime();
      if (latestEnd === null || t > latestEnd) latestEnd = t;
    }
  }

  return {
    total: tasks.length,
    completed,
    running,
    failed,
    pending: tasks.length - completed - running - failed,
    subStats,
    earliestStart,
    latestEnd,
    hasRunning,
  };
}

interface GroupStatus {
  status: "completed" | "running" | "failed" | "pending";
  label: string;
}

function computeGroupStatusFromStats(stats: TaskStats): GroupStatus {
  if (stats.completed === stats.total) {
    return { status: "completed", label: "Completed" };
  }
  if (stats.failed > 0) {
    return { status: "failed", label: stats.running > 0 ? "Running with failures" : "Failed" };
  }
  if (stats.running > 0) {
    return { status: "running", label: "Running" };
  }
  return { status: "pending", label: "Pending" };
}

function computeGroupDurationFromStats(stats: TaskStats): number | null {
  if (stats.earliestStart === null) return null;
  const endTime = stats.hasRunning ? Date.now() : stats.latestEnd;
  if (endTime === null) return null;
  return Math.floor((endTime - stats.earliestStart) / 1000);
}

function formatTime(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  const date = new Date(dateStr);

  const timeStr = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const month = months[date.getMonth()];
  const day = date.getDate();

  return `${month} ${day} ${timeStr}`;
}

// =============================================================================
// Smart Search Component
// =============================================================================

// Searchable field definitions
interface SearchField {
  id: string;
  label: string;
  prefix: string;
  getValues: (tasks: TaskWithDuration[]) => string[];
  match: (task: TaskWithDuration, value: string) => boolean;
}

// State categories (high-level groupings of statuses)
type StateCategory = "completed" | "running" | "failed" | "pending";

const STATE_CATEGORIES: Record<StateCategory, Set<TaskGroupStatus>> = {
  completed: new Set([TaskGroupStatus.COMPLETED, TaskGroupStatus.RESCHEDULED]),
  running: new Set([TaskGroupStatus.RUNNING, TaskGroupStatus.INITIALIZING]),
  failed: new Set([
    TaskGroupStatus.FAILED,
    TaskGroupStatus.FAILED_CANCELED,
    TaskGroupStatus.FAILED_SERVER_ERROR,
    TaskGroupStatus.FAILED_BACKEND_ERROR,
    TaskGroupStatus.FAILED_EXEC_TIMEOUT,
    TaskGroupStatus.FAILED_QUEUE_TIMEOUT,
    TaskGroupStatus.FAILED_IMAGE_PULL,
    TaskGroupStatus.FAILED_UPSTREAM,
    TaskGroupStatus.FAILED_EVICTED,
    TaskGroupStatus.FAILED_START_ERROR,
    TaskGroupStatus.FAILED_START_TIMEOUT,
    TaskGroupStatus.FAILED_PREEMPTED,
  ]),
  pending: new Set([TaskGroupStatus.WAITING, TaskGroupStatus.SCHEDULING, TaskGroupStatus.SUBMITTING, TaskGroupStatus.PROCESSING]),
};

const STATE_CATEGORY_NAMES: StateCategory[] = ["completed", "running", "failed", "pending"];

// Check if a status belongs to a state category
function statusMatchesState(status: TaskGroupStatus, state: string): boolean {
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
    getValues: () => [], // Free-form entry, no presets
    match: (task, value) => {
      // task.duration is in seconds, convert to ms for comparison
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
      const taskTime = new Date(task.start_time).getTime();
      return matchTimeFilter(taskTime, value);
    },
  },
  {
    id: "ended",
    label: "Ended",
    prefix: "ended:",
    getValues: () => ["last 10m", "last 1h", "last 24h", "last 7d", "today", "yesterday"],
    match: (task, value) => {
      if (!task.end_time) return false;
      const taskTime = new Date(task.end_time).getTime();
      return matchTimeFilter(taskTime, value);
    },
  },
];

// Pre-computed lookup map for O(1) field access (performance optimization)
const SEARCH_FIELDS_MAP = new Map(SEARCH_FIELDS.map(f => [f.id, f]));

// Parse duration string like "1m", "30s", "2h", "1h30m" into milliseconds
function parseDurationString(str: string): number | null {
  const normalized = str.toLowerCase().trim();
  if (!normalized) return null;

  let totalMs = 0;
  let remaining = normalized;

  // Match patterns like 1h, 30m, 45s, 100ms
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

  // If we consumed everything with unit matches, return the total
  if (hasMatch && remaining.length === 0) {
    return totalMs;
  }

  // If no unit match, try parsing as plain number (assume seconds)
  // Must be a pure number with nothing left over
  if (!hasMatch && /^\d+(?:\.\d+)?$/.test(normalized)) {
    return parseFloat(normalized) * 1000;
  }

  return null;
}

// Parse time string - supports "Xh ago", "Xm ago", or ISO date strings
function parseTimeString(str: string): number | null {
  const normalized = str.toLowerCase().trim();

  // Handle "X ago" format
  const agoMatch = normalized.match(/^(\d+(?:\.\d+)?)\s*(h|m|d)\s*ago$/);
  if (agoMatch) {
    const num = parseFloat(agoMatch[1]);
    const unit = agoMatch[2];
    const now = Date.now();
    switch (unit) {
      case "h": return now - num * 60 * 60 * 1000;
      case "m": return now - num * 60 * 1000;
      case "d": return now - num * 24 * 60 * 60 * 1000;
    }
  }

  // Try parsing as date
  const parsed = Date.parse(str);
  if (!isNaN(parsed)) return parsed;

  return null;
}

// Compare a value using operator prefix (>, >=, <, <=, =)
// Default is >= (at least) which is most useful for filtering
function compareWithOperator(
  taskValue: number,
  filterValue: string,
  parser: (s: string) => number | null,
): boolean {
  const normalized = filterValue.trim();

  let operator = ">=";  // Default: at least
  let valueStr = normalized;

  if (normalized.startsWith(">=")) {
    operator = ">=";
    valueStr = normalized.slice(2);
  } else if (normalized.startsWith("<=")) {
    operator = "<=";
    valueStr = normalized.slice(2);
  } else if (normalized.startsWith(">")) {
    operator = ">";
    valueStr = normalized.slice(1);
  } else if (normalized.startsWith("<")) {
    operator = "<";
    valueStr = normalized.slice(1);
  } else if (normalized.startsWith("=")) {
    operator = "=";
    valueStr = normalized.slice(1);
  }

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

// =============================================================================
// Date parsing using chrono-node (handles all natural language + formats)
// Includes LRU cache for performance (chrono parsing is expensive)
// =============================================================================

// Simple LRU cache for chrono parsing results
const chronoCache = new Map<string, Date | null>();
const CHRONO_CACHE_MAX = 100;

function parseDateTime(input: string): Date | null {
  if (!input?.trim()) return null;

  const key = input.trim().toLowerCase();

  // Check cache first
  if (chronoCache.has(key)) {
    return chronoCache.get(key)!;
  }

  // Parse with chrono
  const result = chrono.parseDate(input);

  // LRU eviction if cache is full
  if (chronoCache.size >= CHRONO_CACHE_MAX) {
    const firstKey = chronoCache.keys().next().value;
    if (firstKey) chronoCache.delete(firstKey);
  }

  chronoCache.set(key, result);
  return result;
}

// Extract operator from time filter input
function extractTimeOperator(input: string): { operator: string; dateStr: string } {
  const trimmed = input.trim();

  if (trimmed.startsWith(">=")) return { operator: ">=", dateStr: trimmed.slice(2).trim() };
  if (trimmed.startsWith("<=")) return { operator: "<=", dateStr: trimmed.slice(2).trim() };
  if (trimmed.startsWith(">")) return { operator: ">", dateStr: trimmed.slice(1).trim() };
  if (trimmed.startsWith("<")) return { operator: "<", dateStr: trimmed.slice(1).trim() };
  if (trimmed.startsWith("=")) return { operator: "=", dateStr: trimmed.slice(1).trim() };

  return { operator: ">=", dateStr: trimmed }; // Default: on or after
}

// Convert any time input to an absolute timestamp for consistent storage/sharing
// Returns { display: string, value: string, operator: string }
function normalizeTimeFilter(input: string): { display: string; value: string; operator: string } | null {
  const { operator, dateStr } = extractTimeOperator(input);

  // Handle "last X" patterns manually since chrono interprets them differently
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

  // Format display: always include date and time for precision
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const month = months[parsed.getMonth()];
  const day = parsed.getDate();
  const year = parsed.getFullYear();
  const currentYear = new Date().getFullYear();
  const hours = parsed.getHours();
  const minutes = parsed.getMinutes();
  const ampm = hours >= 12 ? "PM" : "AM";
  const hour12 = hours % 12 || 12;

  let displayDate = `${month} ${day}`;
  if (year !== currentYear) {
    displayDate += `, ${year}`;
  }
  displayDate += ` ${hour12}:${minutes.toString().padStart(2, "0")} ${ampm}`;

  // Add operator symbol to display (except for default >=)
  const operatorSymbol = operator === ">=" ? "" : `${operator}`;
  const display = operatorSymbol + displayDate;

  // Value includes operator prefix + ISO string for matching
  const value = `${operator}${parsed.toISOString()}`;

  return { display, value, operator };
}

// Check if a task time matches a filter value (with operator support)
// Filter value format: ">=2024-12-25T00:00:00.000Z" or just ISO timestamp
function matchTimeFilter(taskTime: number, filterValue: string): boolean {
  // Extract operator if present
  let operator = ">=";
  let isoStr = filterValue;

  if (filterValue.startsWith(">=")) {
    operator = ">=";
    isoStr = filterValue.slice(2);
  } else if (filterValue.startsWith("<=")) {
    operator = "<=";
    isoStr = filterValue.slice(2);
  } else if (filterValue.startsWith(">")) {
    operator = ">";
    isoStr = filterValue.slice(1);
  } else if (filterValue.startsWith("<")) {
    operator = "<";
    isoStr = filterValue.slice(1);
  } else if (filterValue.startsWith("=")) {
    operator = "=";
    isoStr = filterValue.slice(1);
  }

  // Try parsing as ISO timestamp
  const isoDate = new Date(isoStr);
  if (!isNaN(isoDate.getTime())) {
    const compareTime = isoDate.getTime();
    switch (operator) {
      case ">": return taskTime > compareTime;
      case ">=": return taskTime >= compareTime;
      case "<": return taskTime < compareTime;
      case "<=": return taskTime <= compareTime;
      case "=":
        // For "equals", check if same day
        const taskDate = new Date(taskTime);
        return taskDate.toDateString() === isoDate.toDateString();
      default: return taskTime >= compareTime;
    }
  }

  // Fallback: parse as natural language (for backwards compatibility)
  const parsed = parseDateTime(isoStr);
  if (parsed) {
    const compareTime = parsed.getTime();
    switch (operator) {
      case ">": return taskTime > compareTime;
      case ">=": return taskTime >= compareTime;
      case "<": return taskTime < compareTime;
      case "<=": return taskTime <= compareTime;
      case "=":
        const taskDate = new Date(taskTime);
        return taskDate.toDateString() === parsed.toDateString();
      default: return taskTime >= compareTime;
    }
  }

  return false;
}

// Field hints for dropdown display
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

interface SearchChip {
  field: string;
  value: string;
  label: string;
}

interface SmartSearchProps {
  tasks: TaskWithDuration[];
  chips: SearchChip[];
  onChipsChange: (chips: SearchChip[]) => void;
  placeholder?: string;
}

// Fields that can only have one active filter (time is linear/single-dimension)
const SINGULAR_FIELDS = new Set(["started", "ended", "duration"]);

const SmartSearch = memo(function SmartSearch({
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

  // Defer expensive suggestion computation to not block typing
  const deferredInputValue = useDeferredValue(inputValue);
  const deferredTasks = useDeferredValue(tasks);

  // Helper to add a chip - for singular fields, replaces existing
  // Uses startTransition for non-urgent UI updates
  const addChip = useCallback((newChip: SearchChip) => {
    startTransition(() => {
      if (SINGULAR_FIELDS.has(newChip.field)) {
        // Remove any existing chip for this field first
        const filtered = chips.filter(c => c.field !== newChip.field);
        onChipsChange([...filtered, newChip]);
      } else {
        onChipsChange([...chips, newChip]);
      }
    });
  }, [chips, onChipsChange]);

  // Parse input to detect field prefix (uses deferred value for suggestions)
  const parsedInput = useMemo(() => {
    for (const field of SEARCH_FIELDS) {
      if (field.prefix && deferredInputValue.toLowerCase().startsWith(field.prefix)) {
        return {
          field,
          query: deferredInputValue.slice(field.prefix.length),
          hasPrefix: true,
        };
      }
    }
    return { field: null, query: deferredInputValue, hasPrefix: false };
  }, [deferredInputValue]);


  // Generate suggestions based on input
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

    // Pre-compute status counts (single pass over tasks)
    const statusCounts = new Map<TaskGroupStatus, number>();
    const stateCounts = new Map<StateCategory, number>();

    for (const task of deferredTasks) {
      statusCounts.set(task.status, (statusCounts.get(task.status) ?? 0) + 1);
    }

    // Compute state counts from status counts
    for (const [state, statuses] of Object.entries(STATE_CATEGORIES) as [StateCategory, Set<TaskGroupStatus>][]) {
      let count = 0;
      for (const status of statuses) {
        count += statusCounts.get(status) ?? 0;
      }
      stateCounts.set(state, count);
    }

    // Helper: count tasks matching a state category (O(1) lookup)
    const countByState = (state: StateCategory) => stateCounts.get(state) ?? 0;

    // Helper: count tasks matching a specific status (O(1) lookup)
    const countByStatus = (status: TaskGroupStatus) => statusCounts.get(status) ?? 0;

    if (!query) {
      // States are now in the quick filters row, so just show field hints here
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
      // Explicit prefix: show values for the specific field
      const field = parsedInput.field;
      const prefixQuery = parsedInput.query.toLowerCase();
      const values = field.getValues(deferredTasks);

      // Show format hint for free-form fields (duration, started, ended)
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

      values
        .filter((v) => v.toLowerCase().includes(prefixQuery))
        .slice(0, 8)
        .forEach((value) => {
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
      // Smart recognition: check if query matches a state category
      const matchingStates = STATE_CATEGORY_NAMES.filter((s) => s.includes(query));

      if (matchingStates.length > 0) {
        // Show hierarchical state options
        matchingStates.forEach((state) => {
          const totalCount = countByState(state);
          if (totalCount === 0) return;

          // Parent: "All {state} tasks"
          items.push({
            type: "state-parent",
            field: stateField,
            value: state,
            count: totalCount,
            display: `All ${state}`,
          });

          // Children: specific statuses within this category
          const statuses = [...STATE_CATEGORIES[state]];
          statuses.forEach((status) => {
            const count = countByStatus(status);
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

      // Also show other field matches
      // Field prefix suggestions
      SEARCH_FIELDS.filter((f) => f.prefix && f.prefix.startsWith(query) && f.id !== "state").forEach((field) => {
        items.push({
          type: "field",
          field,
          value: field.prefix,
          count: 0,
          display: `${field.prefix} — ${FIELD_HINTS[field.id] ?? field.label.toLowerCase()}`,
        });
      });

      // Name matches (if query doesn't look like a state)
      if (matchingStates.length === 0 || query.length > 3) {
        const nameField = SEARCH_FIELDS_MAP.get("name")!;
        deferredTasks
          .filter((t) => t.name.toLowerCase().includes(query))
          .slice(0, 5)
          .forEach((task) => {
            items.push({
              type: "value",
              field: nameField,
              value: task.name,
              count: 1,
              display: task.name,
            });
          });
      }

      // Node matches
      const nodeField = SEARCH_FIELDS_MAP.get("node")!;
      const matchingNodes = [...new Set(
        deferredTasks
          .filter((t) => t.node_name?.toLowerCase().includes(query))
          .map((t) => t.node_name)
          .filter(Boolean) as string[]
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

  // Reset highlight when suggestions change
  useEffect(() => {
    setHighlightedIndex(0);
  }, [suggestions.length]);

  // Handle selection
  const handleSelect = useCallback((index: number) => {
    const selected = suggestions[index];
    if (!selected || selected.type === "hint") return;

    if (selected.type === "field") {
      setInputValue(selected.value);
      inputRef.current?.focus();
    } else {
      // Check if this is a time field that needs normalization
      const isTimeField = selected.field.id === "started" || selected.field.id === "ended";
      const normalizedTime = isTimeField ? normalizeTimeFilter(selected.value) : null;

      // Determine the chip value and label
      let chipValue: string;
      let chipLabel: string;

      if (normalizedTime) {
        chipValue = normalizedTime.value;  // ISO timestamp
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

      const newChip: SearchChip = {
        field: selected.field.id,
        value: chipValue,
        label: chipLabel,
      };
      addChip(newChip);
      setInputValue("");
      setShowDropdown(false);
    }
  }, [suggestions, addChip]);

  // Handle keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIndex((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" || e.key === "Tab") {
      // Check if there are any selectable (non-hint) suggestions
      const selectableSuggestions = suggestions.filter(s => s.type !== "hint");
      const highlightedItem = suggestions[highlightedIndex];

      if (selectableSuggestions.length > 0 && showDropdown && highlightedItem?.type !== "hint") {
        e.preventDefault();
        handleSelect(highlightedIndex);
      } else if (parsedInput.hasPrefix && parsedInput.field && parsedInput.query.trim()) {
        // Try to create a chip from free-form input
        e.preventDefault();
        const field = parsedInput.field;
        const value = parsedInput.query.trim();

        // Validate the filter by checking if it would match anything or is valid format
        const isValidDuration = field.id === "duration" && parseDurationString(value.replace(/^[><=]+/, "")) !== null;

        // For time fields, use chrono-node to validate and normalize to absolute timestamp
        const isTimeField = field.id === "started" || field.id === "ended";
        const normalizedTime = isTimeField ? normalizeTimeFilter(value) : null;
        const isValidTime = isTimeField && normalizedTime !== null;

        const isValidOther = field.id !== "duration" && !isTimeField;

        if (isValidDuration || isValidTime || isValidOther) {
          // For time fields, use normalized absolute timestamp
          const chipValue = normalizedTime ? normalizedTime.value : value;
          const chipLabel = normalizedTime
            ? `${field.prefix}${normalizedTime.display}`
            : `${field.prefix}${value}`;

          const newChip: SearchChip = {
            field: field.id,
            value: chipValue,  // ISO timestamp for URL sharing
            label: chipLabel,   // Human-readable display
          };
          addChip(newChip);
          setInputValue("");
          setShowDropdown(false);
        }
      }
    } else if (e.key === "Backspace" && !inputValue && chips.length > 0) {
      // Remove last chip
      onChipsChange(chips.slice(0, -1));
    } else if (e.key === "Escape") {
      setInputValue(""); // Clear unfinished filter
      setShowDropdown(false);
      inputRef.current?.blur();
    }
  }, [suggestions, highlightedIndex, showDropdown, handleSelect, inputValue, chips, onChipsChange]);

  // Remove chip
  const removeChip = useCallback((index: number) => {
    onChipsChange(chips.filter((_, i) => i !== index));
  }, [chips, onChipsChange]);

  // Click outside to close and clear unfinished filter
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        !inputRef.current?.contains(e.target as Node)
      ) {
        setInputValue(""); // Clear unfinished filter
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="relative">
      {/* Chips + Input container */}
      <div
        className={cn(
          "flex flex-wrap items-center gap-1.5 rounded-md border bg-white px-2 py-1.5 text-sm",
          "border-zinc-200 dark:border-zinc-700 dark:bg-zinc-900",
          "focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500",
        )}
        onClick={() => inputRef.current?.focus()}
      >
        <Search className="h-4 w-4 shrink-0 text-zinc-400" />

        {/* Chips */}
        {chips.map((chip, index) => (
          <span
            key={`${chip.field}-${chip.value}-${index}`}
            className="inline-flex items-center gap-1 rounded bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-900/30 dark:text-blue-300"
          >
            {chip.label}
            <button
              onClick={(e) => {
                e.stopPropagation();
                removeChip(index);
              }}
              className="hover:text-blue-600 dark:hover:text-blue-200"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}

        {/* Input */}
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => {
            setInputValue(e.target.value);
            setShowDropdown(true);
          }}
          onFocus={() => setShowDropdown(true)}
          onKeyDown={handleKeyDown}
          placeholder={chips.length === 0 ? placeholder : "Add filter..."}
          className="min-w-[120px] flex-1 bg-transparent outline-none placeholder:text-zinc-400"
        />
      </div>

      {/* Dropdown - GPU accelerated with containment */}
      {showDropdown && suggestions.length > 0 && (
        <div
          ref={dropdownRef}
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-80 overflow-auto overscroll-contain rounded-md border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
          style={{ ...GPU_ACCELERATED_STYLE, contain: "layout style" }}
        >
          {/* Quick state filters - preset shortcuts that add status chips */}
          {inputValue === "" && (
            <div className="border-b border-zinc-100 p-2 dark:border-zinc-800">
              <div className="flex flex-wrap gap-1.5">
                {STATE_CATEGORY_NAMES.map((state) => {
                  const statusesInCategory = [...STATE_CATEGORIES[state]];
                  const statusesWithTasks = statusesInCategory.filter((s) =>
                    tasks.some((t) => t.status === s)
                  );
                  const count = tasks.filter((t) => STATE_CATEGORIES[state].has(t.status)).length;
                  if (count === 0) return null;

                  return (
                    <button
                      key={state}
                      onClick={() => {
                        // Clear existing status chips and add new ones for this category
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
                        "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700",
                      )}
                    >
                      <span className={cn(
                        "h-2 w-2 rounded-full",
                        state === "completed" && "bg-emerald-500",
                        state === "running" && "bg-blue-500",
                        state === "failed" && "bg-red-500",
                        state === "pending" && "bg-zinc-400",
                      )} />
                      <span>{state}</span>
                      <span className="text-zinc-400">{count}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Suggestions */}
          {suggestions.map((item, index) =>
            item.type === "hint" ? (
              <div
                key={`${item.type}-${index}`}
                className="px-3 py-2 text-sm text-zinc-500 italic dark:text-zinc-400"
              >
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
                  item.type === "state-child" && "text-zinc-600 dark:text-zinc-400",
                  index === highlightedIndex
                    ? "bg-blue-50 text-blue-900 dark:bg-blue-900/20 dark:text-blue-100"
                    : "text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800",
                )}
              >
                <span className={cn(
                  item.type === "field" && "text-zinc-500 dark:text-zinc-400",
                  item.type === "state-parent" && "flex items-center gap-2",
                )}>
                  {item.type === "state-parent" && (
                    <span className={cn(
                      "h-2 w-2 rounded-full",
                      item.value === "completed" && "bg-emerald-500",
                      item.value === "running" && "bg-blue-500",
                      item.value === "failed" && "bg-red-500",
                      item.value === "pending" && "bg-zinc-400",
                    )} />
                  )}
                  {item.display}
                </span>
                {(item.type === "value" || item.type === "state-parent" || item.type === "state-child") && item.count > 0 && (
                  <span className="text-xs text-zinc-400">{item.count}</span>
                )}
              </button>
            )
          )}
          {inputValue && (
            <div className="border-t border-zinc-100 px-3 py-2 text-xs text-zinc-400 dark:border-zinc-800">
              Press <kbd className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">Enter</kbd> to add filter,{" "}
              <kbd className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">Esc</kbd> to close
            </div>
          )}
        </div>
      )}
    </div>
  );
});

// Helper to filter tasks by chips (hyper-optimized)
// Same-field chips use OR logic (union), different fields use AND logic
// Uses loop unrolling and early exits for maximum performance
function filterTasksByChips(tasks: TaskWithDuration[], chips: SearchChip[]): TaskWithDuration[] {
  if (chips.length === 0) return tasks;

  // Group chips by field - single pass, pre-resolve field references
  const chipGroups: Array<{ field: SearchField; values: string[] }> = [];
  const fieldGroupMap = new Map<string, number>();

  for (let i = 0; i < chips.length; i++) {
    const chip = chips[i];
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

  // Early exit if no valid chips
  const numGroups = chipGroups.length;
  if (numGroups === 0) return tasks;

  // Special case: single field group (most common) - optimized path
  if (numGroups === 1) {
    const { field, values } = chipGroups[0];
    const numValues = values.length;

    // Single value - direct comparison
    if (numValues === 1) {
      const value = values[0];
      return tasks.filter((task) => field.match(task, value));
    }

    // Multiple values - OR logic
    return tasks.filter((task) => {
      for (let i = 0; i < numValues; i++) {
        if (field.match(task, values[i])) return true;
      }
      return false;
    });
  }

  // General case: multiple field groups - AND of ORs
  return tasks.filter((task) => {
    for (let g = 0; g < numGroups; g++) {
      const { field, values } = chipGroups[g];
      let anyMatch = false;
      for (let v = 0; v < values.length; v++) {
        if (field.match(task, values[v])) {
          anyMatch = true;
          break;
        }
      }
      if (!anyMatch) return false;
    }
    return true;
  });
}

// =============================================================================
// Grid template utilities (memoized with cache)
// =============================================================================

const gridTemplateCache = new Map<string, string>();
const minWidthCache = new Map<string, number>();

function getGridTemplate(columns: ColumnDef[]): string {
  const key = columns.map((c) => c.id).join(",");
  let cached = gridTemplateCache.get(key);
  if (cached) return cached;

  cached = columns
    .map((col) => {
      if (typeof col.width === "number") return `${col.width}px`;
      return `minmax(${col.width.min}px, ${col.width.share}fr)`;
    })
    .join(" ");

  gridTemplateCache.set(key, cached);
  return cached;
}

function getMinTableWidth(columns: ColumnDef[]): number {
  const key = columns.map((c) => c.id).join(",");
  let cached = minWidthCache.get(key);
  if (cached) return cached;

  const fixedWidth = columns.reduce((sum, col) => {
    if (typeof col.width === "number") return sum + col.width;
    return sum + col.width.min;
  }, 0);
  cached = fixedWidth + (columns.length - 1) * 24 + 24;

  minWidthCache.set(key, cached);
  return cached;
}

// =============================================================================
// Mock Data Generation (using backend-aligned types)
// =============================================================================

const MOCK_NODES = [
  "dgx-a100-001", "dgx-a100-002", "dgx-a100-003",
  "dgx-h100-001", "dgx-h100-002",
  "gpu-l40s-101", "gpu-l40s-102", "gpu-l40s-103",
];

const MOCK_FAILURE_MESSAGES: Record<string, string[]> = {
  [TaskGroupStatus.FAILED]: ["Process exited with code 1", "Unknown error occurred"],
  [TaskGroupStatus.FAILED_EXEC_TIMEOUT]: ["Execution timed out after 3600s"],
  [TaskGroupStatus.FAILED_QUEUE_TIMEOUT]: ["Queue timeout - no resources available"],
  [TaskGroupStatus.FAILED_PREEMPTED]: ["Preempted by higher priority workflow"],
  [TaskGroupStatus.FAILED_EVICTED]: ["Evicted due to node pressure"],
  [TaskGroupStatus.FAILED_IMAGE_PULL]: ["Failed to pull image: ImagePullBackOff"],
  [TaskGroupStatus.FAILED_CANCELED]: ["Canceled by user"],
  [TaskGroupStatus.FAILED_SERVER_ERROR]: ["Internal server error"],
  [TaskGroupStatus.FAILED_BACKEND_ERROR]: ["Backend returned error: NCCL timeout"],
  [TaskGroupStatus.FAILED_START_ERROR]: ["Container failed to start"],
  [TaskGroupStatus.FAILED_START_TIMEOUT]: ["Container start timed out"],
  [TaskGroupStatus.FAILED_UPSTREAM]: ["Upstream task failed"],
};

function generateMockGroup(taskCount: number, scenarioName: string): MockGroup {
  faker.seed(42);

  const tasks: TaskWithDuration[] = [];
  const baseTime = new Date();
  baseTime.setHours(baseTime.getHours() - 2);

  // Status distribution: 70% completed, 15% running, 7% failed, 8% pending
  const failedStatuses: TaskGroupStatus[] = [
    TaskGroupStatus.FAILED,
    TaskGroupStatus.FAILED_EXEC_TIMEOUT,
    TaskGroupStatus.FAILED_PREEMPTED,
    TaskGroupStatus.FAILED_EVICTED,
  ];

  const pendingStatuses: TaskGroupStatus[] = [
    TaskGroupStatus.WAITING,
    TaskGroupStatus.SCHEDULING,
    TaskGroupStatus.INITIALIZING,
  ];

  for (let i = 0; i < taskCount; i++) {
    let status: TaskGroupStatus;
    if (i < taskCount * 0.7) {
      status = TaskGroupStatus.COMPLETED;
    } else if (i < taskCount * 0.85) {
      status = TaskGroupStatus.RUNNING;
    } else if (i < taskCount * 0.92) {
      status = faker.helpers.arrayElement(failedStatuses);
    } else {
      status = faker.helpers.arrayElement(pendingStatuses);
    }

    const isStarted = status !== TaskGroupStatus.WAITING && status !== TaskGroupStatus.SCHEDULING;
    const isEnded = status === TaskGroupStatus.COMPLETED || isFailedStatus(status);

    const startTime = isStarted
      ? new Date(baseTime.getTime() + i * 60000 + faker.number.int({ min: 0, max: 30000 })).toISOString()
      : undefined;

    const endTime = isEnded ? new Date().toISOString() : undefined;

    // Create task matching TaskQueryResponse structure
    const task: TaskWithDuration = {
      // Required fields from TaskQueryResponse
      name: `${scenarioName}-shard-${i.toString().padStart(3, "0")}`,
      retry_id: faker.helpers.weightedArrayElement([
        { value: 0, weight: 90 },
        { value: 1, weight: 8 },
        { value: 2, weight: 2 },
      ]),
      status,
      logs: `/api/tasks/${scenarioName}-shard-${i}/logs`,
      events: `/api/tasks/${scenarioName}-shard-${i}/events`,
      pod_name: isStarted ? `${scenarioName}-${i}-${faker.string.alphanumeric(5)}` : "",
      task_uuid: faker.string.uuid(),

      // Optional fields from TaskQueryResponse
      pod_ip: isStarted ? `10.0.${faker.number.int({ min: 1, max: 10 })}.${faker.number.int({ min: 1, max: 254 })}` : undefined,
      node_name: isStarted ? faker.helpers.arrayElement(MOCK_NODES) : undefined,
      start_time: startTime,
      end_time: endTime,
      exit_code: status === TaskGroupStatus.COMPLETED ? 0 : isFailedStatus(status) ? 1 : undefined,
      failure_message: isFailedStatus(status)
        ? faker.helpers.arrayElement(MOCK_FAILURE_MESSAGES[status] || MOCK_FAILURE_MESSAGES[TaskGroupStatus.FAILED])
        : undefined,
      dashboard_url: isStarted ? `/dashboard/${scenarioName}-shard-${i}` : undefined,
      lead: i === 0, // First task is lead

      // Computed field for UI
      duration: calculateDuration(startTime, endTime),
    };

    tasks.push(task);
  }

  return {
    name: scenarioName,
    status: TaskGroupStatus.RUNNING, // Overall group status
    start_time: baseTime.toISOString(),
    tasks: faker.helpers.shuffle(tasks),
  };
}

// =============================================================================
// Status Icon Component (memoized)
// =============================================================================

const StatusIcon = memo(function StatusIcon({ status, className }: { status: TaskGroupStatus; className?: string }) {
  const category = STATUS_CATEGORY_MAP[status];
  switch (category) {
    case "completed":
      return <Check className={cn("h-3.5 w-3.5 text-emerald-500", className)} />;
    case "running":
      return <Loader2 className={cn("h-3.5 w-3.5 text-blue-500 animate-spin", className)} />;
    case "failed":
      return <AlertCircle className={cn("h-3.5 w-3.5 text-red-500", className)} />;
    case "waiting":
      return <Clock className={cn("h-3.5 w-3.5 text-zinc-400", className)} />;
    default:
      return <Circle className={cn("h-3.5 w-3.5 text-zinc-400", className)} />;
  }
});

// Human-readable labels for statuses
const STATUS_LABELS: Record<TaskGroupStatus, string> = {
  [TaskGroupStatus.COMPLETED]: "Completed",
  [TaskGroupStatus.RESCHEDULED]: "Rescheduled",
  [TaskGroupStatus.RUNNING]: "Running",
  [TaskGroupStatus.INITIALIZING]: "Initializing",
  [TaskGroupStatus.FAILED]: "Failed",
  [TaskGroupStatus.FAILED_CANCELED]: "Canceled",
  [TaskGroupStatus.FAILED_SERVER_ERROR]: "Server Error",
  [TaskGroupStatus.FAILED_BACKEND_ERROR]: "Backend Error",
  [TaskGroupStatus.FAILED_EXEC_TIMEOUT]: "Exec Timeout",
  [TaskGroupStatus.FAILED_QUEUE_TIMEOUT]: "Queue Timeout",
  [TaskGroupStatus.FAILED_IMAGE_PULL]: "Image Pull",
  [TaskGroupStatus.FAILED_UPSTREAM]: "Upstream",
  [TaskGroupStatus.FAILED_EVICTED]: "Evicted",
  [TaskGroupStatus.FAILED_START_ERROR]: "Start Error",
  [TaskGroupStatus.FAILED_START_TIMEOUT]: "Start Timeout",
  [TaskGroupStatus.FAILED_PREEMPTED]: "Preempted",
  [TaskGroupStatus.WAITING]: "Waiting",
  [TaskGroupStatus.SCHEDULING]: "Scheduling",
  [TaskGroupStatus.SUBMITTING]: "Submitting",
  [TaskGroupStatus.PROCESSING]: "Processing",
};

// =============================================================================
// Task Row (heavily optimized)
// =============================================================================

// Pre-computed row style object to avoid recreation
const ROW_BASE_STYLE: React.CSSProperties = {
  ...GPU_ACCELERATED_STYLE,
  contain: "layout style paint",
};

const TaskRow = memo(function TaskRow({
  task,
  gridTemplate,
  minWidth,
  isSelected,
  onSelect,
  visibleColumnIds,
}: {
  task: TaskWithDuration;
  gridTemplate: string;
  minWidth: number;
  isSelected: boolean;
  onSelect: () => void;
  visibleColumnIds: ColumnId[];
}) {
  // Merge styles once per render
  const rowStyle = useMemo(() => ({
    ...ROW_BASE_STYLE,
    gridTemplateColumns: gridTemplate,
    minWidth,
  }), [gridTemplate, minWidth]);

  return (
    <div
      onClick={onSelect}
      className={cn(
        "grid cursor-pointer items-center gap-6 border-b border-zinc-100 px-3 py-2 text-sm transition-colors duration-75 dark:border-zinc-800",
        isSelected ? "bg-blue-50 dark:bg-blue-900/20" : "hover:bg-zinc-50 dark:hover:bg-zinc-900",
      )}
      style={rowStyle}
    >
      {visibleColumnIds.map((colId) => {
        const col = COLUMN_MAP.get(colId)!;
        return (
          <div key={colId} className={cn("flex items-center overflow-hidden", col.align === "right" && "justify-end")}>
            <TaskCell task={task} columnId={colId} />
          </div>
        );
      })}
    </div>
  );
}, (prev, next) => {
  // Fast shallow comparison
  return prev.task === next.task &&
    prev.gridTemplate === next.gridTemplate &&
    prev.minWidth === next.minWidth &&
    prev.isSelected === next.isSelected &&
    prev.visibleColumnIds === next.visibleColumnIds;
});

const TaskCell = memo(function TaskCell({ task, columnId }: { task: TaskWithDuration; columnId: ColumnId }) {
  switch (columnId) {
    case "status":
      return <StatusIcon status={task.status} />;
    case "name":
      return <span className="truncate font-medium text-zinc-900 dark:text-zinc-100">{task.name}</span>;
    case "duration":
      return <span className="tabular-nums text-zinc-500 dark:text-zinc-400">{formatDuration(task.duration)}</span>;
    case "node":
      return <span className="truncate text-zinc-500 dark:text-zinc-400">{task.node_name ?? "—"}</span>;
    case "podIp":
      return <span className="whitespace-nowrap font-mono text-xs text-zinc-500 dark:text-zinc-400">{task.pod_ip ?? "—"}</span>;
    case "exitCode":
      return (
        <span className={cn("tabular-nums", task.exit_code === 0 ? "text-zinc-400" : task.exit_code !== undefined ? "text-red-500" : "text-zinc-400")}>
          {task.exit_code ?? "—"}
        </span>
      );
    case "startTime":
      return <span className="tabular-nums text-zinc-500 dark:text-zinc-400">{formatTime(task.start_time)}</span>;
    case "endTime":
      return <span className="tabular-nums text-zinc-500 dark:text-zinc-400">{formatTime(task.end_time)}</span>;
    case "retry":
      return (
        <span className={cn("tabular-nums", task.retry_id > 0 ? "text-amber-500" : "text-zinc-400")}>
          {task.retry_id > 0 ? task.retry_id : "—"}
        </span>
      );
    default:
      return <span>—</span>;
  }
});

// =============================================================================
// Sortable Header Cell
// =============================================================================

const SortableHeaderCell = memo(function SortableHeaderCell({
  col,
  sort,
  onSort,
}: {
  col: ColumnDef;
  sort: SortState;
  onSort: (column: SortColumn) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging, node } = useSortable({ id: col.id });

  // Get the element's width to prevent stretching during drag
  const width = node.current?.offsetWidth;

  // Use only translate (no scale) to prevent stretching
  const style: React.CSSProperties = {
    transform: transform ? `translate3d(${transform.x}px, 0, 0)` : undefined,
    transition,
    zIndex: isDragging ? 10 : undefined,
    opacity: isDragging ? 0.8 : 1,
    // Lock width during drag to prevent stretching
    width: isDragging && width ? width : undefined,
  };

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (col.sortable) onSort(col.id);
  }, [col.id, col.sortable, onSort]);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex cursor-grab items-center active:cursor-grabbing",
        isDragging && "rounded bg-zinc-100 px-2 shadow-md ring-1 ring-zinc-300 dark:bg-zinc-800 dark:ring-zinc-600",
        col.align === "right" && "justify-end",
      )}
      {...attributes}
      {...listeners}
    >
      <button
        onClick={handleClick}
        disabled={!col.sortable}
        className={cn("flex items-center gap-1 truncate transition-colors", col.sortable && "hover:text-zinc-900 dark:hover:text-white")}
      >
        <span className="truncate">{col.label}</span>
        {col.sortable && (
          sort.column === col.id ? (
            sort.direction === "asc" ? <ChevronUp className="h-3 w-3 shrink-0" /> : <ChevronDown className="h-3 w-3 shrink-0" />
          ) : (
            <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-30" />
          )
        )}
      </button>
    </div>
  );
});

// =============================================================================
// Task Table Header
// =============================================================================

const TaskTableHeader = memo(function TaskTableHeader({
  columns,
  gridTemplate,
  minWidth,
  sort,
  onSort,
  optionalColumnIds,
  onReorder,
}: {
  columns: ColumnDef[];
  gridTemplate: string;
  minWidth: number;
  sort: SortState;
  onSort: (column: SortColumn) => void;
  optionalColumnIds: ColumnId[];
  onReorder: (newOrder: ColumnId[]) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = optionalColumnIds.indexOf(active.id as ColumnId);
      const newIndex = optionalColumnIds.indexOf(over.id as ColumnId);
      if (oldIndex !== -1 && newIndex !== -1) {
        onReorder(arrayMove(optionalColumnIds, oldIndex, newIndex));
      }
    }
  }, [optionalColumnIds, onReorder]);

  const mandatoryIds = useMemo(() => new Set(MANDATORY_COLUMNS.map((c) => c.id)), []);

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd} modifiers={[restrictHorizontal]}>
      <div
        className="grid items-center gap-6 border-b border-zinc-100 bg-zinc-50 px-3 py-2 text-xs font-medium text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400"
        style={{ gridTemplateColumns: gridTemplate, minWidth, ...GPU_ACCELERATED_STYLE }}
      >
        {columns.filter((c) => mandatoryIds.has(c.id)).map((col) => (
          <div key={col.id} className={cn("flex items-center", col.align === "right" && "justify-end")}>
            <button
              onClick={() => col.sortable && onSort(col.id)}
              disabled={!col.sortable}
              className={cn("flex items-center gap-1 truncate transition-colors", col.sortable && "hover:text-zinc-900 dark:hover:text-white")}
            >
              <span className="truncate">{col.label}</span>
              {col.sortable && (
                sort.column === col.id ? (
                  sort.direction === "asc" ? <ChevronUp className="h-3 w-3 shrink-0" /> : <ChevronDown className="h-3 w-3 shrink-0" />
                ) : (
                  <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-30" />
                )
              )}
            </button>
          </div>
        ))}

        <SortableContext items={optionalColumnIds} strategy={horizontalListSortingStrategy}>
          {columns.filter((c) => !mandatoryIds.has(c.id)).map((col) => (
            <SortableHeaderCell key={col.id} col={col} sort={sort} onSort={onSort} />
          ))}
        </SortableContext>
      </div>
    </DndContext>
  );
});

// =============================================================================
// Virtualized Task List
// =============================================================================

const VirtualizedTaskList = memo(function VirtualizedTaskList({
  tasks,
  columns,
  selectedTaskName,
  onSelectTask,
  sort,
  onSort,
  optionalColumnIds,
  onReorderColumns,
}: {
  tasks: TaskWithDuration[];
  columns: ColumnDef[];
  selectedTaskName: string | null;
  onSelectTask: (task: TaskWithDuration) => void;
  sort: SortState;
  onSort: (column: SortColumn) => void;
  optionalColumnIds: ColumnId[];
  onReorderColumns: (newOrder: ColumnId[]) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizerCompat({
    count: tasks.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 15, // Increased overscan for smoother scrolling
  });

  // Memoize expensive computations with stable references
  const gridTemplate = useMemo(() => getGridTemplate(columns), [columns]);
  const minWidth = useMemo(() => getMinTableWidth(columns), [columns]);
  const visibleColumnIds = useMemo(() => columns.map((c) => c.id), [columns]);

  // Pre-compute virtual items for stable reference
  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();

  if (tasks.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-zinc-500 dark:text-zinc-400">
        No tasks match your filters
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="flex-1 overflow-auto overscroll-contain" style={GPU_ACCELERATED_STYLE}>
      <div className="sticky top-0 z-10" style={{ minWidth, ...CONTAIN_STYLE }}>
        <TaskTableHeader
          columns={columns}
          gridTemplate={gridTemplate}
          minWidth={minWidth}
          sort={sort}
          onSort={onSort}
          optionalColumnIds={optionalColumnIds}
          onReorder={onReorderColumns}
        />
      </div>

      <div style={{ height: totalSize, position: "relative", ...GPU_ACCELERATED_STYLE }}>
        {virtualItems.map((virtualRow) => {
          const task = tasks[virtualRow.index];
          return (
            <div
              key={task.name}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: ROW_HEIGHT,
                transform: `translate3d(0, ${virtualRow.start}px, 0)`,
                ...VIRTUAL_ITEM_STYLE,
              }}
            >
              <TaskRow
                task={task}
                gridTemplate={gridTemplate}
                minWidth={minWidth}
                isSelected={selectedTaskName === task.name}
                onSelect={() => onSelectTask(task)}
                visibleColumnIds={visibleColumnIds}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
});

// =============================================================================
// Task Detail Mini Panel
// =============================================================================

const TaskDetailMini = memo(function TaskDetailMini({ task, onClose }: { task: TaskWithDuration; onClose: () => void }) {
  const category = STATUS_CATEGORY_MAP[task.status];

  return (
    <div className="border-t border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-900" style={CONTAIN_STYLE}>
      <div className="mb-3 flex items-start justify-between">
        <div>
          <h4 className="font-medium text-zinc-900 dark:text-white">{task.name}</h4>
          <div className="mt-1 flex items-center gap-2">
            <StatusIcon status={task.status} />
            <span
              className={cn(
                "text-sm",
                category === "completed" && "text-emerald-600 dark:text-emerald-400",
                category === "running" && "text-blue-600 dark:text-blue-400",
                category === "failed" && "text-red-600 dark:text-red-400",
                category === "waiting" && "text-zinc-500 dark:text-zinc-400",
              )}
            >
              {STATUS_LABELS[task.status] || task.status}
            </span>
          </div>
        </div>
        <button onClick={onClose} className="rounded p-1 hover:bg-zinc-200 dark:hover:bg-zinc-700">
          <X className="h-4 w-4" />
        </button>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">Duration</dt>
          <dd className="font-medium text-zinc-900 dark:text-white">{formatDuration(task.duration)}</dd>
        </div>
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">Node</dt>
          <dd className="font-medium text-zinc-900 dark:text-white">{task.node_name ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">Pod IP</dt>
          <dd className="font-mono text-zinc-900 dark:text-white">{task.pod_ip ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">Exit Code</dt>
          <dd className="font-mono text-zinc-900 dark:text-white">{task.exit_code ?? "—"}</dd>
        </div>
      </dl>

      {task.failure_message && (
        <div className="mt-3 rounded-md bg-red-50 p-2 text-sm text-red-800 dark:bg-red-900/20 dark:text-red-200">
          {task.failure_message}
        </div>
      )}

      <div className="mt-4 flex gap-2">
        <button className="flex items-center gap-1.5 rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200">
          <ScrollText className="h-3.5 w-3.5" />
          Logs
        </button>
        <button className="flex items-center gap-1.5 rounded-md bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700">
          <Terminal className="h-3.5 w-3.5" />
          Shell
        </button>
        <button className="flex items-center gap-1.5 rounded-md bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700">
          <ExternalLink className="h-3.5 w-3.5" />
          Dashboard
        </button>
      </div>
    </div>
  );
});

// =============================================================================
// Width Presets
// =============================================================================

const WIDTH_PRESETS = [
  { key: "33", pct: 33, icon: PanelLeftClose },
  { key: "50", pct: 50, icon: Columns2 },
  { key: "75", pct: 75, icon: PanelLeft },
];

// =============================================================================
// Group Panel Component
// =============================================================================

interface GroupPanelProps {
  group: MockGroup;
  onClose: () => void;
  panelPct?: number;
  onPanelResize?: (pct: number) => void;
}

function GroupPanel({ group, onClose, panelPct, onPanelResize }: GroupPanelProps) {
  const [searchChips, setSearchChips] = useState<SearchChip[]>([]);
  const [selectedTaskName, setSelectedTaskName] = useState<string | null>(null);

  const [sort, setSort] = usePersistedState<SortState>("sort", { column: "status", direction: "asc" });
  const [visibleOptionalIds, setVisibleOptionalIds] = usePersistedState<ColumnId[]>("visibleOptionalIds", DEFAULT_VISIBLE_OPTIONAL);

  const stats = useMemo(() => computeAllStats(group.tasks), [group.tasks]);
  const groupStatus = useMemo(() => computeGroupStatusFromStats(stats), [stats]);
  const groupDuration = useMemo(() => computeGroupDurationFromStats(stats), [stats]);

  const visibleColumns = useMemo(() => {
    const optionalCols = visibleOptionalIds
      .map((id) => OPTIONAL_COLUMN_MAP.get(id))
      .filter(Boolean) as ColumnDef[];
    return [...MANDATORY_COLUMNS, ...optionalCols];
  }, [visibleOptionalIds]);

  const sortComparator = useMemo(() => {
    if (!sort.column) return null;
    const dir = sort.direction === "asc" ? 1 : -1;

    switch (sort.column) {
      case "status": return (a: TaskWithDuration, b: TaskWithDuration) => (STATUS_ORDER[a.status] - STATUS_ORDER[b.status]) * dir;
      case "name": return (a: TaskWithDuration, b: TaskWithDuration) => a.name.localeCompare(b.name) * dir;
      case "duration": return (a: TaskWithDuration, b: TaskWithDuration) => ((a.duration ?? 0) - (b.duration ?? 0)) * dir;
      case "node": return (a: TaskWithDuration, b: TaskWithDuration) => (a.node_name ?? "").localeCompare(b.node_name ?? "") * dir;
      case "podIp": return (a: TaskWithDuration, b: TaskWithDuration) => (a.pod_ip ?? "").localeCompare(b.pod_ip ?? "") * dir;
      case "exitCode": return (a: TaskWithDuration, b: TaskWithDuration) => ((a.exit_code ?? -1) - (b.exit_code ?? -1)) * dir;
      case "startTime": return (a: TaskWithDuration, b: TaskWithDuration) => {
        const aTime = a.start_time ? new Date(a.start_time).getTime() : 0;
        const bTime = b.start_time ? new Date(b.start_time).getTime() : 0;
        return (aTime - bTime) * dir;
      };
      case "endTime": return (a: TaskWithDuration, b: TaskWithDuration) => {
        const aTime = a.end_time ? new Date(a.end_time).getTime() : 0;
        const bTime = b.end_time ? new Date(b.end_time).getTime() : 0;
        return (aTime - bTime) * dir;
      };
      case "retry": return (a: TaskWithDuration, b: TaskWithDuration) => (a.retry_id - b.retry_id) * dir;
      default: return null;
    }
  }, [sort.column, sort.direction]);

  const filteredTasks = useMemo(() => {
    // Apply search chips (including status chips)
    let result = filterTasksByChips(group.tasks, searchChips);

    if (sortComparator) {
      result = [...result].sort(sortComparator);
    }

    return result;
  }, [group.tasks, searchChips, sortComparator]);

  const toggleColumn = useCallback((columnId: ColumnId) => {
    setVisibleOptionalIds((prev) => {
      if (prev.includes(columnId)) return prev.filter((id) => id !== columnId);
      return [...prev, columnId];
    });
  }, [setVisibleOptionalIds]);

  const reorderColumns = useCallback((newOrder: ColumnId[]) => {
    setVisibleOptionalIds(newOrder);
  }, [setVisibleOptionalIds]);

  const handleSort = useCallback((column: SortColumn) => {
    setSort((prev) => {
      if (prev.column === column) {
        if (prev.direction === "asc") return { column, direction: "desc" };
        return { column: null, direction: "asc" };
      }
      return { column, direction: "asc" };
    });
  }, [setSort]);

  const handleSelectTask = useCallback((task: TaskWithDuration) => {
    setSelectedTaskName(task.name);
  }, []);

  const handleCloseDetail = useCallback(() => {
    setSelectedTaskName(null);
  }, []);

  const handleClearFilters = useCallback(() => {
    setSearchChips([]);
  }, []);

  const selectedTask = useMemo(() => {
    if (!selectedTaskName) return null;
    return group.tasks.find((t) => t.name === selectedTaskName) ?? null;
  }, [group.tasks, selectedTaskName]);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-white shadow-[-4px_0_16px_-4px_rgba(0,0,0,0.1)] dark:bg-zinc-950 dark:shadow-[-4px_0_16px_-4px_rgba(0,0,0,0.4)]" style={CONTAIN_STYLE}>
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-2.5 dark:border-zinc-800">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-sm font-semibold text-zinc-900 dark:text-white">{group.name}</h2>
            <span className="text-zinc-300 dark:text-zinc-600">·</span>
            <span className="shrink-0 text-sm text-zinc-500 dark:text-zinc-400">{group.tasks.length} tasks</span>
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-xs">
            <span
              className={cn(
                "flex items-center gap-1.5",
                groupStatus.status === "completed" && "text-emerald-600 dark:text-emerald-400",
                groupStatus.status === "running" && "text-blue-600 dark:text-blue-400",
                groupStatus.status === "failed" && "text-red-600 dark:text-red-400",
                groupStatus.status === "pending" && "text-zinc-500 dark:text-zinc-400",
              )}
            >
              {groupStatus.status === "completed" && <Check className="h-3 w-3" />}
              {groupStatus.status === "running" && <Loader2 className="h-3 w-3 animate-spin" />}
              {groupStatus.status === "failed" && <AlertCircle className="h-3 w-3" />}
              {groupStatus.status === "pending" && <Clock className="h-3 w-3" />}
              <span className="font-medium">{groupStatus.label}</span>
            </span>
            {groupDuration !== null && (
              <>
                <span className="text-zinc-300 dark:text-zinc-600">·</span>
                <span className="text-zinc-500 dark:text-zinc-400">{formatDuration(groupDuration)}</span>
              </>
            )}
          </div>
        </div>

        <div className="ml-2 flex shrink-0 items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300">
                <MoreVertical className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Columns className="mr-2 h-4 w-4" />
                  Columns
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-36">
                  {/* Alphabetical order for stable menu - user drags header to reorder */}
                  {OPTIONAL_COLUMNS_ALPHABETICAL.map((col) => (
                    <DropdownMenuCheckboxItem
                      key={col.id}
                      checked={visibleOptionalIds.includes(col.id)}
                      onCheckedChange={() => toggleColumn(col.id)}
                      onSelect={(e) => e.preventDefault()}
                    >
                      {col.menuLabel}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>

              {onPanelResize && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-xs text-zinc-500">Snap to</DropdownMenuLabel>
                  {WIDTH_PRESETS.map((preset) => {
                    const Icon = preset.icon;
                    return (
                      <DropdownMenuItem key={preset.key} onClick={() => onPanelResize(preset.pct)}>
                        <Icon className="mr-2 h-4 w-4" />
                        <span>{preset.pct}%</span>
                      </DropdownMenuItem>
                    );
                  })}
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="space-y-2 border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
        <SmartSearch
          tasks={group.tasks}
          chips={searchChips}
          onChipsChange={setSearchChips}
          placeholder="Filter by name, status:, ip:, duration:, and more..."
        />
        {searchChips.length > 0 && (
          <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
            <span>Showing {filteredTasks.length} of {group.tasks.length} tasks</span>
            <button onClick={handleClearFilters} className="text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300">
              Clear filters
            </button>
          </div>
        )}
      </div>

      <VirtualizedTaskList
        tasks={filteredTasks}
        columns={visibleColumns}
        selectedTaskName={selectedTaskName}
        onSelectTask={handleSelectTask}
        sort={sort}
        onSort={handleSort}
        optionalColumnIds={visibleOptionalIds}
        onReorderColumns={reorderColumns}
      />

      {selectedTask && <TaskDetailMini task={selectedTask} onClose={handleCloseDetail} />}
    </div>
  );
}

// =============================================================================
// Resizable Panel Hook
// =============================================================================

function useResizablePanel(initialPct: number = 50, minPct: number = 25, maxPct: number = 80) {
  const [panelPct, setPanelPct] = usePersistedState<number>("panelPct", initialPct);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const pendingPctRef = useRef<number | null>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  useEffect(() => {
    if (!isDragging) return;

    // RAF-throttled resize for 60fps smooth dragging
    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const pct = 100 - (x / rect.width) * 100;
      pendingPctRef.current = Math.min(maxPct, Math.max(minPct, pct));

      if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(() => {
          if (pendingPctRef.current !== null) {
            setPanelPct(pendingPctRef.current);
          }
          rafRef.current = null;
        });
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };

    // Passive event listeners for better scroll performance
    document.addEventListener("mousemove", handleMouseMove, { passive: true });
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [isDragging, minPct, maxPct, setPanelPct]);

  return { panelPct, setPanelPct, isDragging, handleMouseDown, containerRef };
}

// =============================================================================
// Main Page
// =============================================================================

const SCENARIOS = [
  { name: "training-gpt4", taskCount: 64 },
  { name: "inference-batch", taskCount: 256 },
  { name: "data-preprocessing", taskCount: 1000 },
  { name: "small-job", taskCount: 8 },
] as const;

export default function GroupPanelPage() {
  const [scenarioIdx, setScenarioIdx] = useState(0);
  const [showPanel, setShowPanel] = useState(true);
  const { panelPct, setPanelPct, isDragging, handleMouseDown, containerRef } = useResizablePanel(50, 25, 80);

  const scenario = SCENARIOS[scenarioIdx];
  const group = useMemo(() => generateMockGroup(scenario.taskCount, scenario.name), [scenario]);

  return (
    <div className="flex h-screen flex-col bg-zinc-100 dark:bg-zinc-900">
      <div className="flex items-center justify-between border-b border-zinc-200 bg-white px-4 py-2 dark:border-zinc-800 dark:bg-zinc-950">
        <h1 className="text-sm font-medium text-zinc-900 dark:text-white">Group Panel Dev</h1>
        <div className="flex items-center gap-2">
          <select
            value={scenarioIdx}
            onChange={(e) => setScenarioIdx(Number(e.target.value))}
            className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-800"
          >
            {SCENARIOS.map((s, i) => (
              <option key={s.name} value={i}>{s.name} ({s.taskCount} tasks)</option>
            ))}
          </select>
          <button
            onClick={() => setShowPanel(!showPanel)}
            className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-800"
          >
            {showPanel ? "Hide" : "Show"} Panel
          </button>
        </div>
      </div>

      <div ref={containerRef} className="relative flex-1 overflow-hidden">
        <div className="absolute inset-0 flex items-center justify-center bg-zinc-50 dark:bg-zinc-900">
          <div className="text-center">
            <div className="text-4xl text-zinc-300 dark:text-zinc-700">DAG Canvas</div>
            <div className="mt-2 text-sm text-zinc-400">{scenario.name} • {scenario.taskCount} tasks</div>
          </div>
        </div>

        {showPanel && (
          <>
              <div
                className={cn(
                  "group absolute top-0 z-20 h-full w-1 cursor-ew-resize",
                  isDragging ? "bg-blue-500" : "bg-transparent hover:bg-zinc-300 dark:hover:bg-zinc-600",
                )}
                style={{
                  left: `${100 - panelPct}%`,
                  transform: "translateX(-50%)",
                  // GPU layer for smooth dragging
                  willChange: isDragging ? "left" : "auto",
                }}
                onMouseDown={handleMouseDown}
              >
                <div
                  className={cn(
                    "absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded bg-zinc-200 px-0.5 py-1 shadow-md dark:bg-zinc-700",
                    isDragging ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                  )}
                  style={{
                    transition: "opacity 150ms ease-out",
                    ...GPU_ACCELERATED_STYLE,
                  }}
                >
                  <GripVertical className="h-4 w-4 text-zinc-600 dark:text-zinc-300" />
                </div>
              </div>

            <div
              className="absolute inset-y-0 right-0 z-10"
              style={{ width: `${panelPct}%`, ...GPU_ACCELERATED_STYLE }}
            >
              <GroupPanel
                group={group}
                onClose={() => setShowPanel(false)}
                panelPct={panelPct}
                onPanelResize={setPanelPct}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

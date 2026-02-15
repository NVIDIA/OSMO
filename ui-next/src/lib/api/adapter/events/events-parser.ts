//SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.

//Licensed under the Apache License, Version 2.0 (the "License");
//you may not use this file except in compliance with the License.
//You may obtain a copy of the License at

//http://www.apache.org/licenses/LICENSE-2.0

//Unless required by applicable law or agreed to in writing, software
//distributed under the License is distributed on an "AS IS" BASIS,
//WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//See the License for the specific language governing permissions and
//limitations under the License.

//SPDX-License-Identifier: Apache-2.0

/**
 * Kubernetes Event Parser
 * Parses plain text event stream from backend into structured K8s events.
 */

import { classifyEvent } from "@/lib/api/adapter/events/events-utils";
import type { K8sEvent } from "@/lib/api/adapter/events/events-types";
import { K8S_EVENT_REASONS } from "@/lib/api/adapter/events/events-types";

// ============================================================================
// Regex Patterns (Pre-compiled for Performance)
// ============================================================================

// Timestamp: Matches both "2026-02-12 08:38:57+00:00" and "2026-02-12T08:38:57.035Z"
const TIMESTAMP_RE = /^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:[+\-]\d{2}:\d{2}|Z)?)/;

// Entity: Matches [worker_27] or [worker_27 retry-2]
const ENTITY_RE = /^\[([^\]]+)\]/;

// Retry: Extracts task name and retry_id from entity string
const RETRY_RE = /^([^\s]+)(?:\s+retry-(\d+))?$/;

// Reason: Matches "Created:" or "Pulled:"
const REASON_RE = /^([^:]+):/;

// Message patterns for extracting semantic info
const EXIT_CODE_RE = /exit code (\d+)/i;
const SIGNAL_RE = /signal (\d+)/i;
const CONTAINER_NAME_RE = /container[:\s]+(\S+)/i;

// ============================================================================
// Event ID Counter
// ============================================================================

let eventIdCounter = 0;

/**
 * Reset event ID counter (useful for testing).
 */
export function resetEventIdCounter(): void {
  eventIdCounter = 0;
}

// ============================================================================
// Message Parsing
// ============================================================================

function extractExitCode(message: string): number | undefined {
  const match = EXIT_CODE_RE.exec(message);
  return match ? parseInt(match[1], 10) : undefined;
}

function extractSignal(message: string): number | undefined {
  const match = SIGNAL_RE.exec(message);
  return match ? parseInt(match[1], 10) : undefined;
}

function extractContainerName(message: string): string | undefined {
  const match = CONTAINER_NAME_RE.exec(message);
  return match ? match[1] : undefined;
}

/**
 * Infer event type from reason.
 * Canonical K8s uses "Normal" vs "Warning" event types.
 */
function inferEventType(reason: string): "Normal" | "Warning" {
  const warningReasons = [
    K8S_EVENT_REASONS.FAILED,
    K8S_EVENT_REASONS.FAILED_SCHEDULING,
    K8S_EVENT_REASONS.ERR_IMAGE_PULL,
    K8S_EVENT_REASONS.IMAGE_PULL_BACK_OFF,
    K8S_EVENT_REASONS.BACK_OFF,
    K8S_EVENT_REASONS.CRASH_LOOP_BACK_OFF,
    K8S_EVENT_REASONS.OOM_KILLED,
    K8S_EVENT_REASONS.EVICTED,
    K8S_EVENT_REASONS.UNHEALTHY,
    K8S_EVENT_REASONS.FAILED_MOUNT,
    K8S_EVENT_REASONS.NODE_NOT_READY,
    K8S_EVENT_REASONS.ERROR,
  ];

  return warningReasons.some((w) => reason.includes(w)) ? "Warning" : "Normal";
}

// ============================================================================
// Line Parsing
// ============================================================================

/**
 * Parse a single event line from plain text format.
 *
 * Format: {timestamp} [{entity}] {reason}: {message}
 * Example: 2026-02-12 08:38:57+00:00 [worker_27] Created: Created container worker-27
 */
export function parseEventLine(line: string): K8sEvent | null {
  if (!line.trim()) return null;

  let remaining = line;

  // 1. Parse timestamp
  const tsMatch = TIMESTAMP_RE.exec(remaining);
  if (!tsMatch) return null;

  const timestampStr = tsMatch[1];
  const normalizedTs =
    timestampStr.includes("+") || timestampStr.includes("-") || timestampStr.endsWith("Z")
      ? timestampStr
      : `${timestampStr}+00:00`;
  const timestamp = new Date(normalizedTs);

  if (isNaN(timestamp.getTime())) return null;
  remaining = remaining.slice(tsMatch[0].length).trim();

  // 2. Parse entity (task/pod name) and extract retry info
  const entityMatch = ENTITY_RE.exec(remaining);
  if (!entityMatch) return null;

  const entity = entityMatch[1];
  remaining = remaining.slice(entityMatch[0].length).trim();

  const retryMatch = RETRY_RE.exec(entity);
  const taskName = retryMatch ? retryMatch[1] : entity;
  const retryId = retryMatch?.[2] ? parseInt(retryMatch[2], 10) : 0;

  // 3. Parse reason
  const reasonMatch = REASON_RE.exec(remaining);
  if (!reasonMatch) return null;

  const reason = reasonMatch[1].trim();
  remaining = remaining.slice(reasonMatch[0].length).trim();

  // 4. Parse message (remaining text)
  const message = remaining;

  // 5. Classify event
  const type = inferEventType(reason);
  const { stage, severity } = classifyEvent(reason, type);

  // 6. Extract semantic information from message
  const exitCode = extractExitCode(message);
  const signal = extractSignal(message);
  const containerName = extractContainerName(message);

  // 7. Generate unique ID
  const id = `${timestamp.getTime()}-${++eventIdCounter}`;

  return {
    id,
    timestamp,
    entity,
    taskName,
    retryId,
    type,
    reason,
    message,
    source: { component: "kubelet" },
    involvedObject: { kind: "Task", name: entity },
    severity,
    stage,
    containerName,
    exitCode,
    signal,
  };
}

// ============================================================================
// Chunk Parsing (Incremental / Streaming)
// ============================================================================

/**
 * Parse a chunk of text containing one or more event lines.
 * Returns events in arrival order (no sorting).
 *
 * Use this for incremental/streaming parsing where the caller
 * accumulates events and the downstream grouping layer handles ordering.
 */
export function parseEventChunk(text: string): K8sEvent[] {
  const lines = text.split("\n");
  const events: K8sEvent[] = [];

  for (const line of lines) {
    if (line.trim()) {
      const event = parseEventLine(line);
      if (event) events.push(event);
    }
  }

  return events;
}

// ============================================================================
// Response Parsing
// ============================================================================

/**
 * Parse plain text event stream into structured K8s events.
 * Returns events sorted by timestamp DESC (newest first).
 *
 * @deprecated Prefer {@link parseEventChunk} for streaming use cases.
 * This function is retained for backward compatibility with non-streaming callers.
 */
export function parseEventsResponse(rawResponse: string): K8sEvent[] {
  if (typeof rawResponse !== "string") return [];

  const events = parseEventChunk(rawResponse);
  events.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

  return events;
}

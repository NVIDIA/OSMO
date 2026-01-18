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

// Shared synchronized timestamp for live durations. Single interval across all consumers.

import { useSyncExternalStore } from "react";
import { useDocumentVisibility } from "@react-hookz/web";
import { useInterval } from "usehooks-ts";

let tickNow = Date.now();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): number {
  return tickNow;
}

function getServerSnapshot(): number {
  return Date.now();
}

function tick(): void {
  tickNow = Date.now();
  listeners.forEach((listener) => listener());
}

// Pauses when document not visible or explicitly disabled
export function useTickController(enabled: boolean = true, intervalMs: number = 1000): void {
  const isVisible = useDocumentVisibility();
  useInterval(tick, isVisible && enabled ? intervalMs : null);
}

export function useTick(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function useLiveDuration(startTimeMs: number | null, endTimeMs: number | null = null): number | null {
  const now = useTick();

  if (startTimeMs === null) return null;

  const end = endTimeMs ?? now;
  const durationMs = end - startTimeMs;

  return Math.max(0, Math.floor(durationMs / 1000));
}

export function calculateLiveDuration(now: number, start: Date | null, end: Date | null): number | null {
  if (!start) return null;
  const endTime = end ? end.getTime() : now;
  const duration = Math.floor((endTime - start.getTime()) / 1000);
  return Math.max(0, duration);
}

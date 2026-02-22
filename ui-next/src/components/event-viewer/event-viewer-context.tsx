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

"use client";

import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";
import type { TaskGroupStatus } from "@/lib/api/generated";

/**
 * Context shared across the event viewer component tree.
 *
 * Centralises the parent state that LifecycleProgressBar needs for accurate
 * display, avoiding prop-drilling through EventViewerTable and TaskRow.
 *
 * isParentTerminal — whether the parent entity (workflow / task) has reached
 *                    a terminal state in Postgres.
 *
 * taskStatus       — OSMO task status from Postgres; only available in task
 *                    scope (TaskDetails). Undefined in workflow scope.
 *                    K8s events arrive faster than Postgres state updates, so
 *                    this is used to correct the "Running" label when K8s
 *                    events have raced ahead of the authoritative OSMO state.
 *
 * taskStatuses     — Per-task status map for workflow scope. Key format:
 *                    `${taskName}:${retryId}`. Populated from workflow.groups[].tasks[].
 *                    Allows each TaskRow to resolve its own OSMO status without
 *                    prop drilling. Undefined in task scope (taskStatus used instead).
 */
interface EventViewerContextValue {
  isParentTerminal: boolean;
  taskStatus: TaskGroupStatus | undefined;
  taskStatuses: Map<string, TaskGroupStatus> | undefined;
}

const DEFAULT_CONTEXT: EventViewerContextValue = {
  isParentTerminal: false,
  taskStatus: undefined,
  taskStatuses: undefined,
};

const EventViewerContext = createContext<EventViewerContextValue>(DEFAULT_CONTEXT);

export function useEventViewerContext(): EventViewerContextValue {
  return useContext(EventViewerContext);
}

interface EventViewerProviderProps {
  isParentTerminal: boolean;
  taskStatus?: TaskGroupStatus;
  taskStatuses?: Map<string, TaskGroupStatus>;
  children: ReactNode;
}

export function EventViewerProvider({
  isParentTerminal,
  taskStatus,
  taskStatuses,
  children,
}: EventViewerProviderProps) {
  const value = useMemo(
    () => ({ isParentTerminal, taskStatus, taskStatuses }),
    [isParentTerminal, taskStatus, taskStatuses],
  );
  return <EventViewerContext.Provider value={value}>{children}</EventViewerContext.Provider>;
}

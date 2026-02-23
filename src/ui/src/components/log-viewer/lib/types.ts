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

import type { LogEntry, HistogramBucket } from "@/lib/api/log-adapter/types";
import type { SearchChip } from "@/components/filter-bar/lib/types";
import type { TimeRangePreset } from "@/components/log-viewer/lib/timeline-constants";

export interface WorkflowMetadata {
  name: string;
  status: string;
  submitTime?: Date;
  startTime?: Date;
  endTime?: Date;
}

export interface HistogramData {
  buckets: HistogramBucket[];
  intervalMs: number;
}

export interface LogViewerDataProps {
  rawEntries: LogEntry[];
  filteredEntries: LogEntry[];
  isLoading: boolean;
  isFetching: boolean;
  error: Error | null;
  histogram: HistogramData | undefined;
  pendingHistogram: HistogramData | undefined;
  isStreaming: boolean;
  externalLogUrl?: string;
  onRefetch: () => void;
}

export interface LogViewerFilterProps {
  filterChips: SearchChip[];
  onFilterChipsChange: (chips: SearchChip[]) => void;
  scope: "workflow" | "group" | "task";
}

export interface LogViewerTimelineProps {
  filterStartTime: Date | undefined;
  filterEndTime: Date | undefined;
  displayStart: Date;
  displayEnd: Date;
  activePreset: TimeRangePreset | undefined;
  onFilterStartTimeChange: (time: Date | undefined) => void;
  onFilterEndTimeChange: (time: Date | undefined) => void;
  onPresetSelect: (preset: TimeRangePreset) => void;
  onDisplayRangeChange: (start: Date, end: Date) => void;
  onClearPendingDisplay: () => void;
  entityStartTime: Date;
  entityEndTime: Date | undefined;
  now: number;
}

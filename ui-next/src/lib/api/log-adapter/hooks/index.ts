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
 * Log Adapter Hooks
 *
 * React hooks for log data access.
 */

// Adapter hook
export { useLogAdapter, useLogAdapterCapabilities, LogAdapterProvider } from "./use-log-adapter";
export type { LogAdapterProviderProps } from "./use-log-adapter";

// Unified data hook (preferred)
export { useLogData } from "./use-log-data";
export type { UseLogDataParams, UseLogDataReturn } from "./use-log-data";

// Query hook (deprecated - use useLogData instead)
export { useLogQuery } from "./use-log-query";
export type { UseLogQueryParams, UseLogQueryReturn } from "./use-log-query";

// Histogram hook
export { useLogHistogram } from "./use-log-histogram";
export type { UseLogHistogramParams, UseLogHistogramReturn } from "./use-log-histogram";

// Facets hook
export { useLogFacets } from "./use-log-facets";
export type { UseLogFacetsParams, UseLogFacetsReturn } from "./use-log-facets";

// Tail hook
export { useLogTail } from "./use-log-tail";
export type { UseLogTailParams, UseLogTailReturn } from "./use-log-tail";

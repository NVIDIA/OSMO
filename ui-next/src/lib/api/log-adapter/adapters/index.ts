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
 * Log Adapter Implementations
 *
 * Exports adapter classes and utility functions.
 */

// Parser
export { parseLogLine, parseLogBatch, stripAnsi, resetIdCounter, formatLogLine } from "./log-parser";

// Compute functions (stateless, SSR-compatible)
export { filterEntries, computeHistogram, computeFacets } from "./compute";
export type { FilterParams, ComputeHistogramOptions } from "./compute";

// Plain Text Adapter
export { PlainTextAdapter } from "./plain-text-adapter";
export type { PlainTextAdapterConfig, QueryAllParams } from "./plain-text-adapter";

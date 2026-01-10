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

/**
 * SmartSearch Library - Pure TypeScript, no React.
 *
 * This module contains types and pure functions that have NO React dependencies.
 * Can be used on server-side, in workers, or anywhere TypeScript runs.
 *
 * For React hooks, see ../hooks/
 */

// Types
export type {
  ChipVariant,
  SearchField,
  SearchChip,
  SearchPreset,
  PresetRenderProps,
  SmartSearchProps,
  Suggestion,
  ParsedInput,
  ResultsCount,
} from "./types";

// Pure functions
export { filterByChips } from "./filter";

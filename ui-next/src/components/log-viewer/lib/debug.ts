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
 * Debug logging utilities for log-viewer
 *
 * These are tree-shaken in production builds because the conditional
 * assignment evaluates to a no-op function at build time.
 */

export const debugLog =
  process.env.NODE_ENV === "development" ? console.log.bind(console, "[log-viewer]") : (): void => {};

export const debugWarn =
  process.env.NODE_ENV === "development" ? console.warn.bind(console, "[log-viewer]") : (): void => {};

export const debugError =
  process.env.NODE_ENV === "development" ? console.error.bind(console, "[log-viewer]") : (): void => {};

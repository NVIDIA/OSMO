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

/**
 * Production MSW Handlers Stub
 *
 * This is a no-op version that's swapped in during production builds.
 * It ensures zero MSW/mock code is included in the production bundle.
 *
 * The swap is configured in next.config.ts via turbopack.resolveAlias.
 *
 * IMPORTANT: This file must NOT import from 'msw' or any mock-related modules
 * to ensure proper tree-shaking. We use 'unknown[]' instead of 'HttpHandler[]'
 * to avoid pulling in the msw dependency.
 */

// Empty handlers array - no mock interception in production
// Using unknown[] to avoid importing msw types
export const handlers: unknown[] = [];

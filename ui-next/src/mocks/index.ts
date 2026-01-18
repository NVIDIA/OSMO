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
 * MSW Mock API
 *
 * Architecture:
 * - All mocking happens server-side via MSW Node (see server.ts)
 * - Client requests go through Next.js rewrites → proxy → MSW intercepts
 * - No browser-side MSW needed - same code path as production
 *
 * Usage:
 * 1. Set NEXT_PUBLIC_MOCK_API=true in .env.local
 * 2. Or run: pnpm dev:mock
 *
 * Console API (in browser devtools):
 *   __mockConfig.help()  // See all options
 */

export { handlers } from "./handlers";

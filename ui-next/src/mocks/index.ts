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
 * MSW Mocks - Public API
 *
 * This module exports:
 * - `handlers`: Array of MSW request handlers for browser mocking
 * - `server`: MSW server for Node.js testing (Vitest)
 *
 * Usage in tests:
 *   import { server } from '@/mocks';
 *   beforeAll(() => server.listen());
 *   afterEach(() => server.resetHandlers());
 *   afterAll(() => server.close());
 *
 * Usage in browser (via MockProvider):
 *   The MockProvider component sets up browser mocking automatically.
 */

export { handlers } from "./handlers";
export { server } from "./server";

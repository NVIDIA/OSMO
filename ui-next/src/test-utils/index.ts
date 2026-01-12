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
 * Test Utilities
 *
 * Reusable test helpers for the OSMO UI codebase.
 *
 * ## Providers
 *
 * - `TestProviders` - Wrapper component with all providers
 * - `createWrapper` - Factory for custom wrapper configurations
 * - `createTestQueryClient` - Test-optimized React Query client
 *
 * ## Factories
 *
 * - `createMockPool` / `createMockPools` - Pool test data
 * - `createMockResource` / `createMockResources` - Resource test data
 * - `createMockWorkflow` / `createMockWorkflows` - Workflow test data
 * - `createMockChip` / `createMockChips` - Search chip test data
 * - `resetIdCounter` - Reset unique ID counter between tests
 *
 * @example
 * ```tsx
 * import { TestProviders, createMockPool, resetIdCounter } from '@/test-utils';
 *
 * beforeEach(() => {
 *   resetIdCounter();
 * });
 *
 * test('renders pool', () => {
 *   const pool = createMockPool({ status: 'ONLINE' });
 *   render(<PoolCard pool={pool} />, { wrapper: TestProviders });
 * });
 * ```
 */

// =============================================================================
// Provider Utilities
// =============================================================================

export {
  TestProviders,
  createWrapper,
  createTestQueryClient,
  defaultConfig,
  createMockServices,
  type RenderWithProvidersOptions,
  type TestProvidersProps,
  type AppConfig,
  type Services,
} from "./render-with-providers";

// =============================================================================
// Data Factories
// =============================================================================

export {
  // Pool factories
  createMockPool,
  createMockPools,
  // Resource factories
  createMockResource,
  createMockResources,
  // Workflow factories
  createMockWorkflow,
  createMockWorkflows,
  type MockWorkflow,
  // Search chip factories
  createMockChip,
  createMockChips,
  type MockSearchChip,
  // Utilities
  resetIdCounter,
} from "./factories";

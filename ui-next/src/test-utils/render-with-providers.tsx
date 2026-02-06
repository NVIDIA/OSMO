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
 * Test Provider Wrapper
 *
 * Provides a convenient way to wrap components with all necessary providers
 * for testing. Supports overriding config and services for isolated tests.
 *
 * @example
 * ```tsx
 * // Basic usage
 * render(<MyComponent />, { wrapper: TestProviders });
 *
 * // With custom config
 * renderWithProviders(<MyComponent />, {
 *   config: { table: { rowHeights: { normal: 40 } } },
 * });
 *
 * // With mock services
 * const mockCopy = vi.fn().mockResolvedValue(true);
 * renderWithProviders(<CopyButton />, {
 *   services: { clipboard: { copy: mockCopy } },
 * });
 * ```
 */

import { type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConfigProvider, defaultConfig, type AppConfig } from "@/contexts/config-context";
import { ServiceProvider, type Services } from "@/contexts/service-context";

// =============================================================================
// Mock Services (test-only)
// =============================================================================

/**
 * Create mock service implementations for testing.
 * These are no-op stubs that don't interact with browser APIs.
 */
export function createMockServices(): Services {
  return {
    clipboard: {
      copy: async () => true,
    },
    announcer: {
      announce: () => {},
    },
  };
}

// =============================================================================
// Types
// =============================================================================

export interface RenderWithProvidersOptions {
  /** Override application configuration */
  config?: Partial<AppConfig>;
  /** Override services (clipboard, announcer) */
  services?: Partial<Services>;
  /** Custom query client for React Query */
  queryClient?: QueryClient;
}

// =============================================================================
// Test Query Client
// =============================================================================

/**
 * Create a QueryClient configured for testing.
 *
 * - Disables retries (fail fast)
 * - Disables refetch on window focus
 * - Sets gcTime to Infinity to prevent garbage collection during tests
 */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
        gcTime: Infinity,
        staleTime: Infinity,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

// =============================================================================
// Test Providers Component
// =============================================================================

export interface TestProvidersProps {
  children: ReactNode;
  config?: Partial<AppConfig>;
  services?: Partial<Services>;
  queryClient?: QueryClient;
}

/**
 * Test provider wrapper component.
 *
 * Wraps children with all necessary providers for testing:
 * - ConfigProvider (with optional overrides)
 * - ServiceProvider (with mock services by default)
 * - QueryClientProvider (with test-optimized client)
 */
export function TestProviders({
  children,
  config,
  services,
  queryClient = createTestQueryClient(),
}: TestProvidersProps) {
  // Merge mock services with any overrides
  const mockServices = createMockServices();
  const mergedServices: Services = {
    clipboard: services?.clipboard ?? mockServices.clipboard,
    announcer: services?.announcer ?? mockServices.announcer,
  };

  return (
    <ConfigProvider config={config}>
      <ServiceProvider services={mergedServices}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </ServiceProvider>
    </ConfigProvider>
  );
}

// =============================================================================
// Render Helper
// =============================================================================

/**
 * Render a component with all providers for testing.
 *
 * This is a convenience function that creates the wrapper with options.
 * For most tests, you can use `render(<Component />, { wrapper: TestProviders })`.
 *
 * @param ui - The component to render
 * @param options - Provider options (config, services, queryClient)
 * @returns The rendered component wrapped in providers
 *
 * @example
 * ```tsx
 * import { render, screen } from '@testing-library/react';
 * import { renderWithProviders } from '@/test-utils';
 *
 * test('displays pool name', () => {
 *   renderWithProviders(<PoolCard pool={mockPool} />);
 *   expect(screen.getByText('my-pool')).toBeInTheDocument();
 * });
 * ```
 */
export function createWrapper(options: RenderWithProvidersOptions = {}) {
  const { config, services, queryClient } = options;

  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <TestProviders
        config={config}
        services={services}
        queryClient={queryClient}
      >
        {children}
      </TestProviders>
    );
  };
}

// Re-export for convenience
export { defaultConfig };
export type { AppConfig, Services };

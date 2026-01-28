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
 * Service Context
 *
 * Provides injectable cross-cutting services for UI components.
 * This enables dependency injection for browser APIs and utilities,
 * making components more testable and mockable.
 *
 * ## Why Use This?
 *
 * 1. **Testability** - Mock clipboard, announcer in tests without jsdom hacks
 * 2. **Abstraction** - Components don't directly depend on browser APIs
 * 3. **Consistency** - Single implementation of cross-cutting concerns
 *
 * ## Usage
 *
 * ```tsx
 * // Access services in any component
 * const { clipboard, announcer } = useServices();
 *
 * // Copy to clipboard
 * await clipboard.copy("text to copy");
 *
 * // Announce for screen readers
 * announcer.announce("Item deleted", "polite");
 * ```
 */

"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

// =============================================================================
// Types
// =============================================================================

export interface ClipboardService {
  /**
   * Copy text to clipboard.
   * @param text - Text to copy
   * @returns Promise resolving to true if successful
   */
  copy: (text: string) => Promise<boolean>;
}

export type AnnouncerPoliteness = "polite" | "assertive";

export interface AnnouncerService {
  /**
   * Announce a message to screen readers.
   * @param message - Message to announce
   * @param politeness - How urgently to announce (default: "polite")
   */
  announce: (message: string, politeness?: AnnouncerPoliteness) => void;
}

export interface Services {
  /** Clipboard operations */
  clipboard: ClipboardService;
  /** Screen reader announcements */
  announcer: AnnouncerService;
}

// =============================================================================
// Default Service Implementations
// =============================================================================

/**
 * Create real browser-based service implementations.
 */
function createBrowserServices(): Services {
  return {
    clipboard: {
      copy: async (text: string): Promise<boolean> => {
        try {
          await navigator.clipboard.writeText(text);
          return true;
        } catch {
          // Fallback for older browsers
          try {
            const textArea = document.createElement("textarea");
            textArea.value = text;
            textArea.style.position = "fixed";
            textArea.style.left = "-9999px";
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand("copy");
            document.body.removeChild(textArea);
            return true;
          } catch {
            return false;
          }
        }
      },
    },
    announcer: {
      announce: (message: string, politeness: AnnouncerPoliteness = "polite"): void => {
        // Find or create announcer element
        let announcer = document.getElementById("sr-announcer");
        if (!announcer) {
          announcer = document.createElement("div");
          announcer.id = "sr-announcer";
          announcer.setAttribute("aria-live", politeness);
          announcer.setAttribute("aria-atomic", "true");
          announcer.className = "sr-only";
          announcer.style.cssText =
            "position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;";
          document.body.appendChild(announcer);
        }

        // Update politeness if different
        if (announcer.getAttribute("aria-live") !== politeness) {
          announcer.setAttribute("aria-live", politeness);
        }

        // Clear and set message (triggers announcement)
        announcer.textContent = "";
        // Use RAF + microtask to ensure the clear happens before setting new content
        // This avoids setTimeout long task violations while preserving the necessary
        // delay for screen readers to detect the content change
        requestAnimationFrame(() => {
          queueMicrotask(() => {
            announcer!.textContent = message;
          });
        });
      },
    },
  };
}

// =============================================================================
// Context
// =============================================================================

export const ServiceContext = createContext<Services | null>(null);

/**
 * Access the services from context.
 *
 * @returns The Services object
 * @throws Error if used outside of ServiceProvider
 *
 * @example
 * ```tsx
 * function CopyButton({ text }: { text: string }) {
 *   const { clipboard, announcer } = useServices();
 *
 *   const handleCopy = async () => {
 *     const success = await clipboard.copy(text);
 *     if (success) {
 *       announcer.announce("Copied to clipboard");
 *     }
 *   };
 *
 *   return <button onClick={handleCopy}>Copy</button>;
 * }
 * ```
 */
export function useServices(): Services {
  const services = useContext(ServiceContext);
  if (!services) {
    throw new Error("useServices must be used within a ServiceProvider");
  }
  return services;
}

// =============================================================================
// Provider
// =============================================================================

export interface ServiceProviderProps {
  children: ReactNode;
  /** Override services (useful for testing) */
  services?: Partial<Services>;
}

/**
 * Service provider component.
 *
 * Wraps children with services context. Creates browser services
 * by default, but allows overrides for testing.
 */
export function ServiceProvider({ children, services: overrides }: ServiceProviderProps) {
  const services = useMemo(() => {
    const browserServices = createBrowserServices();
    return overrides
      ? {
          clipboard: overrides.clipboard ?? browserServices.clipboard,
          announcer: overrides.announcer ?? browserServices.announcer,
        }
      : browserServices;
  }, [overrides]);

  return <ServiceContext.Provider value={services}>{children}</ServiceContext.Provider>;
}

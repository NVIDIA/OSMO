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
 * useEventListener - Type-safe event listener hook with automatic cleanup
 *
 * Handles:
 * - Automatic cleanup on unmount
 * - Stable callback reference (always calls latest handler)
 * - Type-safe event types for Window, Document, and Elements
 * - Ref support for dynamic element targets
 *
 * @example
 * ```tsx
 * // Window event
 * useEventListener("resize", handleResize);
 *
 * // Element ref event
 * const buttonRef = useRef<HTMLButtonElement>(null);
 * useEventListener("click", handleClick, buttonRef);
 *
 * // Document event with options
 * useEventListener("keydown", handleKeyDown, { target: document, capture: true });
 * ```
 */

import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import { useIsomorphicLayoutEffect } from "./use-isomorphic-layout-effect";

// =============================================================================
// Types
// =============================================================================

interface UseEventListenerOptions {
  /** Whether to use capture phase */
  capture?: boolean;
  /** Whether the event should only fire once */
  once?: boolean;
  /** Whether the event listener is passive */
  passive?: boolean;
  /** Whether the listener is enabled (default: true) */
  enabled?: boolean;
}

// =============================================================================
// Overloads for type inference
// =============================================================================

/**
 * Window event listener
 */
export function useEventListener<K extends keyof WindowEventMap>(
  eventName: K,
  handler: (event: WindowEventMap[K]) => void,
  options?: UseEventListenerOptions,
): void;

/**
 * Document event listener
 */
export function useEventListener<K extends keyof DocumentEventMap>(
  eventName: K,
  handler: (event: DocumentEventMap[K]) => void,
  element: Document,
  options?: UseEventListenerOptions,
): void;

/**
 * Element ref event listener
 */
export function useEventListener<K extends keyof HTMLElementEventMap, T extends HTMLElement = HTMLElement>(
  eventName: K,
  handler: (event: HTMLElementEventMap[K]) => void,
  element: RefObject<T | null>,
  options?: UseEventListenerOptions,
): void;

// =============================================================================
// Implementation
// =============================================================================

export function useEventListener<K extends string>(
  eventName: K,
  handler: (event: Event) => void,
  element?: RefObject<HTMLElement | null> | Document | UseEventListenerOptions,
  options?: UseEventListenerOptions,
): void {
  // Determine target and options based on arguments
  const isElementRef = element && "current" in element;
  const isDocument = element === document;
  const actualOptions = isElementRef || isDocument ? options : (element as UseEventListenerOptions | undefined);
  const { capture = false, once = false, passive = false, enabled = true } = actualOptions ?? {};

  // Keep handler ref updated without re-subscribing
  const handlerRef = useRef(handler);
  useIsomorphicLayoutEffect(() => {
    handlerRef.current = handler;
  });

  useEffect(() => {
    if (!enabled) return;

    // Determine the target element
    let target: EventTarget | null = null;
    if (isElementRef) {
      target = (element as RefObject<HTMLElement | null>).current;
    } else if (isDocument) {
      target = document;
    } else {
      target = typeof window !== "undefined" ? window : null;
    }

    if (!target) return;

    // Stable event handler that calls the latest handler
    const eventListener = (event: Event) => handlerRef.current(event);

    const listenerOptions = { capture, once, passive };
    target.addEventListener(eventName, eventListener, listenerOptions);

    return () => {
      target.removeEventListener(eventName, eventListener, listenerOptions);
    };
  }, [eventName, element, capture, once, passive, enabled, isElementRef, isDocument]);
}

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
 * useCopyToClipboard - Hook for copying text to clipboard with feedback state.
 *
 * Provides a consistent copy-to-clipboard pattern across the app with:
 * - Copied state for UI feedback
 * - Automatic reset after delay
 * - Error handling with console warning
 *
 * @example
 * ```tsx
 * function CopyButton({ value }: { value: string }) {
 *   const { copied, copy } = useCopyToClipboard();
 *
 *   return (
 *     <button onClick={() => copy(value)}>
 *       {copied ? <Check /> : <Copy />}
 *     </button>
 *   );
 * }
 * ```
 */

import { useState, useCallback, useRef, useEffect } from "react";

export interface UseCopyToClipboardOptions {
  /** Delay in ms before resetting copied state (default: 2000) */
  resetDelay?: number;
  /** Callback when copy succeeds */
  onSuccess?: () => void;
  /** Callback when copy fails */
  onError?: (error: unknown) => void;
}

export interface UseCopyToClipboardReturn {
  /** Whether text was recently copied */
  copied: boolean;
  /** Copy text to clipboard */
  copy: (text: string) => Promise<void>;
  /** Reset copied state manually */
  reset: () => void;
}

/**
 * Hook for copying text to clipboard with automatic feedback state.
 *
 * @param options - Configuration options
 * @returns Object with copied state and copy function
 */
export function useCopyToClipboard(options: UseCopyToClipboardOptions = {}): UseCopyToClipboardReturn {
  const { resetDelay = 2000, onSuccess, onError } = options;
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const copy = useCallback(
    async (text: string) => {
      // Clear any existing timeout
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        onSuccess?.();

        // Auto-reset after delay
        timeoutRef.current = setTimeout(() => {
          setCopied(false);
        }, resetDelay);
      } catch (error) {
        console.warn("Clipboard API not available:", error);
        onError?.(error);
      }
    },
    [resetDelay, onSuccess, onError]
  );

  const reset = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    setCopied(false);
  }, []);

  return { copied, copy, reset };
}

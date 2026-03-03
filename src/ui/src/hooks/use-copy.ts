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
 * useCopy - Thin wrapper around usehooks-ts/useCopyToClipboard with auto-reset.
 *
 * Provides a consistent copy-to-clipboard pattern across the app with:
 * - Copied state for UI feedback
 * - Automatic reset after delay
 *
 * @example
 * ```tsx
 * function CopyButton({ value }: { value: string }) {
 *   const { copied, copy } = useCopy();
 *
 *   return (
 *     <button onClick={() => copy(value)}>
 *       {copied ? <Check /> : <Copy />}
 *     </button>
 *   );
 * }
 * ```
 */

import { useCallback, useRef, useState } from "react";
import { useCopyToClipboard, useUnmount } from "usehooks-ts";

export interface UseCopyOptions {
  /** Delay in ms before resetting copied state (default: 2000) */
  resetDelay?: number;
}

export interface UseCopyReturn {
  copied: boolean;
  copy: (text: string) => Promise<boolean>;
}

/**
 * Hook for copying text to clipboard with automatic feedback state.
 */
export function useCopy(options: UseCopyOptions = {}): UseCopyReturn {
  const { resetDelay = 2000 } = options;
  const [, copyToClipboard] = useCopyToClipboard();
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useUnmount(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
  });

  const copy = useCallback(
    async (text: string): Promise<boolean> => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      const success = await copyToClipboard(text);

      if (success) {
        setCopied(true);
        timeoutRef.current = setTimeout(() => {
          setCopied(false);
        }, resetDelay);
      }

      return success;
    },
    [copyToClipboard, resetDelay],
  );

  return {
    copied,
    copy,
  };
}

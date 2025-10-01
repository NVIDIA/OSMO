//SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

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
"use client";

import { useEffect, useRef, useCallback } from "react";

/**
 * useSafeTimeout centralizes timeout creation and cleanup.
 *
 * Returns a setSafeTimeout function that clears any previous timeout and sets a new one.
 * All timeouts are cleared automatically on unmount.
 */
export function useSafeTimeout() {
  const timeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);

  const setSafeTimeout = useCallback((callback: () => void, delay: number) => {
    // Clear existing timeout to avoid overlapping
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = setTimeout(callback, delay);
    return timeoutRef.current;
  }, []);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return { setSafeTimeout } as const;
}

export default useSafeTimeout;



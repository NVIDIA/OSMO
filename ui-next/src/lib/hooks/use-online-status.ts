//SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.

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

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

/**
 * Hook that provides online/offline status and automatically handles
 * network reconnection by refetching stale queries.
 *
 * Features:
 * - Tracks browser online/offline state
 * - Automatically refetches stale queries when back online
 * - Provides current online status for UI feedback
 *
 * @returns Object with isOnline status and wasOffline flag
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { isOnline, wasOffline } = useOnlineStatus();
 *
 *   if (!isOnline) {
 *     return <Banner>You are currently offline</Banner>;
 *   }
 *
 *   if (wasOffline) {
 *     return <Banner>Reconnected! Refreshing data...</Banner>;
 *   }
 *
 *   return <div>Normal content</div>;
 * }
 * ```
 */
export function useOnlineStatus() {
  const queryClient = useQueryClient();
  const [isOnline, setIsOnline] = useState(typeof navigator !== "undefined" ? navigator.onLine : true);
  const [wasOffline, setWasOffline] = useState(false);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      setWasOffline(true);

      // Refetch all stale queries when back online
      // This ensures users see fresh data after reconnection
      queryClient.refetchQueries({ stale: true });

      // Clear "was offline" flag after a delay (for UI feedback)
      setTimeout(() => setWasOffline(false), 3000);
    };

    const handleOffline = () => {
      setIsOnline(false);
      setWasOffline(false);
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [queryClient]);

  return { isOnline, wasOffline };
}

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

"use client";

import { useRouter, usePathname } from "next/navigation";
import { startProgressIfNavigating } from "@/lib/navigation-progress";

/**
 * Drop-in replacement for `useRouter()` that automatically triggers the
 * navigation progress bar on `push` and `replace` calls.
 *
 * ```ts
 * const router = useNavigationRouter();
 * router.push("/workflows/detail");
 * ```
 */
export function useNavigationRouter() {
  const router = useRouter();
  const currentPathname = usePathname();

  const push: typeof router.push = (...args) => {
    startProgressIfNavigating(args[0] as string, currentPathname);
    router.push(...args);
  };

  const replace: typeof router.replace = (...args) => {
    startProgressIfNavigating(args[0] as string, currentPathname);
    router.replace(...args);
  };

  return {
    ...router,
    push,
    replace,
  };
}

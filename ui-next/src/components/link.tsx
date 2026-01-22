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

import NextLink from "next/link";
import type { ComponentProps } from "react";

/**
 * Custom Link wrapper that disables prefetching by default.
 *
 * Prefetching is opt-in: use `prefetch={true}` to enable it explicitly.
 *
 * @example
 * // Default: No prefetch
 * <Link href="/workflows">Workflows</Link>
 *
 * @example
 * // Opt-in: Explicit prefetch
 * <Link href="/dashboard" prefetch={true}>Dashboard</Link>
 */
export function Link({ prefetch = false, ...props }: ComponentProps<typeof NextLink>) {
  return (
    <NextLink
      prefetch={prefetch}
      {...props}
    />
  );
}

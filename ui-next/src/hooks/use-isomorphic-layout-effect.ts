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
 * useIsomorphicLayoutEffect - SSR-safe useLayoutEffect
 *
 * In server-side rendering environments, useLayoutEffect triggers a warning
 * because it can't run during SSR. This hook safely falls back to useEffect
 * on the server while using useLayoutEffect on the client.
 *
 * Use this when you need synchronous DOM measurements or mutations that
 * must happen before the browser paints, but your code also needs to
 * work in SSR environments (like Next.js).
 *
 * @example
 * ```tsx
 * // Instead of this (causes SSR warnings):
 * useLayoutEffect(() => {
 *   const height = element.offsetHeight;
 *   setHeight(height);
 * }, []);
 *
 * // Use this:
 * useIsomorphicLayoutEffect(() => {
 *   const height = element.offsetHeight;
 *   setHeight(height);
 * }, []);
 * ```
 */

import { useEffect, useLayoutEffect } from "react";

/**
 * useLayoutEffect that safely falls back to useEffect in SSR environments.
 *
 * This prevents the "useLayoutEffect does nothing on the server" warning
 * while still using useLayoutEffect's synchronous timing on the client.
 */
export const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

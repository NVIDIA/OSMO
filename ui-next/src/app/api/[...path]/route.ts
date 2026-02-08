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

/**
 * Dynamic API Proxy Route Handler (Thin Wrapper)
 *
 * This is a thin re-export wrapper that allows Turbopack aliasing to work.
 * The actual implementation is in route.impl.ts (aliased based on NODE_ENV).
 *
 * Production builds alias: route.impl.ts → route.impl.production.ts (zero mock code)
 * Development builds use: route.impl.ts directly (with mock support)
 *
 * IMPORTANT: We use @/ absolute import here so Turbopack resolveAlias can match it.
 */

export * from "@/app/api/[...path]/route.impl";

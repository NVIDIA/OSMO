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

import { Suspense } from "react";
import { AuthSuccessContent } from "./auth-success-content";

/**
 * Auth success page - stores tokens and redirects to the original page.
 *
 * PPR Compatibility:
 * - This page uses searchParams (runtime data) which requires Suspense
 * - The loading UI is shown during prerender, content streams in at request time
 */
export default function AuthSuccessPage() {
  return (
    <Suspense fallback={<AuthSuccessLoading />}>
      <AuthSuccessContent />
    </Suspense>
  );
}

function AuthSuccessLoading() {
  return (
    <div className="flex h-screen items-center justify-center bg-zinc-950">
      <p className="text-zinc-500">Logging you in...</p>
    </div>
  );
}

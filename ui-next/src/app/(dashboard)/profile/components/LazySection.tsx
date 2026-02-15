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

import { Loader2 } from "lucide-react";

interface LazySectionProps {
  children: React.ReactNode;
  hasIntersected: boolean;
  isLoading?: boolean;
}

/**
 * Renders a placeholder until the parent section scrolls into view,
 * then shows a loading spinner until data arrives.
 *
 * The parent section owns the IntersectionObserver and passes `hasIntersected`.
 */
export function LazySection({ children, hasIntersected, isLoading }: LazySectionProps) {
  if (!hasIntersected) {
    return (
      <div className="bg-muted/20 flex h-48 items-center justify-center rounded-lg border border-dashed">
        <p className="text-muted-foreground text-sm">Loading when visible...</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="bg-muted/10 flex h-48 items-center justify-center rounded-lg border">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="text-muted-foreground size-6 animate-spin" />
          <p className="text-muted-foreground text-sm">Loading...</p>
        </div>
      </div>
    );
  }

  return children;
}

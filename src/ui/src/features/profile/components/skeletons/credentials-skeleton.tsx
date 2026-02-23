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

import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/shadcn/card";
import { Skeleton } from "@/components/shadcn/skeleton";

interface CredentialsSkeletonProps {
  /** Number of credential items per group. Defaults to 2. */
  itemsPerGroup?: number;
}

export function CredentialsSkeleton({ itemsPerGroup = 2 }: CredentialsSkeletonProps) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading credentials"
    >
      <Card data-variant="sectioned">
        {/* Header: icon + title + count badge + description */}
        <CardHeader className="border-b">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Skeleton className="size-5 rounded" />
            <Skeleton className="h-5 w-24" />
            <Skeleton className="ml-1 h-5 w-16 rounded-full" />
          </CardTitle>
          <CardDescription>
            <Skeleton className="h-4 w-full max-w-lg" />
          </CardDescription>
        </CardHeader>

        <CardContent>
          {/* "Add new credential" button skeleton (dashed border) */}
          <div className="mb-6">
            <div className="border-border flex w-full items-center justify-center gap-2 rounded-md border border-dashed py-3">
              <Skeleton className="size-4 rounded" />
              <Skeleton className="h-4 w-28" />
            </div>
          </div>

          {/* Credential group: one group with configurable items */}
          <div className="space-y-8">
            <div>
              {/* Group heading: icon + title */}
              <div className="mb-3 flex items-center gap-2">
                <Skeleton className="size-4 rounded" />
                <Skeleton className="h-4 w-16" />
              </div>

              {/* Credential items */}
              <div className="space-y-2">
                {Array.from({ length: itemsPerGroup }).map((_, i) => (
                  <div
                    key={i}
                    className="overflow-hidden rounded-md border"
                  >
                    <div className="flex w-full items-center justify-between px-4 py-3">
                      <div className="flex flex-col gap-1">
                        <Skeleton className="h-4 w-36" />
                        {/* First item shows profile subtitle */}
                        {i === 0 && <Skeleton className="h-3 w-24" />}
                      </div>
                      {/* Delete button placeholder */}
                      <Skeleton className="size-7 rounded-md" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

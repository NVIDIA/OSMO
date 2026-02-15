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

import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/shadcn/card";
import { Skeleton } from "@/components/shadcn/skeleton";

export function NotificationsSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading notification preferences"
    >
      <Card data-variant="sectioned">
        {/* Header: icon + title */}
        <CardHeader className="gap-0 border-b">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Skeleton className="size-5 rounded" />
            <Skeleton className="h-5 w-28" />
          </CardTitle>
        </CardHeader>

        {/* Content: two switch rows */}
        <CardContent>
          <div className="space-y-0">
            {/* Email row */}
            <div className="border-border flex items-center justify-between border-b py-3">
              <div className="flex flex-col gap-1">
                <Skeleton className="h-4 w-36" />
                <Skeleton className="h-3 w-64" />
              </div>
              <Skeleton className="h-5 w-9 rounded-full" />
            </div>

            {/* Slack row */}
            <div className="flex items-center justify-between py-3">
              <div className="flex flex-col gap-1">
                <Skeleton className="h-4 w-36" />
                <Skeleton className="h-3 w-64" />
              </div>
              <Skeleton className="h-5 w-9 rounded-full" />
            </div>
          </div>
        </CardContent>

        {/* Footer: Reset + Save buttons */}
        <CardFooter className="border-t">
          <div className="flex w-full items-center justify-end gap-3">
            <Skeleton className="h-9 w-16 rounded-md" />
            <Skeleton className="h-9 w-14 rounded-md" />
          </div>
        </CardFooter>
      </Card>
    </div>
  );
}

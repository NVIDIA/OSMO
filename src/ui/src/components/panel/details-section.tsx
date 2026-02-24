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

import { memo, Fragment } from "react";
import { Card, CardContent } from "@/components/shadcn/card";
import { CopyButton } from "@/components/copyable-value";
import { cn } from "@/lib/utils";

export interface DetailsItem {
  label: string;
  value: React.ReactNode;
  show?: boolean;
  copyable?: boolean;
  copyValue?: string;
  mono?: boolean;
  truncate?: boolean;
}

export interface DetailsSectionProps {
  title: string;
  items: DetailsItem[];
  className?: string;
  headerClassName?: string;
}

export const DetailsSection = memo(function DetailsSection({
  title,
  items,
  className,
  headerClassName,
}: DetailsSectionProps) {
  // Filter to only visible items
  const visibleItems = items.filter((item) => item.show !== false && item.value !== null && item.value !== undefined);

  if (visibleItems.length === 0) {
    return null;
  }

  return (
    <section className={className}>
      <h3 className={cn("text-muted-foreground mb-2 text-xs font-semibold tracking-wider uppercase", headerClassName)}>
        {title}
      </h3>
      <Card className="gap-0 overflow-hidden py-0">
        <CardContent className="min-w-0 p-3">
          <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-8 gap-y-2 text-sm">
            {visibleItems.map((item) => {
              const stringValue =
                typeof item.value === "string" ? item.value : (item.copyValue ?? String(item.value ?? ""));

              return (
                <Fragment key={item.label}>
                  <span className="text-muted-foreground whitespace-nowrap">{item.label}</span>
                  <span className="flex min-w-0 items-center">
                    <span
                      className={cn("min-w-0", item.truncate && "truncate", item.mono && "font-mono text-xs")}
                      title={item.truncate ? stringValue : undefined}
                    >
                      {item.value}
                    </span>
                    {item.copyable && (
                      <CopyButton
                        value={stringValue}
                        label={item.label}
                      />
                    )}
                  </span>
                </Fragment>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </section>
  );
});

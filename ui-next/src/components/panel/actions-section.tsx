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

import { memo } from "react";
import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/shadcn/card";
import { cn } from "@/lib/utils";

export interface ActionItem {
  id: string;
  label: string;
  description?: string;
  onClick: () => void;
  icon: LucideIcon;
  variant?: "default" | "destructive";
  disabled?: boolean;
}

export interface ActionsSectionProps {
  title: string;
  actions: ActionItem[];
  className?: string;
  headerClassName?: string;
}

export const ActionsSection = memo(function ActionsSection({
  title,
  actions,
  className,
  headerClassName,
}: ActionsSectionProps) {
  if (actions.length === 0) {
    return null;
  }

  return (
    <section className={className}>
      <h3 className={cn("text-muted-foreground mb-2 text-xs font-semibold tracking-wider uppercase", headerClassName)}>
        {title}
      </h3>
      <Card className="gap-0 overflow-hidden py-0">
        <CardContent className="divide-border divide-y p-0">
          {actions.map((action) => {
            const Icon = action.icon;
            const isDestructive = action.variant === "destructive";
            const isDisabled = action.disabled ?? false;
            return (
              <button
                key={action.id}
                type="button"
                onClick={action.onClick}
                disabled={isDisabled}
                className={cn(
                  "flex w-full items-center gap-3 p-3 text-left transition-colors",
                  isDisabled && "cursor-not-allowed opacity-50",
                  !isDisabled && (isDestructive ? "hover:bg-red-50 dark:hover:bg-red-950/30" : "hover:bg-muted/50"),
                )}
              >
                <Icon
                  className={cn(
                    "size-4 shrink-0",
                    isDestructive ? "text-red-600 dark:text-red-400" : "text-muted-foreground",
                  )}
                />
                <div className="min-w-0 flex-1">
                  <div className={cn("text-sm font-medium", isDestructive && "text-red-600 dark:text-red-400")}>
                    {action.label}
                  </div>
                  {action.description && <div className="text-muted-foreground text-xs">{action.description}</div>}
                </div>
              </button>
            );
          })}
        </CardContent>
      </Card>
    </section>
  );
});

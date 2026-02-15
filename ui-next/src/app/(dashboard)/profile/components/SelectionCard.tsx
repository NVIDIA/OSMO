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

import { useState, useMemo, useCallback } from "react";
import { toast } from "sonner";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/shadcn/card";
import { Badge } from "@/components/shadcn/badge";
import { Button } from "@/components/shadcn/button";
import { cn } from "@/lib/utils";
import { SelectableList, type SelectableListItem } from "@/app/(dashboard)/profile/components/SelectableList";
import type { ProfileUpdate } from "@/lib/api/adapter/types";
import type { AnnouncerService } from "@/contexts/service-context";

interface SelectionCardProps {
  icon: React.ElementType;
  title: string;
  description: string;
  currentDefault: string;
  accessible: string[];
  updateProfile: (data: ProfileUpdate) => Promise<unknown>;
  isUpdating: boolean;
  announcer: AnnouncerService;
  buildUpdate: (value: string) => ProfileUpdate;
  buildItem?: (value: string) => SelectableListItem;
  searchPlaceholder?: string;
  emptyMessage?: string;
  entityLabel: string;
}

export function SelectionCard({
  icon: Icon,
  title,
  description,
  currentDefault,
  accessible,
  updateProfile,
  isUpdating,
  announcer,
  buildUpdate,
  buildItem,
  searchPlaceholder = "Search...",
  emptyMessage = "No items found",
  entityLabel,
}: SelectionCardProps) {
  const [editedValue, setEditedValue] = useState<string | null>(null);

  const stagedValue = editedValue ?? currentDefault;
  const isDirty = stagedValue !== currentDefault;

  const handleReset = useCallback(() => {
    setEditedValue(null);
  }, []);

  const handleSave = useCallback(async () => {
    if (!isDirty) return;

    try {
      await updateProfile(buildUpdate(stagedValue));
      setEditedValue(null);
      toast.success(`Default ${entityLabel} saved successfully`);
      announcer.announce(`Default ${entityLabel} saved successfully`, "polite");
    } catch (error) {
      const message = error instanceof Error ? error.message : `Failed to save default ${entityLabel}`;
      toast.error(message);
      announcer.announce(`Error: ${message}`, "assertive");
    }
  }, [stagedValue, isDirty, updateProfile, announcer, buildUpdate, entityLabel]);

  const items: SelectableListItem[] = useMemo(() => {
    if (!accessible.length) return [];

    const defaultBuildItem = (value: string): SelectableListItem => ({
      value,
      label: value,
    });
    const itemBuilder = buildItem ?? defaultBuildItem;
    const mapped = accessible.map(itemBuilder);

    const defaultItem = mapped.find((item) => item.value === currentDefault);
    const otherItems = mapped
      .filter((item) => item.value !== currentDefault)
      .sort((a, b) => a.value.localeCompare(b.value));

    return defaultItem ? [defaultItem, ...otherItems] : mapped;
  }, [accessible, currentDefault, buildItem]);

  return (
    <Card
      data-variant="sectioned"
      className={cn("flex flex-col", isDirty && "border-nvidia")}
      style={{ height: "var(--profile-selection-card-height)" }}
    >
      <CardHeader className="shrink-0 border-b">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Icon className="size-5" />
          {title}
          <Badge
            variant="secondary"
            className="badge-nvidia-count"
          >
            {accessible.length} accessible
          </Badge>
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex-1 overflow-hidden">
        <SelectableList
          items={items}
          selectedValue={stagedValue}
          onSelect={setEditedValue}
          searchPlaceholder={searchPlaceholder}
          emptyMessage={emptyMessage}
        />
      </CardContent>
      <CardFooter className="shrink-0 border-t">
        <div className="flex w-full items-center justify-end gap-3">
          <Button
            variant="secondary"
            onClick={handleReset}
            disabled={!isDirty || isUpdating}
          >
            Reset
          </Button>
          <Button
            className="btn-nvidia"
            onClick={handleSave}
            disabled={!isDirty || isUpdating}
          >
            Save
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
}

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

import { useState, useMemo, useCallback } from "react";
import { toast } from "sonner";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/shadcn/card";
import { Badge } from "@/components/shadcn/badge";
import { Button } from "@/components/shadcn/button";
import { Server } from "lucide-react";
import { cn } from "@/lib/utils";
import type { UserProfile, ProfileUpdate } from "@/lib/api/adapter";
import type { AnnouncerService } from "@/contexts";
import { SelectableList, type SelectableListItem } from "./SelectableList";

// Pool edits - stores only the user's pool change
interface PoolEdits {
  pool?: string;
}

interface PoolsCardProps {
  profile: UserProfile;
  updateProfile: (data: ProfileUpdate) => Promise<void>;
  isUpdating: boolean;
  announcer: AnnouncerService;
}

export function PoolsCard({ profile, updateProfile, isUpdating, announcer }: PoolsCardProps) {
  // Store only the user's edits (delta from profile)
  const [poolEdits, setPoolEdits] = useState<PoolEdits>({});

  // Track initial default for stable sorting (only sort once on mount)
  const [initialDefault] = useState(profile.pool.default);

  // Compute effective staged pool: profile value with edits applied
  const stagedPool = useMemo(() => {
    return poolEdits.pool ?? profile.pool.default;
  }, [profile, poolEdits]);

  // Compute if pool is dirty (edit exists and differs from profile)
  const poolDirty = useMemo(() => {
    return stagedPool !== profile.pool.default;
  }, [profile, stagedPool]);

  // Handler to update pool edit
  const handlePoolChange = useCallback((value: string) => {
    setPoolEdits({ pool: value });
  }, []);

  // Reset pool - clear edits to revert to profile value
  const handlePoolReset = useCallback(() => {
    setPoolEdits({});
  }, []);

  // Save pool - commits staged value via mutation
  const handlePoolSave = useCallback(async () => {
    if (!poolDirty) return;

    try {
      await updateProfile({
        pool: { default: stagedPool },
      });
      // Don't clear edits - profile will refetch and poolDirty will become false automatically
      // This prevents flashing during the refetch
      toast.success("Default pool saved successfully");
      announcer.announce("Default pool saved successfully", "polite");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save default pool";
      toast.error(message);
      announcer.announce(`Error: ${message}`, "assertive");
    }
  }, [stagedPool, poolDirty, updateProfile, announcer]);

  // Convert accessible pools to SelectableListItem format
  // Show initial default first, then others in alphabetical order
  // Only sort once on mount - don't re-sort when default changes
  const poolItems: SelectableListItem[] = useMemo(() => {
    if (!profile.pool.accessible) return [];

    const items = profile.pool.accessible.map((pool) => ({
      value: pool,
      label: pool,
    }));

    // Sort: initial default first, then rest alphabetically
    const defaultItem = items.find((item) => item.value === initialDefault);
    const otherItems = items
      .filter((item) => item.value !== initialDefault)
      .sort((a, b) => a.value.localeCompare(b.value));

    return defaultItem ? [defaultItem, ...otherItems] : items;
  }, [profile.pool.accessible, initialDefault]);

  return (
    <Card className={cn("flex h-[600px] flex-col", poolDirty && "border-nvidia")}>
      <CardHeader className="shrink-0 border-b">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Server className="size-5" />
          Pools
          <Badge
            variant="secondary"
            className="bg-nvidia-bg text-nvidia-dark ml-1 text-xs"
          >
            {profile.pool.accessible?.length ?? 0} accessible
          </Badge>
        </CardTitle>
        <CardDescription>Select your default compute pool for workflow execution.</CardDescription>
      </CardHeader>
      <CardContent className="flex-1 overflow-hidden">
        <SelectableList
          items={poolItems}
          selectedValue={stagedPool}
          onSelect={handlePoolChange}
          searchPlaceholder="Search pools..."
          emptyMessage="No accessible pools"
        />
      </CardContent>
      <CardFooter className="shrink-0 border-t">
        <div className="flex w-full items-center justify-end gap-3">
          <Button
            variant="secondary"
            onClick={handlePoolReset}
            disabled={!poolDirty || isUpdating}
          >
            Reset
          </Button>
          <Button
            className="bg-nvidia hover:bg-nvidia-dark disabled:opacity-50"
            onClick={handlePoolSave}
            disabled={!poolDirty || isUpdating}
          >
            Save
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
}

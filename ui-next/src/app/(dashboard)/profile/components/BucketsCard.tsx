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
import { FolderOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import type { UserProfile, ProfileUpdate } from "@/lib/api/adapter";
import type { AnnouncerService } from "@/contexts";
import { SelectableList, type SelectableListItem } from "./SelectableList";

// Bucket edits - stores only the user's bucket change
interface BucketEdits {
  bucket?: string;
}

interface BucketsCardProps {
  profile: UserProfile;
  updateProfile: (data: ProfileUpdate) => Promise<void>;
  isUpdating: boolean;
  announcer: AnnouncerService;
}

export function BucketsCard({ profile, updateProfile, isUpdating, announcer }: BucketsCardProps) {
  // Store only the user's edits (delta from profile)
  const [bucketEdits, setBucketEdits] = useState<BucketEdits>({});

  // Track initial default for stable sorting (only sort once on mount)
  const [initialDefault] = useState(profile.bucket.default);

  // Compute effective staged bucket: profile value with edits applied
  const stagedBucket = useMemo(() => {
    return bucketEdits.bucket ?? profile.bucket.default;
  }, [profile, bucketEdits]);

  // Compute if bucket is dirty (edit exists and differs from profile)
  const bucketDirty = useMemo(() => {
    return stagedBucket !== profile.bucket.default;
  }, [profile, stagedBucket]);

  // Handler to update bucket edit
  const handleBucketChange = useCallback((value: string) => {
    setBucketEdits({ bucket: value });
  }, []);

  // Reset bucket - clear edits to revert to profile value
  const handleBucketReset = useCallback(() => {
    setBucketEdits({});
  }, []);

  // Save bucket - commits staged value via mutation
  const handleBucketSave = useCallback(async () => {
    if (!bucketDirty) return;

    try {
      await updateProfile({
        bucket: { default: stagedBucket },
      });
      // Don't clear edits - profile will refetch and bucketDirty will become false automatically
      // This prevents flashing during the refetch
      toast.success("Default bucket saved successfully");
      announcer.announce("Default bucket saved successfully", "polite");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save default bucket";
      toast.error(message);
      announcer.announce(`Error: ${message}`, "assertive");
    }
  }, [stagedBucket, bucketDirty, updateProfile, announcer]);

  // Convert accessible buckets to SelectableListItem format
  // Show initial default first, then others in alphabetical order
  // Only sort once on mount - don't re-sort when default changes
  const bucketItems: SelectableListItem[] = useMemo(() => {
    if (!profile.bucket.accessible) return [];

    const items = profile.bucket.accessible.map((bucket) => ({
      value: bucket,
      label: bucket,
      subtitle: `s3://${bucket}`,
    }));

    // Sort: initial default first, then rest alphabetically
    const defaultItem = items.find((item) => item.value === initialDefault);
    const otherItems = items
      .filter((item) => item.value !== initialDefault)
      .sort((a, b) => a.value.localeCompare(b.value));

    return defaultItem ? [defaultItem, ...otherItems] : items;
  }, [profile.bucket.accessible, initialDefault]);

  return (
    <Card className={cn("flex h-[600px] flex-col", bucketDirty && "border-nvidia")}>
      <CardHeader className="shrink-0 border-b">
        <CardTitle className="flex items-center gap-2 text-lg">
          <FolderOpen className="size-5" />
          Data Buckets
          <Badge
            variant="secondary"
            className="bg-nvidia-bg text-nvidia-dark ml-1 text-xs"
          >
            {profile.bucket.accessible?.length ?? 0} accessible
          </Badge>
        </CardTitle>
        <CardDescription>Select the default S3/GCS/Azure bucket for dataset storage.</CardDescription>
      </CardHeader>
      <CardContent className="flex-1 overflow-hidden">
        <SelectableList
          items={bucketItems}
          selectedValue={stagedBucket}
          onSelect={handleBucketChange}
          searchPlaceholder="Search buckets..."
          emptyMessage="No accessible buckets"
        />
      </CardContent>
      <CardFooter className="shrink-0 border-t">
        <div className="flex w-full items-center justify-end gap-3">
          <Button
            variant="secondary"
            onClick={handleBucketReset}
            disabled={!bucketDirty || isUpdating}
          >
            Reset
          </Button>
          <Button
            className="bg-nvidia hover:bg-nvidia-dark disabled:opacity-50"
            onClick={handleBucketSave}
            disabled={!bucketDirty || isUpdating}
          >
            Save
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
}

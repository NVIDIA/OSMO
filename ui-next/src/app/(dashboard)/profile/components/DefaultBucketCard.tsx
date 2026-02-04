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
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/shadcn/card";
import { Button } from "@/components/shadcn/button";
import { FolderOpen, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { UserProfile, ProfileUpdate } from "@/lib/api/adapter";
import type { AnnouncerService } from "@/contexts";
import { SelectableList, type SelectableListItem } from "./SelectableList";

// Bucket edits - stores only the user's bucket change
interface BucketEdits {
  bucket?: string;
}

interface DefaultBucketCardProps {
  profile: UserProfile;
  updateProfile: (data: ProfileUpdate) => Promise<void>;
  isUpdating: boolean;
  announcer: AnnouncerService;
}

export function DefaultBucketCard({ profile, updateProfile, isUpdating, announcer }: DefaultBucketCardProps) {
  // Store only the user's edits (delta from profile)
  const [bucketEdits, setBucketEdits] = useState<BucketEdits>({});

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
      // Clear edits after successful save - profile will refetch with new values
      setBucketEdits({});
      announcer.announce("Default bucket saved successfully", "polite");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save default bucket";
      announcer.announce(`Error: ${message}`, "assertive");
    }
  }, [stagedBucket, bucketDirty, updateProfile, announcer]);

  // Convert accessible buckets to SelectableListItem format
  const bucketItems: SelectableListItem[] = useMemo(() => {
    if (!profile.bucket.accessible) return [];
    return profile.bucket.accessible.map((bucket) => ({
      value: bucket,
      label: bucket,
      subtitle: `s3://${bucket}`,
    }));
  }, [profile.bucket.accessible]);

  return (
    <Card className={cn(bucketDirty && "border-nvidia")}>
      <CardHeader className="border-b">
        <CardTitle className="flex items-center gap-2 text-lg">
          <FolderOpen className="size-5" />
          Default Data Bucket
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground mb-4 text-sm">
          Select the default S3/GCS/Azure bucket for dataset storage.
        </p>
        <SelectableList
          items={bucketItems}
          selectedValue={stagedBucket}
          onSelect={handleBucketChange}
          searchPlaceholder="Search buckets..."
          emptyMessage="No accessible buckets"
        />
      </CardContent>
      <CardFooter className="border-t">
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
            {isUpdating ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                Saving...
              </>
            ) : (
              "Save"
            )}
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
}

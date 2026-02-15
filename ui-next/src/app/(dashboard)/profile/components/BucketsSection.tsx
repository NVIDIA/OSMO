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

import { useCallback, useMemo } from "react";
import { FolderOpen } from "lucide-react";
import { useIntersectionObserver } from "@/hooks/use-intersection-observer";
import { useProfile, useBuckets, useUpdateProfile } from "@/lib/api/adapter/hooks";
import { useServices } from "@/contexts/service-context";
import { SelectionCard } from "@/app/(dashboard)/profile/components/SelectionCard";
import { LazySection } from "@/app/(dashboard)/profile/components/LazySection";
import type { SelectableListItem } from "@/app/(dashboard)/profile/components/SelectableList";
import type { ProfileUpdate } from "@/lib/api/adapter/types";

export function BucketsSection() {
  const [ref, , hasIntersected] = useIntersectionObserver<HTMLElement>({
    threshold: 0.1,
    rootMargin: "200px",
    triggerOnce: true,
  });

  const { profile, isLoading: profileLoading } = useProfile({ enabled: hasIntersected });
  const { buckets, isLoading: bucketsLoading } = useBuckets({ enabled: hasIntersected });
  const { mutateAsync: updateProfile, isPending: isUpdatingProfile } = useUpdateProfile();
  const { announcer } = useServices();

  // Create bucket lookup map for efficient access to bucket metadata
  const bucketMap = useMemo(() => {
    const map = new Map<string, { path: string; description: string }>();
    for (const bucket of buckets) {
      map.set(bucket.name, { path: bucket.path, description: bucket.description });
    }
    return map;
  }, [buckets]);

  // Merge bucket names into profile
  const fullProfile = useMemo(() => {
    if (!profile) return null;
    return {
      ...profile,
      bucket: {
        ...profile.bucket,
        accessible: buckets.map((b) => b.name),
      },
    };
  }, [profile, buckets]);

  const buildUpdate = useCallback((value: string): ProfileUpdate => ({ bucket: { default: value } }), []);

  const buildItem = useCallback(
    (value: string): SelectableListItem => {
      const bucketInfo = bucketMap.get(value);
      return {
        value,
        label: value,
        subtitle: bucketInfo?.path ?? `s3://${value}`, // Use actual path from API, fallback to s3://
      };
    },
    [bucketMap],
  );

  const isLoading = profileLoading || bucketsLoading;

  return (
    <section
      ref={ref}
      id="buckets"
      className="profile-scroll-offset"
    >
      <LazySection
        hasIntersected={hasIntersected}
        isLoading={isLoading}
      >
        {fullProfile && (
          <SelectionCard
            icon={FolderOpen}
            title="Data Buckets"
            description="Select the default bucket for dataset storage."
            currentDefault={fullProfile.bucket.default}
            accessible={fullProfile.bucket.accessible}
            updateProfile={updateProfile}
            isUpdating={isUpdatingProfile}
            announcer={announcer}
            buildUpdate={buildUpdate}
            buildItem={buildItem}
            searchPlaceholder="Search buckets..."
            emptyMessage="No accessible buckets"
            entityLabel="bucket"
          />
        )}
      </LazySection>
    </section>
  );
}

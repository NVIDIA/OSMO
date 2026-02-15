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

import { useCallback } from "react";
import { Server } from "lucide-react";
import { useIntersectionObserver } from "@/hooks/use-intersection-observer";
import { useProfile, useUpdateProfile } from "@/lib/api/adapter/hooks";
import { useServices } from "@/contexts/service-context";
import { SelectionCard } from "@/app/(dashboard)/profile/components/SelectionCard";
import { LazySection } from "@/app/(dashboard)/profile/components/LazySection";
import type { ProfileUpdate } from "@/lib/api/adapter/types";

export function PoolsSection() {
  const [ref, , hasIntersected] = useIntersectionObserver<HTMLElement>({
    threshold: 0.1,
    rootMargin: "200px",
    triggerOnce: true,
  });

  const { profile, isLoading } = useProfile({ enabled: hasIntersected });
  const { mutateAsync: updateProfile, isPending: isUpdatingProfile } = useUpdateProfile();
  const { announcer } = useServices();

  const buildUpdate = useCallback((value: string): ProfileUpdate => ({ pool: { default: value } }), []);

  return (
    <section
      ref={ref}
      id="pools"
      className="profile-scroll-offset"
    >
      <LazySection
        hasIntersected={hasIntersected}
        isLoading={isLoading}
      >
        {profile && (
          <SelectionCard
            icon={Server}
            title="Pools"
            description="Select your default compute pool for workflow execution."
            currentDefault={profile.pool.default}
            accessible={profile.pool.accessible}
            updateProfile={updateProfile}
            isUpdating={isUpdatingProfile}
            announcer={announcer}
            buildUpdate={buildUpdate}
            searchPlaceholder="Search pools..."
            emptyMessage="No accessible pools"
            entityLabel="pool"
          />
        )}
      </LazySection>
    </section>
  );
}

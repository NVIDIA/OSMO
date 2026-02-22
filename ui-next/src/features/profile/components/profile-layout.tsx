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

import { Suspense } from "react";
import { InlineErrorBoundary } from "@/components/error/inline-error-boundary";
import { ProfilePageTitle } from "@/features/profile/components/profile-page-title";
import { ProfileNavigation } from "@/features/profile/components/profile-navigation";
import { UserInfoSection } from "@/features/profile/components/user-info-section";
import { NotificationsSection } from "@/features/profile/components/notifications-section";
import { BucketsSection } from "@/features/profile/components/buckets-section";
import { PoolsSection } from "@/features/profile/components/pools-section";
import { CredentialsSection } from "@/features/profile/components/credentials-section";
import { NotificationsSkeleton } from "@/features/profile/components/skeletons/notifications-skeleton";
import { SelectionSkeleton } from "@/features/profile/components/skeletons/selection-skeleton";
import { CredentialsSkeleton } from "@/features/profile/components/skeletons/credentials-skeleton";

export function ProfileLayout() {
  return (
    <>
      <ProfilePageTitle />
      <div className="mx-auto flex max-w-[1400px] gap-6 p-8">
        <ProfileNavigation />

        <main className="min-w-0 flex-1">
          <div className="space-y-8">
            <InlineErrorBoundary title="Unable to load user info">
              <UserInfoSection />
            </InlineErrorBoundary>

            <InlineErrorBoundary title="Unable to load notifications">
              <Suspense fallback={<NotificationsSkeleton />}>
                <NotificationsSection />
              </Suspense>
            </InlineErrorBoundary>

            <InlineErrorBoundary title="Unable to load pools">
              <Suspense fallback={<SelectionSkeleton />}>
                <PoolsSection />
              </Suspense>
            </InlineErrorBoundary>

            <InlineErrorBoundary title="Unable to load buckets">
              <Suspense fallback={<SelectionSkeleton />}>
                <BucketsSection />
              </Suspense>
            </InlineErrorBoundary>

            <InlineErrorBoundary title="Unable to load credentials">
              <Suspense fallback={<CredentialsSkeleton />}>
                <CredentialsSection />
              </Suspense>
            </InlineErrorBoundary>
          </div>
        </main>
      </div>
    </>
  );
}

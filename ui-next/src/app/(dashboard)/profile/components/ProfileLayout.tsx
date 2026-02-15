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

"use client";

import { usePage } from "@/components/chrome/page-context";
import { ProfileNavigation } from "@/app/(dashboard)/profile/components/ProfileNavigation";
import { UserInfoSection } from "@/app/(dashboard)/profile/components/UserInfoSection";
import { NotificationsSection } from "@/app/(dashboard)/profile/components/NotificationsSection";
import { BucketsSection } from "@/app/(dashboard)/profile/components/BucketsSection";
import { PoolsSection } from "@/app/(dashboard)/profile/components/PoolsSection";
import { CredentialsSection } from "@/app/(dashboard)/profile/components/CredentialsSection";

export function ProfileLayout() {
  usePage({ title: "Profile Settings" });

  return (
    <div className="mx-auto flex max-w-[1400px] gap-6 p-8">
      <ProfileNavigation />

      <main className="min-w-0 flex-1">
        <div className="space-y-8">
          <UserInfoSection />
          <NotificationsSection />
          <PoolsSection />
          <BucketsSection />
          <CredentialsSection />
        </div>
      </main>
    </div>
  );
}

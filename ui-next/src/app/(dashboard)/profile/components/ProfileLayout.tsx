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

import { useCallback } from "react";
import { usePage } from "@/components/chrome";
import { useProfile, useCredentials, useUpdateProfile } from "@/lib/api/adapter";
import type { ProfileUpdate } from "@/lib/api/adapter";
import { User, Loader2 } from "lucide-react";
import { useServices } from "@/contexts";

import { UserInfoCard } from "./UserInfoCard";
import { NotificationsCard } from "./NotificationsCard";
import { BucketsCard } from "./BucketsCard";
import { PoolsCard } from "./PoolsCard";
import { CredentialsCard } from "./CredentialsCard";

export function ProfileLayout() {
  usePage({ title: "Profile" });

  const { profile, isLoading: profileLoading, error: profileError } = useProfile();
  const { credentials, isLoading: credentialsLoading } = useCredentials();
  const { mutateAsync: updateProfileMutation, isPending: isUpdatingProfile } = useUpdateProfile();
  const { announcer } = useServices();

  // Wrapper to convert mutateAsync to match expected signature
  const updateProfile = useCallback(
    async (data: ProfileUpdate): Promise<void> => {
      await updateProfileMutation(data);
    },
    [updateProfileMutation],
  );

  // Show loading state
  if (profileLoading || credentialsLoading) {
    return (
      <div className="mx-auto max-w-5xl p-6">
        <div className="flex h-64 items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="text-muted-foreground size-8 animate-spin" />
            <p className="text-muted-foreground text-sm">Loading profile...</p>
          </div>
        </div>
      </div>
    );
  }

  // Show error state
  if (profileError || !profile) {
    return (
      <div className="mx-auto max-w-5xl p-6">
        <div className="flex h-64 items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <div className="bg-destructive/10 rounded-full p-3">
              <User className="text-destructive size-6" />
            </div>
            <div className="text-center">
              <p className="text-destructive font-medium">Error loading profile</p>
              <p className="text-muted-foreground text-sm">
                {profileError instanceof Error ? profileError.message : "Profile data not available"}
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1400px] p-8">
      {/* Page Header */}
      <header className="border-border mb-8 border-b pb-6">
        <h1 className="text-3xl font-semibold tracking-tight">Profile</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          Manage your user profile, notification preferences, and credentials
        </p>
      </header>

      {/* First Row: User Information & Notifications */}
      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <UserInfoCard profile={profile} />
        <NotificationsCard
          profile={profile}
          updateProfile={updateProfile}
          isUpdating={isUpdatingProfile}
          announcer={announcer}
        />
      </div>

      {/* Second Row: Default Bucket & Pools */}
      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <BucketsCard
          profile={profile}
          updateProfile={updateProfile}
          isUpdating={isUpdatingProfile}
          announcer={announcer}
        />
        <PoolsCard
          profile={profile}
          updateProfile={updateProfile}
          isUpdating={isUpdatingProfile}
          announcer={announcer}
        />
      </div>

      {/* Third Row: Credentials - Full Width */}
      <CredentialsCard credentials={credentials} />
    </div>
  );
}

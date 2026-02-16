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

import { useState, useMemo, useCallback } from "react";
import { toast } from "sonner";
import { Bell } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/shadcn/card";
import { Button } from "@/components/shadcn/button";
import { Switch } from "@/components/shadcn/switch";
import { cn } from "@/lib/utils";
import { useIntersectionObserver } from "@/hooks/use-intersection-observer";
import { useProfile, useUpdateProfile } from "@/lib/api/adapter/hooks";
import { useServices } from "@/contexts/service-context";
import { NotificationsSkeleton } from "@/app/(dashboard)/profile/components/skeletons/NotificationsSkeleton";
import { SectionErrorCard } from "@/app/(dashboard)/profile/components/SectionErrorCard";
import type { ProfileUpdate } from "@/lib/api/adapter/types";

interface NotificationEdits {
  email?: boolean;
  slack?: boolean;
}

export function NotificationsSection() {
  const [ref, , hasIntersected] = useIntersectionObserver<HTMLElement>({
    threshold: 0.1,
    rootMargin: "200px",
    triggerOnce: true,
  });

  const { profile, isLoading, error, refetch } = useProfile({ enabled: hasIntersected });
  const { mutateAsync: updateProfile, isPending: isUpdatingProfile } = useUpdateProfile();
  const { announcer } = useServices();

  const [notificationEdits, setNotificationEdits] = useState<NotificationEdits>({});

  const stagedNotifications = useMemo(
    () => ({
      email: notificationEdits.email ?? profile?.notifications.email ?? false,
      slack: notificationEdits.slack ?? profile?.notifications.slack ?? false,
    }),
    [profile, notificationEdits],
  );

  const isDirty = useMemo(
    () =>
      profile &&
      (stagedNotifications.email !== profile.notifications.email ||
        stagedNotifications.slack !== profile.notifications.slack),
    [profile, stagedNotifications],
  );

  const handleChange = useCallback((key: "email" | "slack", value: boolean) => {
    setNotificationEdits((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleReset = useCallback(() => {
    setNotificationEdits({});
  }, []);

  const handleSave = useCallback(async () => {
    if (!isDirty) return;

    try {
      await updateProfile({
        notifications: {
          email: stagedNotifications.email,
          slack: stagedNotifications.slack,
        },
      } as ProfileUpdate);
      setNotificationEdits({});
      toast.success("Notification preferences saved successfully");
      announcer.announce("Notification preferences saved successfully", "polite");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save notification preferences";
      toast.error(message);
      announcer.announce(`Error: ${message}`, "assertive");
    }
  }, [stagedNotifications, isDirty, updateProfile, announcer]);

  // Show skeleton only when not intersected or actively loading (but not if there's an error)
  if (!hasIntersected || (isLoading && !error)) {
    return (
      <section
        ref={ref}
        id="notifications"
        className="profile-scroll-offset"
      >
        <NotificationsSkeleton />
      </section>
    );
  }

  // Error state - show card with error content
  if (error) {
    return (
      <section
        ref={ref}
        id="notifications"
        className="profile-scroll-offset"
      >
        <SectionErrorCard
          icon={Bell}
          title="Notifications"
          description="Configure workflow notification preferences."
          errorLabel="Unable to load notification settings"
          error={error}
          onRetry={refetch}
        />
      </section>
    );
  }

  // Guard against missing data
  if (!profile) {
    return (
      <section
        ref={ref}
        id="notifications"
        className="profile-scroll-offset"
      >
        <NotificationsSkeleton />
      </section>
    );
  }

  return (
    <section
      ref={ref}
      id="notifications"
      className="profile-scroll-offset"
    >
      <Card
        data-variant="sectioned"
        className={cn(isDirty && "border-nvidia")}
      >
        <CardHeader className="gap-0 border-b">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Bell className="size-5" />
            Notifications
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-0">
            <div className="border-border flex items-center justify-between border-b py-3">
              <div className="flex flex-col gap-1">
                <label
                  htmlFor="notification-email"
                  className="text-sm font-medium"
                >
                  Email Notifications
                </label>
                <p className="text-muted-foreground text-xs">Receive workflow status updates via email</p>
              </div>
              <Switch
                id="notification-email"
                checked={stagedNotifications.email}
                onCheckedChange={(checked) => handleChange("email", checked)}
                disabled={isUpdatingProfile}
              />
            </div>
            <div className="flex items-center justify-between py-3">
              <div className="flex flex-col gap-1">
                <label
                  htmlFor="notification-slack"
                  className="text-sm font-medium"
                >
                  Slack Notifications
                </label>
                <p className="text-muted-foreground text-xs">Receive workflow status updates via Slack</p>
              </div>
              <Switch
                id="notification-slack"
                checked={stagedNotifications.slack}
                onCheckedChange={(checked) => handleChange("slack", checked)}
                disabled={isUpdatingProfile}
              />
            </div>
          </div>
        </CardContent>
        <CardFooter className="border-t">
          <div className="flex w-full items-center justify-end gap-3">
            <Button
              variant="secondary"
              onClick={handleReset}
              disabled={!isDirty || isUpdatingProfile}
            >
              Reset
            </Button>
            <Button
              className="btn-nvidia"
              onClick={handleSave}
              disabled={!isDirty || isUpdatingProfile}
            >
              Save
            </Button>
          </div>
        </CardFooter>
      </Card>
    </section>
  );
}

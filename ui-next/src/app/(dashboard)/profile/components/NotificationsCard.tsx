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
import { Switch } from "@/components/shadcn/switch";
import { Bell } from "lucide-react";
import { cn } from "@/lib/utils";
import type { UserProfile, ProfileUpdate } from "@/lib/api/adapter";
import type { AnnouncerService } from "@/contexts";

// Notification edits - stores only the user's changes, not the full state
// This pattern avoids useEffect synchronization issues with React Compiler
interface NotificationEdits {
  email?: boolean;
  slack?: boolean;
}

interface NotificationsCardProps {
  profile: UserProfile;
  updateProfile: (data: ProfileUpdate) => Promise<void>;
  isUpdating: boolean;
  announcer: AnnouncerService;
}

export function NotificationsCard({ profile, updateProfile, isUpdating, announcer }: NotificationsCardProps) {
  // Store only the user's edits (delta from profile)
  // When profile refetches after save, edits are cleared, and we see the new values
  const [notificationEdits, setNotificationEdits] = useState<NotificationEdits>({});

  // Compute effective staged values: profile values with edits applied
  const stagedNotifications = useMemo(() => {
    return {
      email: notificationEdits.email ?? profile.notifications.email,
      slack: notificationEdits.slack ?? profile.notifications.slack,
    };
  }, [profile, notificationEdits]);

  // Compute if notifications are dirty (any edits exist)
  const notificationsDirty = useMemo(() => {
    return (
      stagedNotifications.email !== profile.notifications.email ||
      stagedNotifications.slack !== profile.notifications.slack
    );
  }, [profile, stagedNotifications]);

  // Handler to update individual notification edit
  const handleNotificationChange = useCallback((key: "email" | "slack", value: boolean) => {
    setNotificationEdits((prev) => ({ ...prev, [key]: value }));
  }, []);

  // Reset notifications - clear all edits to revert to profile values
  const handleNotificationsReset = useCallback(() => {
    setNotificationEdits({});
  }, []);

  // Save notifications - commits staged values via mutation
  const handleNotificationsSave = useCallback(async () => {
    if (!notificationsDirty) return;

    try {
      await updateProfile({
        notifications: {
          email: stagedNotifications.email,
          slack: stagedNotifications.slack,
        },
      });
      // Clear edits after successful save - profile will refetch with new values
      setNotificationEdits({});
      announcer.announce("Notification preferences saved successfully", "polite");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save notification preferences";
      announcer.announce(`Error: ${message}`, "assertive");
    }
  }, [stagedNotifications, notificationsDirty, updateProfile, announcer]);

  return (
    <Card className={cn(notificationsDirty && "border-nvidia")}>
      <CardHeader className="border-b">
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
              onCheckedChange={(checked) => handleNotificationChange("email", checked)}
              disabled={isUpdating}
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
              onCheckedChange={(checked) => handleNotificationChange("slack", checked)}
              disabled={isUpdating}
            />
          </div>
        </div>
      </CardContent>
      <CardFooter className="border-t">
        <div className="flex w-full items-center justify-end gap-3">
          <Button
            variant="secondary"
            onClick={handleNotificationsReset}
            disabled={!notificationsDirty || isUpdating}
          >
            Reset
          </Button>
          <Button
            className="bg-nvidia hover:bg-nvidia-dark disabled:opacity-50"
            onClick={handleNotificationsSave}
            disabled={!notificationsDirty || isUpdating}
          >
            Save
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
}

// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// SPDX-License-Identifier: Apache-2.0

"use client";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/shadcn/card";
import { Input } from "@/components/shadcn/input";
import { useUser } from "@/lib/auth/user-context";
import { User } from "lucide-react";

function Label({ htmlFor, children }: { htmlFor?: string; children: React.ReactNode }) {
  return (
    <label
      htmlFor={htmlFor}
      className="text-sm leading-none font-medium peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
    >
      {children}
    </label>
  );
}

export function UserInfoSection() {
  const { user } = useUser();

  return (
    <section
      id="user-info"
      className="profile-scroll-offset"
    >
      <Card data-variant="sectioned">
        <CardHeader className="gap-0 border-b">
          <CardTitle className="flex items-center gap-2 text-lg">
            <User className="size-5" />
            User Information
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="max-w-lg space-y-6">
            <div className="space-y-2">
              <Label htmlFor="profile-name">Name</Label>
              <Input
                id="profile-name"
                value={user?.name || ""}
                disabled
                className="disabled:opacity-50"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="profile-email">Email</Label>
              <Input
                id="profile-email"
                type="email"
                value={user?.email || ""}
                disabled
                className="disabled:opacity-50"
              />
            </div>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

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

import { usePage } from "@/components/chrome";
import { useProfile, useCredentials } from "@/lib/api/adapter";
import type { Credential } from "@/lib/api/adapter";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/shadcn/card";
import { Input } from "@/components/shadcn/input";
import { Badge } from "@/components/shadcn/badge";
import { Button } from "@/components/shadcn/button";
import { Switch } from "@/components/shadcn/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/shadcn/select";
import {
  User,
  Loader2,
  Bell,
  FolderOpen,
  Server,
  Key,
  Search,
  Database,
  Lock,
  Package,
  Plus,
  Pencil,
  Trash2,
} from "lucide-react";
import { useState } from "react";

// Simple label component (shadcn/label not available)
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

// Group credentials by type for organized display
function groupCredentialsByType(credentials: Credential[]) {
  const registry: Credential[] = [];
  const data: Credential[] = [];
  const generic: Credential[] = [];

  for (const cred of credentials) {
    if (cred.type === "registry") {
      registry.push(cred);
    } else if (cred.type === "data") {
      data.push(cred);
    } else {
      generic.push(cred);
    }
  }

  return { registry, data, generic };
}

// Credential section header with icon
function CredentialSectionHeader({ icon: Icon, title }: { icon: React.ElementType; title: string }) {
  return (
    <h3 className="mb-3 flex items-center gap-2 text-[0.9375rem] font-semibold">
      <Icon className="size-4" />
      {title}
    </h3>
  );
}

// Format relative time for credential display
function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Updated today";
  if (diffDays === 1) return "Updated 1 day ago";
  if (diffDays < 7) return `Updated ${diffDays} days ago`;
  if (diffDays < 30) {
    const weeks = Math.floor(diffDays / 7);
    return `Updated ${weeks} week${weeks > 1 ? "s" : ""} ago`;
  }
  const months = Math.floor(diffDays / 30);
  return `Updated ${months} month${months > 1 ? "s" : ""} ago`;
}

// Individual credential item display with edit/delete actions
function CredentialItem({ credential }: { credential: Credential }) {
  // Get a display value based on credential type
  const displayValue =
    credential.type === "registry"
      ? credential.registry?.url
      : credential.type === "data"
        ? credential.data?.endpoint
        : credential.generic?.key;

  return (
    <div className="bg-muted border-border overflow-hidden rounded-md border transition-colors">
      <div className="hover:bg-accent/50 flex cursor-pointer items-center justify-between px-4 py-3 transition-colors">
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium">{credential.name}</span>
          <div className="text-muted-foreground flex items-center gap-3 text-xs">
            <Badge
              variant="outline"
              className="rounded font-mono text-[0.6875rem] tracking-wide uppercase"
            >
              {credential.type}
            </Badge>
            {displayValue && <span>{displayValue}</span>}
            <span className="text-muted-foreground">{formatRelativeTime(credential.updated_at)}</span>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            title="Edit credential"
            disabled
          >
            <Pencil className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            title="Delete credential"
            className="text-destructive hover:text-destructive"
            disabled
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

// Credentials list grouped by type
function CredentialsList({ credentials }: { credentials: Credential[] }) {
  if (credentials.length === 0) {
    return <p className="text-muted-foreground text-sm">No credentials configured</p>;
  }

  // Group credentials by type (React Compiler will optimize this)
  const grouped = groupCredentialsByType(credentials);

  return (
    <div className="space-y-8">
      {/* Registry Credentials */}
      {grouped.registry.length > 0 && (
        <div>
          <CredentialSectionHeader
            icon={Package}
            title="Registry Credentials"
          />
          <div className="space-y-2">
            {grouped.registry.map((cred: Credential) => (
              <CredentialItem
                key={cred.id}
                credential={cred}
              />
            ))}
          </div>
        </div>
      )}

      {/* Data Credentials */}
      {grouped.data.length > 0 && (
        <div>
          <CredentialSectionHeader
            icon={Database}
            title="Data Credentials"
          />
          <div className="space-y-2">
            {grouped.data.map((cred: Credential) => (
              <CredentialItem
                key={cred.id}
                credential={cred}
              />
            ))}
          </div>
        </div>
      )}

      {/* Generic Credentials */}
      {grouped.generic.length > 0 && (
        <div>
          <CredentialSectionHeader
            icon={Lock}
            title="Generic Credentials"
          />
          <div className="space-y-2">
            {grouped.generic.map((cred: Credential) => (
              <CredentialItem
                key={cred.id}
                credential={cred}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function ProfileLayout() {
  usePage({ title: "Profile" });

  const { profile, isLoading: profileLoading, error: profileError } = useProfile();
  const { credentials, isLoading: credentialsLoading } = useCredentials();

  // Pool search filter state
  const [poolSearch, setPoolSearch] = useState("");

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

  // Filter pools based on search query (computed after early returns when profile is available)
  const accessiblePools = profile.pool.accessible;
  const filteredPools = poolSearch.trim()
    ? accessiblePools.filter((pool) => pool.toLowerCase().includes(poolSearch.toLowerCase()))
    : accessiblePools;

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
        {/* User Information Card - read-only */}
        <Card>
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2 text-lg">
              <User className="size-5" />
              User Information
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="profile-name">Name</Label>
                <Input
                  id="profile-name"
                  value={profile.name}
                  disabled
                  className="disabled:opacity-50"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="profile-email">Email</Label>
                <Input
                  id="profile-email"
                  type="email"
                  value={profile.email}
                  disabled
                  className="disabled:opacity-50"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Notifications Card */}
        <Card>
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
                  <span className="text-sm font-medium">Email Notifications</span>
                  <p className="text-muted-foreground text-xs">Receive workflow status updates via email</p>
                </div>
                <Switch
                  checked={profile.notifications.email}
                  disabled
                />
              </div>
              <div className="flex items-center justify-between py-3">
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-medium">Slack Notifications</span>
                  <p className="text-muted-foreground text-xs">Receive workflow status updates via Slack</p>
                </div>
                <Switch
                  checked={profile.notifications.slack}
                  disabled
                />
              </div>
            </div>
          </CardContent>
          <CardFooter className="border-t">
            <div className="flex w-full items-center justify-end gap-3">
              <Button
                variant="secondary"
                disabled
              >
                Reset
              </Button>
              <Button
                className="bg-nvidia hover:bg-nvidia-dark"
                disabled
              >
                Save Changes
              </Button>
            </div>
          </CardFooter>
        </Card>
      </div>

      {/* Second Row: Default Bucket & Pools */}
      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        {/* Default Bucket Card */}
        <Card>
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
            <div className="space-y-2">
              <Label htmlFor="default-bucket">Bucket</Label>
              <Select
                value={profile.bucket.default || ""}
                disabled
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a bucket..." />
                </SelectTrigger>
                <SelectContent>
                  {profile.bucket.default && (
                    <SelectItem value={profile.bucket.default}>
                      {profile.bucket.default} (s3://{profile.bucket.default})
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
          <CardFooter className="border-t">
            <div className="flex w-full items-center justify-end gap-3">
              <Button
                variant="secondary"
                disabled
              >
                Reset
              </Button>
              <Button
                className="bg-nvidia hover:bg-nvidia-dark"
                disabled
              >
                Save Changes
              </Button>
            </div>
          </CardFooter>
        </Card>

        {/* Pools Card */}
        <Card>
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Server className="size-5" />
              Pools
              <Badge
                variant="secondary"
                className="bg-nvidia-bg text-nvidia-dark ml-1 text-xs"
              >
                {profile.pool.accessible.length} accessible
              </Badge>
            </CardTitle>
            <CardDescription>Select your default compute pool for workflow execution.</CardDescription>
          </CardHeader>
          <CardContent>
            {/* Search input for pools */}
            <div className="relative mb-4">
              <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
              <Input
                type="text"
                placeholder="Search pools..."
                value={poolSearch}
                onChange={(e) => setPoolSearch(e.target.value)}
                className="bg-muted pl-9"
              />
            </div>

            {/* Pool list container with scrollable area */}
            <div className="border-border bg-muted relative max-h-[400px] overflow-y-auto rounded-md border">
              {filteredPools.length > 0 ? (
                <div className="flex flex-col">
                  {filteredPools.map((pool) => {
                    const isDefault = pool === profile.pool.default;
                    return (
                      <div
                        key={pool}
                        className={`bg-background border-border flex cursor-pointer items-center justify-between border-b px-4 py-3 transition-colors last:border-b-0 ${
                          isDefault
                            ? "bg-nvidia-bg border-l-nvidia border-l-[3px] pl-[calc(1rem-3px)]"
                            : "hover:bg-muted"
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          {/* Radio indicator */}
                          <div
                            className={`size-4 shrink-0 rounded-full border-2 ${
                              isDefault ? "border-nvidia" : "border-border"
                            } relative transition-colors`}
                          >
                            {isDefault && (
                              <div className="bg-nvidia absolute top-1/2 left-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full" />
                            )}
                          </div>
                          <div className="flex flex-col gap-0.5">
                            <span className="text-sm font-medium">{pool}</span>
                            <span className="text-muted-foreground text-xs">8 GPUs available - A100</span>
                          </div>
                        </div>
                        {isDefault && (
                          <span className="bg-nvidia rounded px-2 py-0.5 text-[0.6875rem] font-semibold tracking-wide text-white uppercase">
                            Default
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-muted-foreground absolute inset-0 flex items-center justify-center p-8 text-sm">
                  {poolSearch ? "No pools match your search" : "No accessible pools"}
                </div>
              )}
            </div>
          </CardContent>
          <CardFooter className="border-t">
            <div className="flex w-full items-center justify-end gap-3">
              <Button
                variant="secondary"
                disabled
              >
                Reset
              </Button>
              <Button
                className="bg-nvidia hover:bg-nvidia-dark"
                disabled
              >
                Save Default
              </Button>
            </div>
          </CardFooter>
        </Card>
      </div>

      {/* Third Row: Credentials - Full Width */}
      <Card>
        <CardHeader className="border-b">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Key className="size-5" />
            Credentials
            <Badge
              variant="secondary"
              className="bg-nvidia-bg text-nvidia-dark ml-1 text-xs"
            >
              {credentials.length} total
            </Badge>
          </CardTitle>
          <CardDescription>
            Manage credentials for container registries, data storage, and generic secrets. Click a credential to edit
            it inline.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* New Credential Button */}
          <div className="mb-6">
            <Button
              variant="outline"
              className="border-border hover:border-nvidia w-full justify-center gap-2 border-dashed py-3"
              disabled
            >
              <Plus className="size-4" />
              New Credential
            </Button>
          </div>

          <CredentialsList credentials={credentials} />
        </CardContent>
      </Card>
    </div>
  );
}

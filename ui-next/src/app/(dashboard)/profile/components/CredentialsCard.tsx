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

import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/shadcn/card";
import { Badge } from "@/components/shadcn/badge";
import { Button } from "@/components/shadcn/button";
import { Key, Database, Lock, Package, Plus, Pencil, Trash2 } from "lucide-react";
import type { Credential } from "@/lib/api/adapter";

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

interface CredentialsCardProps {
  credentials: Credential[];
}

export function CredentialsCard({ credentials }: CredentialsCardProps) {
  return (
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
          Manage credentials for container registries, data storage, and generic secrets. Click a credential to edit it
          inline.
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
  );
}

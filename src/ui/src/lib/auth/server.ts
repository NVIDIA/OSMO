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

/**
 * Server-side authentication utilities — development build.
 *
 * Re-exports everything from server.production.ts. Overrides only the functions
 * that need a local dev fallback: each override calls the production version first
 * and falls back to DEV_USER_* env vars when headers are absent.
 *
 * In production this file is replaced entirely by server.production.ts via
 * Turbopack resolveAlias in next.config.ts — no fallbacks, no env checks.
 *
 * Set in .env.local:
 *   DEV_USER_NAME   – username / display name
 *   DEV_USER_EMAIL  – email address (defaults to DEV_USER_NAME)
 *   DEV_USER_ROLES  – comma-separated roles
 */

import {
  getServerUserRoles as prodGetServerUserRoles,
  getServerUsername as prodGetServerUsername,
  getServerUser as prodGetServerUser,
  deriveDisplayName,
  getInitials,
} from "@/lib/auth/server.production";
import { hasAdminRole } from "@/lib/auth/roles";
import type { User } from "@/lib/auth/user-context";

export async function getServerUserRoles(): Promise<string[]> {
  const username = await prodGetServerUsername();
  if (username !== null) return prodGetServerUserRoles();
  return (process.env.DEV_USER_ROLES ?? "")
    .split(/[,\s]+/)
    .map((r) => r.trim())
    .filter(Boolean);
}

export async function hasServerAdminRole(): Promise<boolean> {
  return hasAdminRole(await getServerUserRoles());
}

export async function getServerUsername(): Promise<string | null> {
  return (await prodGetServerUsername()) ?? process.env.DEV_USER_NAME ?? null;
}

export async function getServerUser(): Promise<User | null> {
  const user = await prodGetServerUser();
  if (user) return user;

  const username = process.env.DEV_USER_NAME;
  if (!username) return null;

  const email = process.env.DEV_USER_EMAIL ?? username;
  const roles = await getServerUserRoles();
  const name = deriveDisplayName(username);

  return {
    id: username,
    name,
    email,
    username,
    isAdmin: hasAdminRole(roles),
    initials: getInitials(name),
  };
}

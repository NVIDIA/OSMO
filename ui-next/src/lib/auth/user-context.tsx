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

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { hasAdminRole } from "./roles";
import { getBasePathUrl } from "@/lib/config";

export interface User {
  id: string;
  name: string;
  email: string;
  isAdmin: boolean;
  initials: string;
}

interface UserContextType {
  user: User | null;
  isLoading: boolean;
  logout: () => void;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

function getInitials(name: string): string {
  return name
    .split(/[\s@]+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("");
}

interface UserProviderProps {
  children: ReactNode;
}

/**
 * User Provider
 *
 * In production: Fetches user from /api/me (backend reads JWT from Envoy)
 * In local dev: Mocks the /api/me endpoint with fake user data
 */
export function UserProvider({ children }: UserProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function fetchUser() {
      try {
        const response = await fetch(getBasePathUrl("/api/me"), { credentials: "include" });
        if (response.ok) {
          const data = await response.json();
          const roles = data.roles || [];
          setUser({
            id: data.id || data.sub || "",
            name: data.name || data.email?.split("@")[0] || "User",
            email: data.email || "",
            isAdmin: hasAdminRole(roles),
            initials: getInitials(data.name || data.email || "U"),
          });
        } else {
          setUser(null);
        }
      } catch (error) {
        console.error("Failed to fetch user:", error);
        setUser(null);
      } finally {
        setIsLoading(false);
      }
    }

    fetchUser();
  }, []);

  const logout = () => {
    // Clear local state
    setUser(null);
    // Redirect to Envoy logout (uses basePath from deployment config)
    window.location.href = getBasePathUrl("/logout");
  };

  return <UserContext.Provider value={{ user, isLoading, logout }}>{children}</UserContext.Provider>;
}

export function useUser() {
  const context = useContext(UserContext);
  if (context === undefined) {
    throw new Error("useUser must be used within a UserProvider");
  }
  return context;
}

/**
 * Check if current user is admin.
 */
export function useIsAdmin(): boolean {
  const { user } = useUser();
  return user?.isAdmin ?? false;
}

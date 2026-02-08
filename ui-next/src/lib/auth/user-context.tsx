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
import { getBasePathUrl } from "@/lib/config";
import { getClientToken, decodeUserFromToken } from "@/lib/auth/decode-user";

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

interface UserProviderProps {
  children: ReactNode;
}

/**
 * User Provider
 *
 * Decodes user information from JWT token stored in localStorage or cookies.
 * No network call required - synchronous and fast.
 *
 * In production: Token is set by Envoy in cookies
 * In local dev: Token is injected via localStorage or copied from staging
 */
export function UserProvider({ children }: UserProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Decode user from JWT token (synchronous, no network call)
    try {
      const token = getClientToken();
      const decodedUser = decodeUserFromToken(token);
      setUser(decodedUser);
    } catch (error) {
      console.error("Failed to decode user from token:", error);
      setUser(null);
    } finally {
      setIsLoading(false);
    }
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

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

import { createContext, useContext, useEffect, useReducer, type ReactNode } from "react";
import { getBasePathUrl } from "@/lib/config";

export interface User {
  id: string;
  /** Display name for UI (e.g., "Alice Smith") */
  name: string;
  /** Email address */
  email: string;
  /** Backend username - matches x-osmo-user header from Envoy (e.g., "alice.smith" or "alice.smith@company.com") */
  username: string;
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

interface UserProviderState {
  user: User | null;
  isLoading: boolean;
}

type UserProviderAction = { type: "LOAD_SUCCESS"; user: User | null } | { type: "LOAD_FAILURE" } | { type: "LOGOUT" };

function userProviderReducer(state: UserProviderState, action: UserProviderAction): UserProviderState {
  switch (action.type) {
    case "LOAD_SUCCESS":
      return { user: action.user, isLoading: false };
    case "LOAD_FAILURE":
      return { user: null, isLoading: false };
    case "LOGOUT":
      return { ...state, user: null };
  }
}

/**
 * Fetches user info from the server.
 *
 * In production, /api/me reads the JWT from the Authorization header (injected by Envoy).
 * In local dev, /api/me returns dev user info.
 */
export function UserProvider({ children }: UserProviderProps) {
  const [state, dispatch] = useReducer(userProviderReducer, { user: null, isLoading: true });
  const { user, isLoading } = state;

  useEffect(() => {
    let cancelled = false;

    async function loadUser() {
      try {
        const response = await fetch(getBasePathUrl("/api/me"), { credentials: "include" });
        if (!response.ok) {
          dispatch({ type: "LOAD_FAILURE" });
          return;
        }
        const userData: User = await response.json();
        if (!cancelled) {
          dispatch({ type: "LOAD_SUCCESS", user: userData });
        }
      } catch (error) {
        console.error("Failed to load user:", error);
        if (!cancelled) {
          dispatch({ type: "LOAD_FAILURE" });
        }
      }
    }

    loadUser();

    return () => {
      cancelled = true;
    };
  }, []);

  const logout = () => {
    dispatch({ type: "LOGOUT" });
    window.location.href = getBasePathUrl("/oauth2/sign_out");
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

export function useIsAdmin(): boolean {
  const { user } = useUser();
  return user?.isAdmin ?? false;
}

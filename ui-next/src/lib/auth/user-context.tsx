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
import { getClientToken, decodeUserFromToken } from "@/lib/auth/decode-user";

/** Event dispatched after successful token refresh for user state sync. */
export const TOKEN_REFRESHED_EVENT = "osmo:token-refreshed";

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

// =============================================================================
// UserProvider State Reducer
// =============================================================================

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

/** Decodes user from JWT token in localStorage or cookies. No network call needed. */
export function UserProvider({ children }: UserProviderProps) {
  const [state, dispatch] = useReducer(userProviderReducer, { user: null, isLoading: true });
  const { user, isLoading } = state;

  useEffect(() => {
    const loadUser = () => {
      try {
        const token = getClientToken();
        const decodedUser = decodeUserFromToken(token);
        dispatch({ type: "LOAD_SUCCESS", user: decodedUser });
      } catch (error) {
        console.error("Failed to decode user from token:", error);
        dispatch({ type: "LOAD_FAILURE" });
      }
    };

    loadUser();

    // Re-read user when server-side refresh gets a new token
    window.addEventListener(TOKEN_REFRESHED_EVENT, loadUser);

    return () => {
      window.removeEventListener(TOKEN_REFRESHED_EVENT, loadUser);
    };
  }, []);

  const logout = () => {
    dispatch({ type: "LOGOUT" });
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

export function useIsAdmin(): boolean {
  const { user } = useUser();
  return user?.isAdmin ?? false;
}

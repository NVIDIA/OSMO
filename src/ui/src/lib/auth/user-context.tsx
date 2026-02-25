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

import { createContext, useContext, useState, type ReactNode } from "react";
import { getBasePathUrl } from "@/lib/config";

export interface User {
  id: string;
  name: string;
  email: string;
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
  initialUser: User | null;
}

/**
 * Provides user identity from Envoy-injected headers.
 *
 * The user is resolved server-side from x-osmo-user, x-osmo-roles, x-osmo-name
 * headers and passed as initialUser prop. No client-side fetch needed.
 */
export function UserProvider({ children, initialUser }: UserProviderProps) {
  const [user] = useState<User | null>(initialUser);

  const logout = () => {
    window.location.href = getBasePathUrl("/oauth2/sign_out");
  };

  return <UserContext.Provider value={{ user, isLoading: false, logout }}>{children}</UserContext.Provider>;
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

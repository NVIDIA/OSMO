"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useAuth } from "@/lib/auth/auth-provider";
import { hasAdminRole } from "@/lib/constants/roles";
import { logWarn } from "@/lib/logger";

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
}

const UserContext = createContext<UserContextType | undefined>(undefined);

function getInitials(name: string): string {
  return name
    .split(/[\s@]+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("");
}

/**
 * Extract user info from JWT claims.
 */
function getUserFromToken(idToken: string): User | null {
  try {
    const parts = idToken.split(".");
    if (!parts[1]) return null;
    const claims = JSON.parse(atob(parts[1]));

    const email = claims.email || claims.preferred_username || "";
    const name = claims.name || claims.given_name || email.split("@")[0] || "User";
    const roles = claims.roles || [];

    return {
      id: claims.sub || "",
      name,
      email,
      isAdmin: hasAdminRole(roles),
      initials: getInitials(name || email || "U"),
    };
  } catch {
    return null;
  }
}

interface UserProviderProps {
  children: ReactNode;
}

export function UserProvider({ children }: UserProviderProps) {
  const { isAuthenticated, idToken, isLoading: authLoading } = useAuth();

  // Derive user from token - no effect needed, just computation
  const user = useMemo(() => {
    if (!isAuthenticated || !idToken) {
      return null;
    }

    const tokenUser = getUserFromToken(idToken);

    if (!tokenUser && idToken) {
      logWarn("Could not extract user info from token");
    }

    return tokenUser;
  }, [isAuthenticated, idToken]);

  // Loading when auth is loading
  const isLoading = authLoading;

  return <UserContext.Provider value={{ user, isLoading }}>{children}</UserContext.Provider>;
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

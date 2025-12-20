"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
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
 * Extract user info from JWT claims when backend call fails.
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
  const { isAuthenticated, idToken } = useAuth();
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // If not authenticated, no user
    if (!isAuthenticated || !idToken) {
      setUser(null);
      setIsLoading(false);
      return;
    }

    // Extract user from token claims - no network call needed
    // This avoids CORS issues in local dev and is faster
    const tokenUser = getUserFromToken(idToken);
    setUser(tokenUser);
    setIsLoading(false);

    // Note: If we need additional user data not in the token,
    // we could optionally call the backend here via the adapter layer
  }, [isAuthenticated, idToken]);

  // Log warning if we have a token but couldn't extract user
  useEffect(() => {
    if (isAuthenticated && idToken && !user) {
      logWarn("Could not extract user info from token");
    }
  }, [isAuthenticated, idToken, user]);

  return (
    <UserContext.Provider value={{ user, isLoading }}>
      {children}
    </UserContext.Provider>
  );
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

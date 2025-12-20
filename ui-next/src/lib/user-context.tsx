"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "@/lib/auth/auth-provider";
import { getApiBaseUrl } from "@/lib/config";
import { logError } from "@/lib/logger";

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

interface UserProviderProps {
  children: ReactNode;
}

export function UserProvider({ children }: UserProviderProps) {
  const { isAuthenticated, idToken } = useAuth();
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Don't fetch user if not authenticated
    if (!isAuthenticated) {
      setUser(null);
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    async function loadUser() {
      try {
        const apiUrl = getApiBaseUrl();
        const response = await fetch(`${apiUrl}/api/auth/me`, {
          credentials: "include",
          headers: idToken ? { "x-osmo-auth": idToken } : {},
        });

        if (!response.ok) {
          throw new Error(`Failed to fetch user: ${response.status}`);
        }

        const data = await response.json();

        if (!cancelled) {
          setUser({
            id: data.id || data.user_id || "",
            name: data.name || data.username || data.email?.split("@")[0] || "User",
            email: data.email || "",
            isAdmin: data.is_admin ?? data.isAdmin ?? false,
            initials: getInitials(data.name || data.email || "U"),
          });
        }
      } catch (err) {
        if (!cancelled) {
          logError("Failed to load user:", err);
          setUser(null);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    loadUser();

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, idToken]);

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

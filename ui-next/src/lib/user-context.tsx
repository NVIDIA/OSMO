"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { getAuthToken } from "@/lib/auth/auth-provider";
import { getApiBaseUrl } from "@/lib/config";

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
  isAuthenticated: boolean;
  error: Error | null;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

/**
 * Fetch user info from the backend.
 */
async function fetchUser(): Promise<User> {
  const authToken = getAuthToken();
  const apiUrl = getApiBaseUrl();
  
  const response = await fetch(`${apiUrl}/api/auth/me`, {
    credentials: "include",
    headers: authToken ? { "x-osmo-auth": authToken } : {},
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch user: ${response.status}`);
  }

  const data = await response.json();
  
  return {
    id: data.id || data.user_id || "",
    name: data.name || data.username || data.email?.split("@")[0] || "User",
    email: data.email || "",
    isAdmin: data.is_admin ?? data.isAdmin ?? false,
    initials: getInitials(data.name || data.email || "U"),
  };
}

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
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadUser() {
      try {
        const userData = await fetchUser();
        if (!cancelled) {
          setUser(userData);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          // Don't set error for auth failures - just no user
          setUser(null);
          if (err instanceof Error && !err.message.includes("401")) {
            setError(err);
          }
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
  }, []);

  const isAuthenticated = user !== null && error === null;

  return (
    <UserContext.Provider value={{ user, isLoading, isAuthenticated, error }}>
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
 * Hook to check if current user is admin.
 */
export function useIsAdmin(): boolean {
  const { user } = useUser();
  return user?.isAdmin ?? false;
}

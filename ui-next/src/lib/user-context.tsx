"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

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
 * 
 * This calls the FastAPI backend to get the current user's info,
 * including whether they have admin permissions.
 */
async function fetchUser(): Promise<User> {
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "";
  const response = await fetch(`${backendUrl}/api/v1/auth/me`, {
    credentials: "include", // Include cookies for auth
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch user: ${response.status}`);
  }

  const data = await response.json();
  
  // Map backend response to our User type
  // Adjust field names based on actual backend response
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
          setError(err instanceof Error ? err : new Error("Unknown error"));
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

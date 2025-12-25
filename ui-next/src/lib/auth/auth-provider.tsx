"use client";

/**
 * Authentication Provider
 *
 * Provides authentication context to the application.
 * Uses AuthBackend abstraction for provider-agnostic auth operations.
 *
 * Production-first: LocalDevLogin is dynamically imported only in development.
 */

import { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react";
import dynamic from "next/dynamic";
import { useRouter, usePathname } from "next/navigation";
import { isLocalDev } from "@/lib/config";
import { logError } from "@/lib/logger";

import { getAuthBackend } from "./auth-backend";
import { parseJwtClaims, isTokenExpired } from "./token-utils";
import {
  getStoredIdToken,
  hasStoredRefreshToken,
  clearStoredTokens,
  refreshStoredToken,
  isAuthSkipped,
  setAuthSkipped,
  setReturnUrl,
  consumeReturnUrl,
  clearAuthSessionState,
} from "./token-storage";

// Dynamic import: LocalDevLogin is only loaded in development, excluded from production bundle
const LocalDevLogin = dynamic(() => import("./auth-local-dev").then((mod) => mod.LocalDevLogin), {
  ssr: false,
  loading: () => <p className="text-muted-foreground">Loading...</p>,
});

interface AuthContextType {
  isAuthenticated: boolean;
  isLoading: boolean;
  isSkipped: boolean;
  /** Whether authentication is enabled for this deployment */
  authEnabled: boolean;
  username: string;
  idToken: string;
  login: () => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function useAuth() {
  const auth = useContext(AuthContext);
  if (!auth) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return auth;
}

function getInitialState() {
  if (typeof window === "undefined") {
    return { idToken: "", hasRefreshToken: false, isSkipped: false };
  }

  return {
    idToken: getStoredIdToken(),
    hasRefreshToken: hasStoredRefreshToken(),
    isSkipped: isAuthSkipped(),
  };
}

export function AuthProvider({ children }: PropsWithChildren) {
  const router = useRouter();
  const pathname = usePathname();

  const [isLoading, setIsLoading] = useState(true);
  const [authEnabled, setAuthEnabled] = useState(false);

  const initial = useMemo(getInitialState, []);
  const [idToken, setIdToken] = useState(initial.idToken);
  const [hasRefreshToken, setHasRefreshToken] = useState(initial.hasRefreshToken);
  const [isSkipped, setIsSkipped] = useState(initial.isSkipped);

  const claims = useMemo(() => parseJwtClaims(idToken), [idToken]);
  const isAuthenticated = Boolean(idToken) && (!isTokenExpired(claims) || hasRefreshToken);
  const username = claims?.email ?? claims?.preferred_username ?? "";

  // Initialize auth state
  useEffect(() => {
    async function checkAuth() {
      try {
        const backend = getAuthBackend();
        const config = await backend.getConfig();
        setAuthEnabled(config.auth_enabled);

        if (!config.auth_enabled) {
          setIsLoading(false);
          return;
        }

        // Refresh expired token if possible
        const storedToken = getStoredIdToken();
        const storedClaims = parseJwtClaims(storedToken);

        if (storedToken && isTokenExpired(storedClaims) && hasStoredRefreshToken()) {
          const refreshed = await refreshStoredToken();
          if (refreshed) {
            setIdToken(refreshed);
            setHasRefreshToken(true);
          } else {
            clearStoredTokens();
            setIdToken("");
            setHasRefreshToken(false);
          }
        }
      } catch (error) {
        logError("Failed to check auth:", error);
      } finally {
        setIsLoading(false);
      }
    }

    checkAuth();
  }, []);

  const login = async () => {
    // Read pathname fresh to avoid stale closure issues
    // (user may have navigated before clicking login)
    const currentPath = typeof window !== "undefined" ? window.location.pathname : pathname;

    setReturnUrl(currentPath);
    setAuthSkipped(false);

    if (isLocalDev()) {
      // Trigger re-render to show login UI
      setIsSkipped(false);
    } else {
      const backend = getAuthBackend();
      const loginUrl = await backend.getLoginUrl(currentPath);
      if (loginUrl) {
        window.location.href = loginUrl;
      }
    }
  };

  const handleDevLogin = (token: string, hasRefresh: boolean) => {
    setIdToken(token);
    setHasRefreshToken(hasRefresh);
    setIsSkipped(false);
    setAuthSkipped(false);

    const returnUrl = consumeReturnUrl(pathname);
    router.push(returnUrl);
  };

  const skipAuth = () => {
    setAuthSkipped(true);
    setIsSkipped(true);
  };

  const logout = async () => {
    clearStoredTokens();
    clearAuthSessionState();
    setIdToken("");
    setHasRefreshToken(false);
    setIsSkipped(false);

    if (!isLocalDev()) {
      const backend = getAuthBackend();
      const logoutUrl = await backend.getLogoutUrl();
      if (logoutUrl) {
        router.push(logoutUrl);
        return;
      }
    }

    router.push("/");
  };

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (authEnabled && !isAuthenticated && !isSkipped) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-6 bg-background">
        <div className="text-center">
          <h1 className="text-2xl font-semibold text-foreground mb-2">OSMO</h1>
          <p className="text-muted-foreground">Authentication required</p>
        </div>

        {isLocalDev() ? (
          <LocalDevLogin
            onLogin={handleDevLogin}
            onSkip={skipAuth}
          />
        ) : (
          <div className="flex flex-col items-center gap-3">
            <button
              onClick={login}
              className="rounded-lg bg-[var(--nvidia-green)] px-6 py-2.5 text-sm font-medium text-black hover:bg-[var(--nvidia-green-light)] transition-colors"
            >
              Log in with SSO
            </button>
            <button
              onClick={skipAuth}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Continue without login →
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated,
        isLoading,
        isSkipped,
        authEnabled,
        username,
        idToken,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

/**
 * Get the current auth token for API requests.
 */
export function getAuthToken(): string {
  if (typeof window === "undefined") return "";
  return getStoredIdToken();
}

/**
 * Refresh the access token.
 */
export async function refreshToken(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  return refreshStoredToken();
}

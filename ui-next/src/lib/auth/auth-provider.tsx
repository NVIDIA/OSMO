"use client";

/**
 * Authentication Provider
 *
 * Provides authentication context to the application.
 * Uses AuthBackend abstraction for provider-agnostic auth operations.
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
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
} from "./token-storage";
import { LocalDevLogin } from "./auth-local-dev";

export { parseJwtClaims as getClaims, isTokenExpired } from "./token-utils";
export type { AuthClaims } from "./token-utils";

interface AuthContextType {
  isAuthenticated: boolean;
  isLoading: boolean;
  isSkipped: boolean;
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

const AUTH_SKIPPED_KEY = "osmo_auth_skipped";
const RETURN_URL_KEY = "osmo_return_url";

function getInitialState() {
  if (typeof window === "undefined") {
    return { idToken: "", hasRefreshToken: false, isSkipped: false };
  }

  return {
    idToken: getStoredIdToken(),
    hasRefreshToken: hasStoredRefreshToken(),
    isSkipped: sessionStorage.getItem(AUTH_SKIPPED_KEY) === "true",
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
    if (typeof window !== "undefined") {
      sessionStorage.setItem(RETURN_URL_KEY, pathname);
      sessionStorage.removeItem(AUTH_SKIPPED_KEY);
    }

    if (isLocalDev()) {
      // Trigger re-render to show login UI
      setIsSkipped(false);
    } else {
      const backend = getAuthBackend();
      const loginUrl = await backend.getLoginUrl(pathname);
      if (loginUrl) {
        window.location.href = loginUrl;
      }
    }
  };

  const handleDevLogin = (token: string, hasRefresh: boolean) => {
    setIdToken(token);
    setHasRefreshToken(hasRefresh);
    setIsSkipped(false);
    sessionStorage.removeItem(AUTH_SKIPPED_KEY);

    const returnUrl = sessionStorage.getItem(RETURN_URL_KEY) || pathname;
    sessionStorage.removeItem(RETURN_URL_KEY);
    router.push(returnUrl);
  };

  const skipAuth = () => {
    sessionStorage.setItem(AUTH_SKIPPED_KEY, "true");
    setIsSkipped(true);
  };

  const logout = async () => {
    clearStoredTokens();
    sessionStorage.removeItem(AUTH_SKIPPED_KEY);
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
      <div className="flex h-screen items-center justify-center bg-zinc-950">
        <p className="text-zinc-500">Loading...</p>
      </div>
    );
  }

  if (authEnabled && !isAuthenticated && !isSkipped) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-6 bg-zinc-950">
        <div className="text-center">
          <h1 className="text-2xl font-semibold text-white mb-2">OSMO</h1>
          <p className="text-zinc-500">Authentication required</p>
        </div>

        {isLocalDev() ? (
          <LocalDevLogin onLogin={handleDevLogin} onSkip={skipAuth} />
        ) : (
          <div className="flex flex-col items-center gap-3">
            <button
              onClick={login}
              className="rounded-lg bg-[#76b900] px-6 py-2.5 text-sm font-medium text-black hover:bg-[#8bd400] transition-colors"
            >
              Log in with SSO
            </button>
            <button
              onClick={skipAuth}
              className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
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

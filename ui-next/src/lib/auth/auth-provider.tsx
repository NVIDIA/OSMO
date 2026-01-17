"use client";

/**
 * Authentication Provider
 *
 * Provides authentication context to the application.
 * Uses AuthBackend abstraction for provider-agnostic auth operations.
 *
 * PPR-Compatible Design:
 * - Always renders children (never blocks the static shell)
 * - Auth UI is shown as an overlay, not a replacement
 * - Router access is deferred to effects/callbacks (not during render)
 * - This allows the static shell to be prerendered at build time
 *
 * Production-first: LocalDevLogin is dynamically imported only in development.
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useCallback,
  useRef,
  type PropsWithChildren,
} from "react";
import dynamic from "next/dynamic";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
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

// Helper to get current pathname (client-side only)
function getCurrentPathname(): string {
  if (typeof window === "undefined") return "/";
  return window.location.pathname;
}

export function AuthProvider({ children }: PropsWithChildren) {
  // Defer router access to avoid triggering dynamic data detection during static generation
  // Router is only used in callbacks (handleDevLogin, logout), not during render
  // We use a ref that's populated in an effect to completely avoid calling useRouter during SSR
  const routerRef = useRef<AppRouterInstance | null>(null);

  // On client mount, mark router as available
  // We use window.location for navigation to avoid triggering dynamic data detection during build
  useEffect(() => {
    // Router ref is kept for potential future use but we primarily use window.location
    routerRef.current = null;
  }, []);

  // Navigation helper that works without useRouter()
  const navigate = useCallback((url: string) => {
    if (typeof window !== "undefined") {
      window.location.href = url;
    }
  }, []);

  const [isLoading, setIsLoading] = useState(true);
  const [authEnabled, setAuthEnabled] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);

  const initial = useMemo(getInitialState, []);
  const [idToken, setIdToken] = useState(initial.idToken);
  const [hasRefreshToken, setHasRefreshToken] = useState(initial.hasRefreshToken);
  const [isSkipped, setIsSkipped] = useState(initial.isSkipped);

  const claims = useMemo(() => parseJwtClaims(idToken), [idToken]);
  const isAuthenticated = Boolean(idToken) && (!isTokenExpired(claims) || hasRefreshToken);
  const username = claims?.email ?? claims?.preferred_username ?? "";

  // Mark as hydrated on client
  useEffect(() => {
    setIsHydrated(true);
  }, []);

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

  const login = useCallback(async () => {
    // Read pathname fresh to avoid stale closure issues
    // (user may have navigated before clicking login)
    const currentPath = getCurrentPathname();

    setReturnUrl(currentPath);
    setAuthSkipped(false);

    if (isLocalDev()) {
      // Trigger re-render to show login UI
      setIsSkipped(false);
    } else {
      const backend = getAuthBackend();
      const loginUrl = await backend.getLoginUrl(currentPath);
      if (loginUrl) {
        navigate(loginUrl);
      }
    }
  }, [navigate]);

  const handleDevLogin = useCallback(
    (token: string, hasRefresh: boolean) => {
      setIdToken(token);
      setHasRefreshToken(hasRefresh);
      setIsSkipped(false);
      setAuthSkipped(false);

      const returnUrl = consumeReturnUrl(getCurrentPathname());
      navigate(returnUrl);
    },
    [navigate],
  );

  const skipAuth = useCallback(() => {
    setAuthSkipped(true);
    setIsSkipped(true);
  }, []);

  const logout = useCallback(async () => {
    clearStoredTokens();
    clearAuthSessionState();
    setIdToken("");
    setHasRefreshToken(false);
    setIsSkipped(false);

    if (!isLocalDev()) {
      const backend = getAuthBackend();
      const logoutUrl = await backend.getLogoutUrl();
      if (logoutUrl) {
        navigate(logoutUrl);
        return;
      }
    }

    navigate("/");
  }, [navigate]);

  // Determine if we should show the auth overlay
  // Only show on client after hydration, when auth is required but user isn't authenticated
  const showAuthOverlay = isHydrated && !isLoading && authEnabled && !isAuthenticated && !isSkipped;

  // Always render children (the static shell) - this is critical for PPR
  // Auth UI is rendered as an overlay on top when needed
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
      {/* Always render children for PPR - the shell should always be visible */}
      {children}

      {/* Auth overlay - shown on top of content when authentication is required */}
      {showAuthOverlay && (
        <div className="bg-background/95 fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 backdrop-blur-sm">
          <div className="text-center">
            <h1 className="text-foreground mb-2 text-2xl font-semibold">OSMO</h1>
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
                className="rounded-lg bg-[var(--nvidia-green)] px-6 py-2.5 text-sm font-medium text-black transition-colors hover:bg-[var(--nvidia-green-light)]"
              >
                Log in with SSO
              </button>
              <button
                onClick={skipAuth}
                className="text-muted-foreground hover:text-foreground text-sm transition-colors"
              >
                Continue without login →
              </button>
            </div>
          )}
        </div>
      )}

      {/* Loading overlay - shown briefly while checking auth on client */}
      {isHydrated && isLoading && (
        <div className="bg-background/95 fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm">
          <p className="text-muted-foreground">Loading...</p>
        </div>
      )}
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

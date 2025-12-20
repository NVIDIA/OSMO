"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import { useRouter, usePathname } from "next/navigation";
import { Check, Copy } from "lucide-react";
import { isLocalDev, getApiBaseUrl, COPY_FEEDBACK_DURATION_MS } from "@/lib/config";
import { logError } from "@/lib/logger";

interface AuthClaims {
  email?: string;
  preferred_username?: string;
  exp?: number;
}

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

/**
 * Get claims from JWT token.
 */
function getClaims(idToken?: string): AuthClaims | null {
  if (!idToken) return null;

  try {
    const parts = idToken.split(".");
    if (!parts[1]) return null;
    return JSON.parse(atob(parts[1])) as AuthClaims;
  } catch {
    return null;
  }
}

/**
 * Check if token is expired.
 */
function isTokenExpired(claims: AuthClaims | null): boolean {
  if (!claims?.exp) return true;
  return Date.now() >= claims.exp * 1000;
}

/**
 * Refresh access token using refresh token.
 * Returns new id_token on success, null on failure.
 */
async function refreshAccessToken(refreshToken: string): Promise<string | null> {
  try {
    const res = await fetch("/auth/refresh_token", {
      headers: { "x-refresh-token": refreshToken },
    });
    const data = await res.json();

    if (data.isFailure) {
      return null;
    }

    // Store new tokens
    if (data.id_token) {
      localStorage.setItem("IdToken", data.id_token);
    }
    if (data.refresh_token) {
      localStorage.setItem("RefreshToken", data.refresh_token);
    }

    return data.id_token || null;
  } catch (error) {
    logError("Failed to refresh token:", error);
    return null;
  }
}

// Storage keys
const AUTH_SKIPPED_KEY = "osmo_auth_skipped";
const RETURN_URL_KEY = "osmo_return_url";

export function AuthProvider({ children }: PropsWithChildren) {
  const router = useRouter();
  const pathname = usePathname();
  const [isLoading, setIsLoading] = useState(true);
  const [authEnabled, setAuthEnabled] = useState(false);
  const [idToken, setIdToken] = useState("");
  const [isSkipped, setIsSkipped] = useState(false);
  const [tokenInputValue, setTokenInputValue] = useState("");
  const [copied, setCopied] = useState(false);
  const [parseError, setParseError] = useState("");

  // Simple command - just copy the entire cookie string
  const tokenCommand = `document.cookie`;

  const copyCommand = async () => {
    await navigator.clipboard.writeText(tokenCommand);
    setCopied(true);
    setTimeout(() => setCopied(false), COPY_FEEDBACK_DURATION_MS);
  };

  const claims = useMemo(() => getClaims(idToken), [idToken]);
  const [hasRefreshToken, setHasRefreshToken] = useState(false);
  
  // Check for refresh token on mount and when idToken changes
  useEffect(() => {
    setHasRefreshToken(Boolean(localStorage.getItem("RefreshToken")));
  }, [idToken]);
  
  // Consider authenticated if we have a valid token OR an expired token with refresh token
  // The API layer will handle auto-refresh
  const isAuthenticated = Boolean(idToken) && (!isTokenExpired(claims) || hasRefreshToken);
  const username = claims?.email ?? claims?.preferred_username ?? "";


  // Check auth status on mount
  useEffect(() => {
    async function checkAuth() {
      try {
        // Check if user previously skipped auth
        const skipped = sessionStorage.getItem(AUTH_SKIPPED_KEY) === "true";
        setIsSkipped(skipped);

        // Check if auth is enabled
        const res = await fetch("/auth/login_info", { cache: "no-store" });
        const data = await res.json();
        setAuthEnabled(data.auth_enabled);

        if (!data.auth_enabled) {
          setIsLoading(false);
          return;
        }

        // Check for existing token in localStorage
        const storedToken = localStorage.getItem("IdToken");
        const storedRefreshToken = localStorage.getItem("RefreshToken");
        
        // Update hasRefreshToken state
        if (storedRefreshToken) {
          setHasRefreshToken(true);
        }

        if (storedToken) {
          const storedClaims = getClaims(storedToken);
          if (!isTokenExpired(storedClaims)) {
            setIdToken(storedToken);
          } else if (storedRefreshToken) {
            // Token expired but we have refresh token, try to refresh
            const refreshed = await refreshAccessToken(storedRefreshToken);
            if (refreshed) {
              setIdToken(refreshed);
              setHasRefreshToken(true); // Refresh succeeded, we still have valid refresh token
            } else {
              // Refresh failed, clear tokens
              localStorage.removeItem("IdToken");
              localStorage.removeItem("RefreshToken");
              setHasRefreshToken(false);
            }
          } else {
            // Token expired and no refresh token
            localStorage.removeItem("IdToken");
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

  const login = () => {
    // Store current path to return after login and show login screen
    if (typeof window !== "undefined") {
      sessionStorage.setItem(RETURN_URL_KEY, pathname);
      sessionStorage.removeItem(AUTH_SKIPPED_KEY);
    }
    setIsSkipped(false);
  };

  const loginWithToken = () => {
    const input = tokenInputValue.trim();
    if (!input) return;

    setParseError("");

    // Remove surrounding quotes if present (console output often includes them)
    let cookieStr = input;
    if ((cookieStr.startsWith('"') && cookieStr.endsWith('"')) ||
        (cookieStr.startsWith("'") && cookieStr.endsWith("'"))) {
      cookieStr = cookieStr.slice(1, -1);
    }

    // Parse cookie string to extract tokens
    const parseCookieValue = (str: string, name: string): string | undefined => {
      // Try multiple patterns to be more robust
      const patterns = [
        new RegExp(`(?:^|;\\s*)${name}=([^;]+)`),  // Standard format
        new RegExp(`${name}\\s*=\\s*([^;]+)`),      // With spaces
      ];
      
      for (const pattern of patterns) {
        const match = str.match(pattern);
        if (match?.[1]) {
          return match[1].trim();
        }
      }
      return undefined;
    };

    // Check if input looks like a cookie string (contains token cookies)
    // Support both IdToken (old) and BearerToken (production) naming
    if (cookieStr.includes('IdToken=') || cookieStr.includes('BearerToken=') || cookieStr.includes('RefreshToken=')) {
      // Try IdToken first, fall back to BearerToken
      const idTokenValue = parseCookieValue(cookieStr, 'IdToken') || parseCookieValue(cookieStr, 'BearerToken');
      const refreshTokenValue = parseCookieValue(cookieStr, 'RefreshToken');

      if (!idTokenValue) {
        setParseError("Could not find IdToken or BearerToken in cookie string");
        return;
      }

      localStorage.setItem("IdToken", idTokenValue);

      if (refreshTokenValue) {
        localStorage.setItem("RefreshToken", refreshTokenValue);
        setHasRefreshToken(true);
      }

      // Check if token is expired and we have a refresh token - try to refresh
      const tokenClaims = getClaims(idTokenValue);
      if (isTokenExpired(tokenClaims) && refreshTokenValue) {
        // Token is expired, try to refresh it
        refreshToken().then((newToken) => {
          if (newToken) {
            setIdToken(newToken);
          } else {
            // Refresh failed, use the original token anyway (server will reject if truly invalid)
            setIdToken(idTokenValue);
          }
          finishLogin();
        });
        return;
      }

      setIdToken(idTokenValue);
      finishLogin();
      return;
    }
    
    // Fallback: treat as raw IdToken (for backwards compatibility)
    localStorage.setItem("IdToken", cookieStr);
    setIdToken(cookieStr);
    finishLogin();
  };

  const finishLogin = () => {
    setIsSkipped(false);
    setHasRefreshToken(Boolean(localStorage.getItem("RefreshToken")));
    sessionStorage.removeItem(AUTH_SKIPPED_KEY);
    setTokenInputValue("");

    // Redirect to stored return URL or current path
    const returnUrl = sessionStorage.getItem(RETURN_URL_KEY) || pathname;
    sessionStorage.removeItem(RETURN_URL_KEY);
    router.push(returnUrl);
  };

  const skipAuth = () => {
    sessionStorage.setItem(AUTH_SKIPPED_KEY, "true");
    setIsSkipped(true);
  };

  const logout = async () => {
    localStorage.removeItem("IdToken");
    localStorage.removeItem("RefreshToken");
    sessionStorage.removeItem(AUTH_SKIPPED_KEY);
    setIdToken("");
    setIsSkipped(false);

    if (!isLocalDev()) {
      try {
        const res = await fetch("/auth/logout", { cache: "no-store" });
        const data = await res.json();
        if (data.redirectTo) {
          router.push(data.redirectTo);
          return;
        }
      } catch {
        // Logout endpoint may not exist
      }
    }

    router.push("/");
  };

  // Show nothing while loading auth state
  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-950">
        <p className="text-zinc-500">Loading...</p>
      </div>
    );
  }

  // If auth is enabled but user is not authenticated AND hasn't skipped, show login prompt
  if (authEnabled && !isAuthenticated && !isSkipped) {
    const productionUrl = getApiBaseUrl();

    return (
      <div className="flex h-screen flex-col items-center justify-center gap-6 bg-zinc-950">
        <div className="text-center">
          <h1 className="text-2xl font-semibold text-white mb-2">OSMO</h1>
          <p className="text-zinc-500">Authentication required</p>
        </div>

        {!isLocalDev() ? (
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
            ) : (
              <div className="flex flex-col items-center gap-4 w-full max-w-lg px-4">
                <div className="text-center text-sm text-zinc-400">
                  <p>Local development mode</p>
                </div>

                {/* Step 1: Log in to production */}
                <div className="w-full">
                  <p className="text-xs text-zinc-500 mb-2"># 1. Log in to production:</p>
                  <a
                    href={productionUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block w-full rounded-lg bg-zinc-900 px-4 py-3 text-sm text-[#76b900] hover:bg-zinc-800 transition-colors break-all"
                  >
                    {productionUrl} ↗
                  </a>
                </div>

                {/* Step 2: Copy console command */}
                <div className="w-full">
                  <p className="text-xs text-zinc-500 mb-2"># 2. Open browser console (F12) and run:</p>
                  <div className="flex items-start gap-2 rounded-lg bg-zinc-900 px-4 py-3">
                    <code className="text-xs font-mono text-zinc-300 flex-1 break-all">{tokenCommand}</code>
                    <button
                      onClick={copyCommand}
                      className="shrink-0 p-1.5 rounded hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors"
                      title="Copy to clipboard"
                    >
                      {copied ? (
                        <Check className="h-4 w-4 text-[#76b900]" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Step 3: Paste result */}
                <div className="w-full">
                  <p className="text-xs text-zinc-500 mb-2"># 3. Paste the output:</p>
                  <input
                    type="password"
                    value={tokenInputValue}
                    onChange={(e) => {
                      setTokenInputValue(e.target.value);
                      setParseError("");
                    }}
                    placeholder="Paste cookie string here..."
                    className="w-full px-4 py-2.5 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-100 text-sm font-mono placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-[#76b900] focus:border-transparent"
                  />
                  {parseError && (
                    <p className="text-xs text-red-400 mt-1">{parseError}</p>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  <button
                    onClick={loginWithToken}
                    disabled={!tokenInputValue.trim()}
                    className="rounded-lg bg-[#76b900] px-6 py-2.5 text-sm font-medium text-black hover:bg-[#8bd400] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Log In
                  </button>
                  <button
                    onClick={skipAuth}
                    className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
                  >
                    Continue without login →
                  </button>
                </div>
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
 * Can be called from anywhere (doesn't require React context).
 */
export function getAuthToken(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("IdToken") ?? "";
}

/**
 * Refresh the access token using the stored refresh token.
 * Returns the new token on success, null on failure.
 */
export async function refreshToken(): Promise<string | null> {
  if (typeof window === "undefined") return null;

  const storedRefreshToken = localStorage.getItem("RefreshToken");
  if (!storedRefreshToken) return null;

  try {
    const res = await fetch("/auth/refresh_token", {
      headers: { "x-refresh-token": storedRefreshToken },
    });
    const data = await res.json();

    if (data.isFailure) {
      // Refresh failed, clear tokens
      localStorage.removeItem("IdToken");
      localStorage.removeItem("RefreshToken");
      return null;
    }

    // Store new tokens
    if (data.id_token) {
      localStorage.setItem("IdToken", data.id_token);
    }
    if (data.refresh_token) {
      localStorage.setItem("RefreshToken", data.refresh_token);
    }

    return data.id_token || null;
  } catch (error) {
    logError("Failed to refresh token:", error);
    return null;
  }
}

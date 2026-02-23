//SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

//Licensed under the Apache License, Version 2.0 (the "License");
//you may not use this file except in compliance with the License.
//You may obtain a copy of the License at

//http://www.apache.org/licenses/LICENSE-2.0

//Unless required by applicable law or agreed to in writing, software
//distributed under the License is distributed on an "AS IS" BASIS,
//WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//See the License for the specific language governing permissions and
//limitations under the License.

//SPDX-License-Identifier: Apache-2.0
"use client";

import { createContext, type PropsWithChildren, useContext, useEffect, useMemo, useState } from "react";

import { useRouter } from "next/navigation";

import { env } from "~/env.mjs";
import { AuthClaimsSchema, TokenCheckSchema, TokenRefreshSchema, type AuthClaims } from "~/models/auth-model";

import { PageError } from "./PageError";

const AuthContext = createContext<Auth | null>(null);

export const useAuth = () => {
  const auth = useContext(AuthContext);
  if (!auth) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return auth;
};

const getClaims = (id_token?: string): AuthClaims | null => {
  if (!id_token) {
    return null;
  }

  const parts = id_token.split(".");

  if (!parts[1]) {
    return null;
  }

  const decoded = JSON.parse(atob(parts[1]));
  const result = AuthClaimsSchema.safeParse(decoded);

  if (!result.success) {
    console.warn("Failed to parse or validate auth claims:", result.error);
    return null;
  }

  return result.data;
};

const ImportantCookies = ["RefreshToken", "IdToken"] as const;
type ImportantCookie = (typeof ImportantCookies)[number];

const getCookies = (
  input = typeof document !== "undefined" ? document.cookie : "",
): Record<ImportantCookie, string> => {
  return input.split(";").reduce(
    (output, cookie) => {
      const [key, value] = cookie.trim().split("=");

      if (!key || !value) {
        return output;
      }

      if (ImportantCookies.includes(key as ImportantCookie)) {
        output[key as ImportantCookie] = decodeURIComponent(value);
      }

      return output;
    },
    {} as Record<ImportantCookie, string>,
  );
};

const setCookies = (name: ImportantCookie, value: string, daysUntilExpires: number) => {
  const d = new Date();
  d.setTime(d.getTime() + daysUntilExpires * 24 * 60 * 60 * 1000);

  const expires = "expires=" + d.toUTCString();
  if (typeof document !== "undefined") {
    document.cookie = name + "=" + value + ";" + expires + ";path=/";
  }
};

class Auth {
  claims: AuthClaims | null = null;
  id_token = "";
  refresh_token = "";
  authEnabled = false;
  isOAuth2ProxySession = false;
  routerPush: ReturnType<typeof useRouter>["push"] = () => {
    // no-op
  };

  setRouterPush(router: ReturnType<typeof useRouter>) {
    this.routerPush = router.push.bind(router);
  }

  get username() {
    if (!this.authEnabled) {
      return "testuser";
    }

    return this.claims?.email ?? this.claims?.preferred_username ?? "";
  }

  async login() {
    let loginInfoResponse: Response;
    try {
      loginInfoResponse = await fetch("/auth/login_info", { cache: "no-store" });
      const data = await loginInfoResponse.json();
      this.authEnabled = data.auth_enabled;
    } catch (error) {
      throw new Error(`Failed to fetch login info: ${error instanceof Error ? error.message : "Unknown error"}`);
    }

    if (!this.authEnabled) {
      return;
    }

    if (window.location.pathname.startsWith("/auth/success")) {
      return;
    }

    // Check for OAuth2 Proxy session via response headers.
    // Envoy's ext_authz forwards user info from OAuth2 Proxy via
    // allowed_client_headers_on_success. The display name comes from
    // the JWT metadata via Envoy's Lua envoy_on_response filter.
    const authEmail = loginInfoResponse.headers.get("x-auth-request-email");
    const authPreferredUsername = loginInfoResponse.headers.get("x-auth-request-preferred-username");
    if (authEmail || authPreferredUsername) {
      this.isOAuth2ProxySession = true;
      const displayName = loginInfoResponse.headers.get("x-osmo-name");
      this.claims = {
        email: authEmail ?? authPreferredUsername ?? "",
        preferred_username: authPreferredUsername ?? authEmail ?? "",
        name: displayName ?? authPreferredUsername ?? authEmail ?? "",
      } as AuthClaims;
      return;
    }

    if (env.NEXT_PUBLIC_OSMO_ENV === "local-against-production") {
      const idToken = localStorage.getItem("IdToken");
      const refreshToken = localStorage.getItem("RefreshToken");

      // No tokens found in local storage so redirect to keycloak
      // and start auth flow
      if (!idToken || !refreshToken) {
        const res = await fetch("/auth/initiate");
        const data = await res.json();
        this.routerPush(`${data.redirectTo}`);
        return;
      }

      this.claims = getClaims(idToken);
      this.id_token = idToken;
      this.refresh_token = refreshToken;
    }

    if (env.NEXT_PUBLIC_OSMO_ENV === "production") {
      // User should have already been authenticated by keycloak
      // so we can just get the tokens from the cookies
      const cookies = getCookies();
      this.claims = getClaims(cookies.IdToken);
      this.id_token = cookies.IdToken;
      this.refresh_token = cookies.RefreshToken;
    }

    const osmoHeaders = { "x-osmo-auth": this.id_token ?? "" };

    // First attempt to GET /auth/check_token to see if the session is still valid
    let checkTokenResponse: unknown;
    try {
      const res = await fetch("/auth/check_token", {
        headers: osmoHeaders,
        cache: "no-store",
      });
      checkTokenResponse = await res.json();
    } catch (error: unknown) {
      if (env.NEXT_PUBLIC_OSMO_ENV === "production") {
        throw new Error(`Failed to check token: ${error instanceof Error ? error.message : "Unknown error"}`);
      }
      return;
    }

    const checkToken = TokenCheckSchema.safeParse(checkTokenResponse);
    if (!checkToken.success) {
      throw new Error(`Failed to parse initial refresh response: ${checkToken.error.message}`);
    }

    if (!checkToken.data.isFailure) {
      // Session is still valid
      return;
    }

    if (env.NEXT_PUBLIC_OSMO_ENV === "production") {
      throw new Error("Token check failed");
    }

    // ENV is only "local-against-production"

    // If checking the token fails, attempt to refresh it.
    let refreshTokenResponse: unknown;
    try {
      const res = await fetch("/auth/refresh_token", {
        headers: { "x-refresh-token": this.refresh_token ?? "" },
      });
      refreshTokenResponse = await res.json();
    } catch (error: unknown) {
      throw new Error(`Failed to refresh token: ${error instanceof Error ? error.message : "Unknown error"}`);
    }

    const refreshToken = TokenRefreshSchema.safeParse(refreshTokenResponse);

    if (!refreshToken.success) {
      throw new Error(`Failed to parse refresh token response: ${refreshToken.error.message}`);
    }

    if (refreshToken.data.isFailure) {
      // If we're in local-against-production and the token refresh fails,
      // it's possible the refresh token is from a different environment.
      // Clear it and try again.
      localStorage.removeItem("IdToken");
      localStorage.removeItem("RefreshToken");
      window.location.reload();
      return;
    }

    // Set cookies and localStorage if id_token and refresh_token are present
    if (refreshToken.data.id_token) {
      this.claims = getClaims(refreshToken.data.id_token);
      this.id_token = refreshToken.data.id_token;
      localStorage.setItem("IdToken", refreshToken.data.id_token);
    }

    if (refreshToken.data.refresh_token) {
      this.refresh_token = refreshToken.data.refresh_token;
      localStorage.setItem("RefreshToken", refreshToken.data.refresh_token);
    }
  }

  async logout() {
    this.claims = null;
    this.id_token = "";
    this.refresh_token = "";

    if (this.isOAuth2ProxySession) {
      window.location.href = "/oauth2/sign_out";
      return;
    }

    // Legacy cookie-based logout
    if (env.NEXT_PUBLIC_OSMO_ENV === "local-against-production") {
      localStorage.removeItem("IdToken");
      localStorage.removeItem("RefreshToken");
    } else if (env.NEXT_PUBLIC_OSMO_ENV === "production") {
      setCookies("IdToken", "", -1);
      setCookies("RefreshToken", "", -1);
    }

    const res = await fetch(`/auth/logout`, { cache: "no-store" });
    const data = await res.json();
    this.routerPush(`${data.redirectTo}`);
  }
}

export const AuthProvider = ({ children }: PropsWithChildren) => {
  const auth = useMemo(() => new Auth(), []);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
  const router = useRouter();

  useEffect(() => {
    auth.setRouterPush(router);
  }, [auth, router]);

  useEffect(() => {
    setIsLoading(true);
    setError(undefined);

    void auth
      .login()
      .then(() => {
        setIsLoading(false);
      })
      .catch((error) => {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        console.warn(errorMessage);
        setError(errorMessage);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [auth]);

  if (isLoading) {
    return null;
  }

  if (error) {
    return (
      <div className="flex h-screen w-screen items-center justify-center">
        <PageError
          title="Authentication failed"
          errorMessage="This may be related to an access issue or service outage. Please contact support for further assistance."
          subText={error}
        >
          <button
            className="btn btn-primary"
            onClick={() => {
              window.location.reload();
            }}
          >
            Reload
          </button>
        </PageError>
      </div>
    );
  }

  return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>;
};

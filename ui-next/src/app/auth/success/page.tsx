"use client";

import { useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";

/**
 * Auth success page - stores tokens and redirects to the original page.
 *
 * This page receives tokens from the OAuth callback and stores them
 * in localStorage before redirecting back to the app.
 *
 * For local-against-production mode:
 * If redirect_to is a localhost URL, we redirect there WITH the tokens
 * so the local instance can store them.
 */
export default function AuthSuccessPage() {
  const searchParams = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    const idToken = searchParams.get("id_token");
    const refreshToken = searchParams.get("refresh_token");
    const redirectTo = searchParams.get("redirect_to") || "/";

    // Check if redirect_to is a localhost URL (local-against-production mode)
    const isLocalRedirect = redirectTo.startsWith("http://localhost") || redirectTo.startsWith("http://127.0.0.1");

    if (isLocalRedirect && idToken) {
      // Redirect to localhost WITH tokens in the URL
      const localUrl = new URL(redirectTo);
      // If redirecting to a local auth/success, append tokens
      if (localUrl.pathname === "/auth/success" || localUrl.pathname === "/" || localUrl.pathname === "") {
        localUrl.pathname = "/auth/success";
        localUrl.searchParams.set("id_token", idToken);
        if (refreshToken) {
          localUrl.searchParams.set("refresh_token", refreshToken);
        }
        localUrl.searchParams.set("redirect_to", "/");
        window.location.href = localUrl.toString();
        return;
      }
    }

    // Normal flow: store tokens locally and redirect
    if (idToken) {
      localStorage.setItem("IdToken", idToken);
    }
    if (refreshToken) {
      localStorage.setItem("RefreshToken", refreshToken);
    }

    // Redirect to the original page
    router.replace(redirectTo);
  }, [searchParams, router]);

  return (
    <div className="flex h-screen items-center justify-center bg-zinc-950">
      <p className="text-zinc-500">Logging you in...</p>
    </div>
  );
}

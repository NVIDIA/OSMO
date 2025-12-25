/**
 * Local Development Authentication
 *
 * Simple cookie-based auth for local development.
 * 1. Open the backend, run `document.cookie` in console
 * 2. Paste here and click Login
 *
 * Backend configured via NEXT_PUBLIC_OSMO_API_HOSTNAME in .env.local
 */

"use client";

import { useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import { COPY_FEEDBACK_DURATION_MS, getApiHostname, isSslEnabled } from "@/lib/config";
import { StorageKeys } from "@/lib/constants/storage";
import { storeTokens, refreshStoredToken } from "./token-storage";
import { parseJwtClaims, isTokenExpired } from "./token-utils";
import { ThemeToggle } from "@/components/theme-toggle";

function parseCookieString(cookieStr: string): {
  idToken?: string;
  refreshToken?: string;
  error?: string;
} {
  let str = cookieStr.trim();

  // Remove surrounding quotes
  if ((str.startsWith('"') && str.endsWith('"')) || (str.startsWith("'") && str.endsWith("'"))) {
    str = str.slice(1, -1);
  }

  const { ID_TOKEN, BEARER_TOKEN, REFRESH_TOKEN } = StorageKeys;

  // Check for JWT (3 dot-separated parts)
  if (str.split(".").length === 3 && !str.includes("=")) {
    return { idToken: str };
  }

  // Parse cookie string
  const parseCookieValue = (name: string): string | undefined => {
    const match = str.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
    return match?.[1]?.trim();
  };

  const idToken = parseCookieValue(ID_TOKEN) || parseCookieValue(BEARER_TOKEN);
  const refreshToken = parseCookieValue(REFRESH_TOKEN);

  if (!idToken) {
    return { error: "No valid token found. Paste the output of document.cookie from your backend." };
  }

  return { idToken, refreshToken };
}

interface LocalDevLoginProps {
  onLogin: (idToken: string, hasRefreshToken: boolean) => void;
  onSkip: () => void;
}

export function LocalDevLogin({ onLogin, onSkip }: LocalDevLoginProps) {
  const [tokenInput, setTokenInput] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  const host = getApiHostname();
  const scheme = isSslEnabled() ? "https" : "http";
  const backendUrl = `${scheme}://${host}`;

  const copyCommand = async () => {
    await navigator.clipboard.writeText("document.cookie");
    setCopied(true);
    setTimeout(() => setCopied(false), COPY_FEEDBACK_DURATION_MS);
  };

  const handleLogin = async () => {
    if (!tokenInput.trim()) return;
    setError("");

    const { idToken, refreshToken, error: parseError } = parseCookieString(tokenInput);
    if (parseError || !idToken) {
      setError(parseError || "No token found");
      return;
    }

    storeTokens(idToken, refreshToken);

    const claims = parseJwtClaims(idToken);
    if (isTokenExpired(claims) && refreshToken) {
      const refreshed = await refreshStoredToken();
      onLogin(refreshed || idToken, !!refreshed);
    } else {
      onLogin(idToken, !!refreshToken);
    }
  };

  return (
    <div className="flex flex-col items-center gap-8 w-full max-w-md px-6">
      <div className="fixed top-4 right-4 z-50">
        <ThemeToggle />
      </div>

      {/* Header */}
      <div className="text-center space-y-2">
        <h1 className="text-xl font-semibold text-foreground">Local Development</h1>
        <p className="text-sm text-muted-foreground">
          Transfer your session from{" "}
          <a
            href={backendUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--nvidia-green)] hover:underline inline-flex items-center gap-1"
          >
            {host}
            <ExternalLink className="h-3 w-3" />
          </a>
        </p>
      </div>

      {/* Instructions */}
      <div className="w-full space-y-4">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span className="flex-shrink-0 w-5 h-5 rounded-full bg-[var(--nvidia-green)] text-black text-xs font-bold flex items-center justify-center">
            1
          </span>
          <span>Run in browser console (F12):</span>
        </div>

        <button
          onClick={copyCommand}
          className="w-full flex items-center justify-between px-4 py-3 rounded-lg bg-muted border border-border hover:bg-accent transition-colors group"
        >
          <code className="text-sm font-mono text-foreground">document.cookie</code>
          {copied ? (
            <Check className="h-4 w-4 text-[var(--nvidia-green)]" />
          ) : (
            <Copy className="h-4 w-4 text-muted-foreground group-hover:text-foreground" />
          )}
        </button>

        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span className="flex-shrink-0 w-5 h-5 rounded-full bg-[var(--nvidia-green)] text-black text-xs font-bold flex items-center justify-center">
            2
          </span>
          <span>Paste the result:</span>
        </div>

        <textarea
          value={tokenInput}
          onChange={(e) => {
            setTokenInput(e.target.value);
            setError("");
          }}
          placeholder="Paste cookie string..."
          rows={2}
          autoComplete="off"
          spellCheck={false}
          className="w-full px-4 py-3 rounded-lg bg-muted border border-border text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--nvidia-green)] resize-none"
        />

        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-4">
        <button
          onClick={handleLogin}
          disabled={!tokenInput.trim()}
          className="px-6 py-2.5 rounded-lg bg-[var(--nvidia-green)] text-sm font-medium text-black hover:bg-[var(--nvidia-green-light)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Log In
        </button>
        <button
          onClick={onSkip}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Skip
        </button>
      </div>

      {/* Config hint */}
      <p className="text-xs text-muted-foreground text-center">
        Backend: <code className="bg-muted px-1 py-0.5 rounded">.env.local</code> → NEXT_PUBLIC_OSMO_API_HOSTNAME
      </p>
    </div>
  );
}

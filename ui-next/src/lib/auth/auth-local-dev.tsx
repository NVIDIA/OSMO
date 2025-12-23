/**
 * Local Development Authentication
 *
 * Provides an alternative login flow for local development where
 * OAuth redirects are not available. Users manually transfer their
 * session by pasting their cookie string from the production UI.
 *
 * This module is only active when isLocalDev() returns true.
 */

"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { getApiBaseUrl, COPY_FEEDBACK_DURATION_MS } from "@/lib/config";
import { StorageKeys } from "@/lib/constants/storage";
import { storeTokens, refreshStoredToken } from "./token-storage";
import { parseJwtClaims, isTokenExpired } from "./token-utils";

/**
 * Parse a cookie string to extract tokens.
 */
function parseCookieString(cookieStr: string): {
  idToken?: string;
  refreshToken?: string;
  error?: string;
} {
  let str = cookieStr.trim();

  // Remove surrounding quotes
  if ((str.startsWith('"') && str.endsWith('"')) ||
      (str.startsWith("'") && str.endsWith("'"))) {
    str = str.slice(1, -1);
  }

  // Check if this looks like a cookie string
  const { ID_TOKEN, BEARER_TOKEN, REFRESH_TOKEN } = StorageKeys;
  if (!str.includes(`${ID_TOKEN}=`) && !str.includes(`${BEARER_TOKEN}=`) && !str.includes(`${REFRESH_TOKEN}=`)) {
    // Might be a raw JWT
    if (str.split('.').length === 3) {
      return { idToken: str };
    }
    return { error: "Input doesn't appear to be a cookie string or JWT token" };
  }

  const parseCookieValue = (name: string): string | undefined => {
    const match = str.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
    return match?.[1]?.trim();
  };

  const idToken = parseCookieValue(ID_TOKEN) || parseCookieValue(BEARER_TOKEN);
  const refreshToken = parseCookieValue(REFRESH_TOKEN);

  if (!idToken) {
    return { error: "Could not find IdToken or BearerToken in cookie string" };
  }

  return { idToken, refreshToken };
}

interface LocalDevLoginProps {
  onLogin: (idToken: string, hasRefreshToken: boolean) => void;
  onSkip: () => void;
}

/**
 * Login UI for local development.
 */
export function LocalDevLogin({ onLogin, onSkip }: LocalDevLoginProps) {
  const [tokenInputValue, setTokenInputValue] = useState("");
  const [copied, setCopied] = useState(false);
  const [parseError, setParseError] = useState("");

  const productionUrl = getApiBaseUrl();
  const tokenCommand = `document.cookie`;

  const copyCommand = async () => {
    await navigator.clipboard.writeText(tokenCommand);
    setCopied(true);
    setTimeout(() => setCopied(false), COPY_FEEDBACK_DURATION_MS);
  };

  const handleLogin = async () => {
    const input = tokenInputValue.trim();
    if (!input) return;

    setParseError("");

    const { idToken, refreshToken, error } = parseCookieString(input);

    if (error) {
      setParseError(error);
      return;
    }

    if (!idToken) {
      setParseError("No token found");
      return;
    }

    storeTokens(idToken, refreshToken);

    const claims = parseJwtClaims(idToken);
    if (isTokenExpired(claims) && refreshToken) {
      const refreshed = await refreshStoredToken();
      if (refreshed) {
        onLogin(refreshed, true);
      } else {
        onLogin(idToken, false);
      }
    } else {
      onLogin(idToken, Boolean(refreshToken));
    }
  };

  return (
    <div className="flex flex-col items-center gap-4 w-full max-w-lg px-4">
      <div className="text-center text-sm text-zinc-400">
        <p>Development mode</p>
      </div>

      <div className="w-full">
        <p className="text-xs text-zinc-500 mb-2"># 1. Log in to production:</p>
        <a
          href={productionUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="block w-full rounded-lg bg-zinc-900 px-4 py-3 text-sm text-[var(--nvidia-green)] hover:bg-zinc-800 transition-colors break-all"
        >
          {productionUrl} ↗
        </a>
      </div>

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
              <Check className="h-4 w-4 text-[var(--nvidia-green)]" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>

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
          className="w-full px-4 py-2.5 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-100 text-sm font-mono placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-[var(--nvidia-green)] focus:border-transparent"
        />
        {parseError && (
          <p className="text-xs text-red-400 mt-1">{parseError}</p>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={handleLogin}
          disabled={!tokenInputValue.trim()}
          className="rounded-lg bg-[var(--nvidia-green)] px-6 py-2.5 text-sm font-medium text-black hover:bg-[var(--nvidia-green-light)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Log In
        </button>
        <button
          onClick={onSkip}
          className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          Continue without login →
        </button>
      </div>
    </div>
  );
}

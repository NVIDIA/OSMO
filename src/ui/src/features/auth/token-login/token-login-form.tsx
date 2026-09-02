// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// SPDX-License-Identifier: Apache-2.0

"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";

import { NvidiaLogo } from "@/components/chrome/nvidia-logo";
import { Button } from "@/components/shadcn/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/shadcn/card";
import { Input } from "@/components/shadcn/input";
import { ThemeToggle } from "@/components/theme-toggle";

interface LoginContext {
  transaction_id: string;
  csrf_token: string;
  submit_url: string;
}

export function isSafeContinuation(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("/api/auth/oidc/authorize/complete?") && !value.startsWith("//");
}

export function loginContextUrl(transactionId: string): string {
  return `/api/auth/oidc/login-context?transaction_id=${encodeURIComponent(transactionId)}`;
}

export function TokenLoginForm() {
  const searchParams = useSearchParams();
  const transactionId = searchParams.get("transaction_id");
  const [loginContext, setLoginContext] = useState<LoginContext | null>(null);
  const [token, setToken] = useState("");
  const [loadingContext, setLoadingContext] = useState(Boolean(transactionId));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(transactionId ? "" : "This sign-in request is missing or invalid.");
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!transactionId) {
      return;
    }
    const controller = new AbortController();
    void fetch(loginContextUrl(transactionId), {
      credentials: "include",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("invalid login transaction");
        }
        return (await response.json()) as LoginContext;
      })
      .then((context) => {
        if (context.transaction_id !== transactionId || context.submit_url !== "/api/auth/oidc/login") {
          throw new Error("invalid login context");
        }
        setLoginContext(context);
        setLoadingContext(false);
      })
      .catch((fetchError: unknown) => {
        if (fetchError instanceof DOMException && fetchError.name === "AbortError") {
          return;
        }
        setError("This sign-in request expired or belongs to another browser.");
        setLoadingContext(false);
      });
    return () => controller.abort();
  }, [transactionId]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!loginContext || !token || submitting) {
      return;
    }
    setSubmitting(true);
    setError("");
    const submittedToken = token;
    setToken("");
    try {
      const response = await fetch(loginContext.submit_url, {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transaction_id: loginContext.transaction_id,
          csrf_token: loginContext.csrf_token,
          token: submittedToken,
        }),
      });
      const payload = (await response.json()) as { continue_url?: unknown };
      if (!response.ok || !isSafeContinuation(payload.continue_url)) {
        throw new Error("login rejected");
      }
      window.location.assign(payload.continue_url);
    } catch {
      setError("The token is invalid or expired. Check it and try again.");
      setSubmitting(false);
      requestAnimationFrame(() => errorRef.current?.focus());
    }
  }

  const unavailable = loadingContext || !loginContext;

  return (
    <main className="bg-muted/30 relative flex min-h-screen items-center justify-center px-4 py-12">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader className="text-center">
          <div className="mb-2 flex items-center justify-center gap-3">
            <NvidiaLogo
              width={42}
              height={30}
            />
            <span className="text-2xl font-semibold tracking-tight">OSMO</span>
          </div>
          <CardTitle className="text-xl">Sign in with a personal access token</CardTitle>
          <CardDescription>
            Paste an existing OSMO token. It is sent directly to the OSMO service and is not included in a URL or
            browser storage.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error ? (
            <div
              ref={errorRef}
              tabIndex={-1}
              role="alert"
              aria-live="assertive"
              className="border-destructive/40 bg-destructive/10 text-destructive mb-4 rounded-md border p-3 text-sm"
            >
              {error}
            </div>
          ) : null}
          <form
            onSubmit={submit}
            className="space-y-4"
          >
            <div className="space-y-2">
              <label
                htmlFor="osmo-token"
                className="text-sm font-medium"
              >
                Personal access token
              </label>
              <Input
                id="osmo-token"
                type="password"
                name="token"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                disabled={unavailable || submitting}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                aria-describedby="token-help"
                aria-invalid={Boolean(error)}
                autoFocus
              />
              <p
                id="token-help"
                className="text-muted-foreground text-xs"
              >
                Create or manage tokens with the OSMO CLI using <code>osmo token</code>.
              </p>
            </div>
            <Button
              type="submit"
              className="w-full"
              disabled={unavailable || submitting || token.length === 0}
              aria-busy={submitting}
            >
              {loadingContext ? "Preparing sign in…" : submitting ? "Signing in…" : "Sign in"}
            </Button>
          </form>
          {error && !loginContext ? (
            <Button
              asChild
              variant="link"
              className="mt-3 w-full"
            >
              <Link href="/oauth2/start?rd=%2F">Start a new sign-in</Link>
            </Button>
          ) : null}
          <noscript>
            <p className="text-destructive mt-4 text-sm">
              JavaScript is required to submit the token securely from this page.
            </p>
          </noscript>
        </CardContent>
      </Card>
    </main>
  );
}

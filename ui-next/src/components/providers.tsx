"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
// React Query Devtools available via Chrome extension:
// https://chrome.google.com/webstore/detail/react-query-devtools/ooaplkfkopclpbpjgbhfjllmbjdpakoh
import { ThemeProvider } from "next-themes";
import { useState } from "react";
import { SidebarProvider } from "@/components/shell/sidebar-context";
import { AuthProvider } from "@/lib/auth/auth-provider";
import { UserProvider } from "@/lib/user-context";
import { ApiError } from "@/lib/api/fetcher";
import { QUERY_STALE_TIME_MS, QUERY_MAX_RETRY_DELAY_MS } from "@/lib/config";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: QUERY_STALE_TIME_MS,
            retry: (failureCount, error) => {
              // Check if error is an ApiError with retryable flag
              if (error instanceof ApiError) {
                return error.isRetryable && failureCount < 2;
              }
              // For other errors, don't retry (fail fast)
              return false;
            },
            retryDelay: (attemptIndex) =>
              Math.min(1000 * 2 ** attemptIndex, QUERY_MAX_RETRY_DELAY_MS),
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider
        attribute="class"
        defaultTheme="system"
        enableSystem
        disableTransitionOnChange
      >
        <AuthProvider>
          <UserProvider>
            <SidebarProvider>{children}</SidebarProvider>
          </UserProvider>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

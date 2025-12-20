"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { useState } from "react";
import { SidebarProvider } from "@/components/shell/sidebar-context";
import { AuthProvider } from "@/lib/auth/auth-provider";
import { UserProvider } from "@/lib/user-context";
import { ApiError } from "@/lib/api/fetcher";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000, // 1 minute
            retry: (failureCount, error) => {
              // Check if error is an ApiError with retryable flag
              if (error instanceof ApiError) {
                return error.isRetryable && failureCount < 2;
              }
              // For other errors, don't retry (fail fast)
              return false;
            },
            // Reduce retry delay for faster feedback
            retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 5000),
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

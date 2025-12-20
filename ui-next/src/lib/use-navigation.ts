"use client";

import { useMemo } from "react";
import { useUser } from "./user-context";
import { buildNavigation, type Navigation } from "./navigation";

interface UseNavigationResult extends Navigation {
  isLoading: boolean;
}

/**
 * Hook to get navigation for the current user.
 *
 * Navigation items are defined statically in navigation.ts.
 * The Admin section is conditionally included based on the
 * user's isAdmin flag from the backend.
 */
export function useNavigation(): UseNavigationResult {
  const { user, isLoading } = useUser();

  const navigation = useMemo(() => {
    // isAdmin comes from the backend - no hardcoding
    const isAdmin = user?.isAdmin ?? false;
    return buildNavigation(isAdmin);
  }, [user?.isAdmin]);

  return {
    ...navigation,
    isLoading,
  };
}

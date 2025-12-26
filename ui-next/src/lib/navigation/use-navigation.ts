/**
 * Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
 */

"use client";

import { useMemo } from "react";
import { useUser } from "@/lib/auth";
import { buildNavigation, type Navigation } from "./config";

interface UseNavigationResult extends Navigation {
  isLoading: boolean;
}

/**
 * Hook to get navigation for the current user.
 *
 * Navigation items are defined statically in config.ts.
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

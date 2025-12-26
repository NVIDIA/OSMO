/**
 * Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
 */

/**
 * Navigation Module
 *
 * Provides navigation configuration and hooks for the application shell.
 *
 * - config.ts: Static navigation data (routes, icons, labels)
 * - use-navigation.ts: Hook that builds navigation based on user role
 */

// Navigation data and types
export { buildNavigation, type NavItem, type NavSection, type Navigation } from "./config";

// Navigation hook
export { useNavigation } from "./use-navigation";

// Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

/**
 * Shell Components
 *
 * Route-level shell management for the workflow detail page.
 * Handles persistent shell sessions across task/group navigation.
 */

export { ShellContainer, type ShellContainerProps } from "./ShellContainer";
export { ShellPortalProvider, useShellPortal } from "./ShellPortalContext";

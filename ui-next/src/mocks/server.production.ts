// Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

/**
 * Production MSW Server Stub
 *
 * This is a no-op version of the MSW server that's swapped in during production builds.
 * It ensures zero MSW/mock code is included in the production server bundle.
 *
 * The swap is configured in next.config.ts via turbopack.resolveAlias.
 */

export const server = {
  listen: () => {
    // No-op in production
  },
  close: () => {
    // No-op in production
  },
};

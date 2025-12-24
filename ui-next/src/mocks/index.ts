// Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

/**
 * MSW Mock API
 *
 * Usage:
 * 1. Set NEXT_PUBLIC_MOCK_API=true in .env.local
 * 2. Or toggle "Use mock data" in the dev login page
 * 3. Run `pnpm scrape` to populate testdata/
 *
 * See: external/ui-next-design/docs/HERMETIC_DEV.md
 */

export { handlers } from "./handlers";
export { initMocking } from "./browser";

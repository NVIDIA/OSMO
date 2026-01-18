// Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

/**
 * Mock volume configuration types.
 * Shared between server actions and client code.
 */

export interface MockVolumes {
  workflows: number;
  pools: number;
  resourcesPerPool: number;
  resourcesGlobal: number;
  buckets: number;
  datasets: number;
}

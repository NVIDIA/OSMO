// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

// Package ray is the Phase 3 placeholder for the Ray runtime (KubeRay operator).
//
// When implemented, this package will:
//
//   - Decode RayRuntimeConfig from OSMOTaskGroupSpec.RuntimeConfig
//   - Render a ray.io/v1 RayCluster (Mode == "cluster") or RayJob (Mode == "job")
//   - Map RayCluster .status.state and RayJob .status.jobStatus into the normalized phase
//
// The reconciler will build on controller/runtimes/generic.
package ray

// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

// Package nim is the Phase 3 placeholder for the NIM (NVIDIA Inference Microservice) runtime.
//
// When implemented, this package will:
//
//   - Decode KAIRuntimeConfig from OSMOTaskGroupSpec.RuntimeConfig (it'll be
//     NIMRuntimeConfig from api/v1alpha1/runtime_others.go)
//   - Render a NIMService CR (apps.nvidia.com/v1alpha1, owned by the NIM Operator)
//   - Optionally render a PersistentVolumeClaim + HF download Job for pre-staged weights
//     (see inference/nim-operator/ in the parent repo for the working pattern)
//   - Map NIMService .status.conditions[?(@.type=="Ready")] to OSMOTaskGroup.Status.Phase
//
// The reconciler will build on controller/runtimes/generic (the Generic CRD Reconciler)
// rather than re-implementing object lifecycle from scratch.
//
// To enable: implement Reconciler and StatusMapper here, export New(), and register the
// factory in cmd/controller/main.go's runtime map.
package nim

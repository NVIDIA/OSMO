// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

// Package operator hosts the gRPC Operator Service: the per-cluster control-plane gateway
// the OSMO API server uses to write OSMOTaskGroup CRs and observe their status.
//
// The gRPC contract is defined in proto/operator.proto; generated Go bindings live under
// proto/ once `protoc` has been run (see ../README.md). Phase 1 keeps the server skeleton
// here; the full implementation lives in cmd/operator/.
//
// Holding K8s credentials here (not in the API server) is the key separation: the API
// server is K8s-agnostic Python; cluster access is brokered through this Go service. In
// Phase 2 the same service learns to dispatch by cluster_id across many backend clusters.
package operator

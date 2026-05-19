// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

// Package netmaker is the Phase 5 placeholder for cross-cluster service discovery via a
// self-hosted Netmaker / Nebula WireGuard mesh.
//
// When implemented:
//
//   - Expose registers the Service into the mesh's DNS (Netmaker has its own DNS plane).
//     There's no K8s-native ServiceExport equivalent in Netmaker, so the mesh integration
//     may rely on an external-dns hook or a sidecar that watches Services and pushes
//     records.
//   - Unexpose removes the DNS record.
//
// Best fit for deployments that need the lowest per-packet overhead and full self-hosted
// control (no Tailscale-protocol dependency).
package netmaker

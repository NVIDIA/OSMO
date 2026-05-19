// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

// Package tailnet is the Phase 3 placeholder for cross-cluster service discovery via
// Headscale + DERP (self-hosted Tailscale-protocol mesh).
//
// When implemented:
//
//   - Expose annotates the Service with tailscale.com/expose: "true" and
//     tailscale.com/hostname so the Tailscale Kubernetes Operator publishes it onto the
//     tailnet. Peer clusters resolve it via MagicDNS.
//   - Unexpose strips the annotations.
//
// Best fit for deployments that include edge clusters (Jetson, Orin) behind NAT because
// DERP relays handle hole-punching automatically.
package tailnet

// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

// Package submariner is the Phase 2 placeholder for cross-cluster service discovery via
// Submariner's Multi-Cluster Services API (KEP-1645).
//
// When implemented:
//
//   - Expose creates a multicluster.x-k8s.io/v1alpha1 ServiceExport CR alongside each
//     Service that should be reachable cross-cluster. Lighthouse DNS in peer clusters then
//     resolves "<service>.<ns>.svc.clusterset.local" to the local ClusterIP via Submariner
//     gateways.
//   - Unexpose deletes the ServiceExport.
//
// Reference: https://submariner.io/getting-started/
package submariner

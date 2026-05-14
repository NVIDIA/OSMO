/*
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

SPDX-License-Identifier: Apache-2.0
*/

// Package servicediscovery is the cross-cluster service exposure plug point
// described in PROJ-taskgroup-crd.md "Cross-cluster networking".
//
// Phase 1 defines the interface only. Phase 2 ships the first concrete
// implementation (Submariner ServiceExport). Phase 3 adds Tailnet
// (tailscale.com/expose annotations), Phase 5 adds Netmaker, and the
// catch-all Ingress+mTLS implementation lands alongside whichever phase
// first needs it.
//
// Pluggability matters because no single mesh fits every deployment: pure
// datacenter clusters want Submariner's MCS standard, edge clusters need
// Tailnet's automatic NAT traversal, latency-critical deployments want
// Netmaker's per-node WireGuard. The Reconciler picks the mesh at startup
// from the cluster's network_config; the OSMOTaskGroup controller calls
// Expose/Unexpose without caring which mesh is in use.
package servicediscovery

import (
	"context"

	corev1 "k8s.io/api/core/v1"
)

// ClusterNetworkConfig is the deserialized network_config column from the
// backend_cluster table in Postgres. Phase 1 does not populate this; Phase
// 2 wires it in when multi-cluster dispatch lands.
type ClusterNetworkConfig struct {
	// Type names the mesh integration: "submariner", "tailnet", "netmaker",
	// "ingress".
	Type string

	// Config is mesh-specific options (cluster set ID, tailnet domain,
	// ingress wildcard). The chosen Reconciler is responsible for decoding
	// the keys it needs.
	Config map[string]string
}

// Reconciler is the plug point for exposing in-cluster Services across
// cluster boundaries through whatever mesh the deployment uses. Each
// implementation is responsible for the mesh-native artifact (a
// ServiceExport CR, a Tailscale annotation, an Ingress + Certificate,
// etc.).
//
// Idempotency requirement: Expose and Unexpose must be safe to call
// repeatedly. The mesh layer handles its own dedup; this is just OSMO's
// declarative wrapper.
type Reconciler interface {
	// Expose ensures the named Service is reachable from peer clusters
	// participating in the mesh. The implementation chooses the
	// mesh-appropriate exposure mechanism.
	Expose(ctx context.Context, svc *corev1.Service, cluster *ClusterNetworkConfig) error

	// Unexpose tears down the cross-cluster exposure created by Expose. It
	// must succeed even if Expose was never called (idempotent cleanup).
	Unexpose(ctx context.Context, svc *corev1.Service, cluster *ClusterNetworkConfig) error
}

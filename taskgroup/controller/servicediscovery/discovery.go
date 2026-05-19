// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

// Package servicediscovery defines the contract a cluster mesh implements to expose
// services across cluster boundaries. Implementations live in subpackages:
//
//   - submariner/ (Phase 2 default — Multi-Cluster Services API)
//   - tailnet/    (Phase 3 — Tailscale/Headscale + DERP)
//   - netmaker/   (Phase 5 — Netmaker/Nebula WireGuard mesh)
//
// The controller is unaware of which mesh is in use; it calls Reconciler.Expose() when
// a task group is created and Reconciler.Unexpose() when one is deleted. Each mesh
// implementation creates whatever mesh-native artifact is required (a ServiceExport CR
// for Submariner, a Service annotation for Tailnet, etc.).
//
// In Phase 1 the controller is single-cluster and skips this layer entirely. The
// interface is defined now so Phase 2 plugs in without touching controller code.
package servicediscovery

import (
	"context"

	corev1 "k8s.io/api/core/v1"
)

// Reconciler is the contract a mesh implements to make a cluster-local Service reachable
// from peer clusters.
//
// Implementations are stateless and idempotent: Expose may be called multiple times for
// the same Service. Unexpose must be safe to call even if Expose was never called.
type Reconciler interface {
	// Name returns the mesh identifier (e.g. "submariner", "tailnet"). Used for
	// dispatching and metric labeling.
	Name() string

	// Expose makes the given Service reachable cross-cluster via the mesh. The Service is
	// already created in the local cluster; this method only adds the mesh-specific
	// artifact (a ServiceExport CR, a Tailscale annotation, etc.).
	Expose(ctx context.Context, svc *corev1.Service) error

	// Unexpose removes whatever Expose created. Called when the owning OSMOTaskGroup is
	// deleted.
	Unexpose(ctx context.Context, svc *corev1.Service) error
}

// ClusterNetworkConfig is the deployment-specific configuration the controller passes to a
// service-discovery reconciler at startup. It mirrors the network_config column on the
// backend_cluster table in the API server's Postgres.
type ClusterNetworkConfig struct {
	// Type selects which mesh implementation handles this cluster. Empty string means
	// "no mesh"; the controller skips service discovery entirely.
	Type string `json:"type"`

	// Config is the mesh-specific configuration blob. Each implementation knows the
	// shape its own configuration takes.
	Config map[string]string `json:"config,omitempty"`
}

// Registry holds the set of mesh implementations available at startup. The controller's
// service-discovery layer chooses one based on its ClusterNetworkConfig.Type.
type Registry struct {
	reconcilers map[string]Reconciler
}

// NewRegistry returns an empty registry. Register implementations before starting the
// controller.
func NewRegistry() *Registry {
	return &Registry{reconcilers: make(map[string]Reconciler)}
}

// Register adds a mesh implementation under its Name().
func (r *Registry) Register(rec Reconciler) {
	r.reconcilers[rec.Name()] = rec
}

// Resolve returns the implementation for the named mesh, or nil if none is registered.
// Callers should treat nil as "this cluster has no mesh; skip service discovery".
func (r *Registry) Resolve(name string) Reconciler {
	if name == "" {
		return nil
	}
	return r.reconcilers[name]
}

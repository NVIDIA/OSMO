// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

// Package runtimes defines the plug-in contract every workload runtime must satisfy.
// Implementations live in subpackages (currently only kai). The dispatcher selects one
// based on OSMOTaskGroupSpec.RuntimeType.
package runtimes

import (
	"context"

	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/builder"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/reconcile"

	v1alpha1 "github.com/nvidia/osmo/taskgroup/api/v1alpha1"
)

// StatusReporter is the contract the top-level controller uses to push status outward
// (typically to the Operator Service). Defined here so neither the top-level controller
// nor the session client depend on each other.
type StatusReporter interface {
	Report(ctx context.Context, otg *v1alpha1.OSMOTaskGroup) error
}

// Reconciler converts the desired state described by an OSMOTaskGroup into runtime-native
// Kubernetes objects (Pods + PodGroup for KAI; a NIMService for NIM; a RayCluster for Ray; ...).
//
// Implementations should be idempotent: Reconcile may be invoked many times for the same
// generation of the input. Each implementation also owns its child objects via owner
// references so cascade delete works without controller-side bookkeeping.
type Reconciler interface {
	// Reconcile is called whenever the OSMOTaskGroup is created or updated.
	Reconcile(ctx context.Context, otg *v1alpha1.OSMOTaskGroup) (reconcile.Result, error)

	// Finalize is called when the OSMOTaskGroup is being deleted, before children are
	// cascade-deleted. Implementations should make a best effort to capture terminal
	// state (logs, exit codes) before returning. Errors here are logged but do not
	// block deletion past the configured timeout.
	Finalize(ctx context.Context, otg *v1alpha1.OSMOTaskGroup) error
}

// StatusMapper rolls up runtime-native status into the normalized
// OSMOTaskGroupStatus.{Phase, Conditions, Tasks}.
//
// The mapper is invoked on every reconcile pass, including periodic reconciliation.
// Implementations should be cheap and read-only; persistence is the controller's job.
type StatusMapper interface {
	Map(ctx context.Context, otg *v1alpha1.OSMOTaskGroup) (v1alpha1.OSMOTaskGroupStatus, error)
}

// WatchRegistrar is an optional contract a runtime can implement to declare which
// resources its reconciler needs to be re-triggered on. The top-level controller calls
// RegisterWatches once at startup for every registered runtime, so adding a runtime that
// owns a different child kind (e.g. a NIMService CR) does not require editing the
// top-level controller.
type WatchRegistrar interface {
	RegisterWatches(b *builder.Builder) *builder.Builder
}

// Runtime bundles the two interfaces. Dispatcher's registry stores values of this type.
type Runtime struct {
	Reconciler   Reconciler
	StatusMapper StatusMapper

	// Watches, when non-nil, is invoked by the top-level controller's
	// SetupWithManager to attach the runtime's required watches to the builder.
	// Runtimes whose only child is a Pod can leave this nil — the controller installs
	// a default `Owns(&corev1.Pod{})` watch.
	Watches func(b *builder.Builder) *builder.Builder
}

// Dependencies are the shared resources a runtime constructor needs at controller startup.
type Dependencies struct {
	Client    client.Client
	Namespace string
}

// SetupBuilder is the entrypoint the top-level controller uses to attach a runtime's
// watches. Provided here so callers don't import controller-runtime/builder directly.
func SetupBuilder(mgr ctrl.Manager) *builder.Builder {
	return ctrl.NewControllerManagedBy(mgr).For(&v1alpha1.OSMOTaskGroup{})
}

// Factory is the constructor type. Each runtime package exports a Factory the controller
// invokes at startup to instantiate the runtime with shared dependencies.
type Factory func(deps Dependencies) (Runtime, error)

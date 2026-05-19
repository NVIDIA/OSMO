// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

// Package runtimes defines the plug-in contract every workload runtime must satisfy.
// Implementations live in subpackages (kai, generic, nim, ray, dynamo, grove). The
// dispatcher selects one based on OSMOTaskGroupSpec.RuntimeType.
package runtimes

import (
	"context"

	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/reconcile"

	v1alpha1 "github.com/nvidia/osmo/taskgroup/api/v1alpha1"
)

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

// Runtime bundles the two interfaces. Dispatcher's registry stores values of this type.
type Runtime struct {
	Reconciler   Reconciler
	StatusMapper StatusMapper
}

// Dependencies are the shared resources a runtime constructor needs at controller startup.
// Constructors are conventionally named New() and accept this struct so adding a new
// dependency does not change the constructor signature of every runtime.
type Dependencies struct {
	Client    client.Client
	Namespace string
	// Future: ServiceDiscovery, LogSink, MetricsRecorder, ...
}

// Factory is the constructor type. Each runtime package exports a Factory the controller
// invokes at startup to instantiate the runtime with shared dependencies.
type Factory func(deps Dependencies) (Runtime, error)

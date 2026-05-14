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

// Package dispatcher routes OSMOTaskGroup reconciliation to per-runtime
// reconcilers. This is the extensibility surface described in
// projects/PROJ-taskgroup-crd/PROJ-taskgroup-crd.md "Controller design":
// adding a new runtime is registering a Reconciler + StatusMapper here.
//
// Phase 1 ships with only the KAI runtime registered. The dispatcher,
// generic CRD reconciler skeleton, and service-discovery interface are all
// defined now so Phase 2/3/5 plug in additional implementations without
// touching Phase 1 code.
package dispatcher

import (
	"context"
	"fmt"
	"sync"
	"time"

	workflowv1alpha1 "go.corp.nvidia.com/osmo/apis/workflow/v1alpha1"
)

// Result is the outcome of one Reconciler.Reconcile call.
//
// This mirrors sigs.k8s.io/controller-runtime's reconcile.Result so a
// future migration to controller-runtime is a straight type swap rather
// than a behavioral change.
type Result struct {
	// Requeue, if true, schedules an immediate re-enqueue. Use sparingly;
	// prefer RequeueAfter with a short backoff when the desired state
	// depends on external progress.
	Requeue bool

	// RequeueAfter, if > 0, schedules a delayed re-enqueue. Zero means
	// "done; only re-reconcile on observed change."
	RequeueAfter time.Duration
}

// Reconciler is the per-runtime plugin contract. The dispatcher invokes the
// reconciler whose runtime type matches the CR's spec.runtimeType.
//
// Idempotency requirement: every reconcile must converge the cluster on the
// CR's desired state regardless of how many times it has been called before
// or what intermediate state exists. Returning an error triggers
// rate-limited re-enqueue via the underlying work queue.
type Reconciler interface {
	// Reconcile drives one pass of cluster state toward the CR's spec.
	// Returning a non-zero Result schedules a follow-up reconcile.
	Reconcile(ctx context.Context, otg *workflowv1alpha1.OSMOTaskGroup) (Result, error)
}

// StatusMapper computes a normalized OSMOTaskGroupStatus from cluster state.
//
// Each runtime's StatusMapper is the *only* place runtime-specific status
// shapes are interpreted. Mapping rules per runtime are documented in
// PROJ-taskgroup-crd.md "Status mapping". The output is a Phase plus
// optional Conditions plus an opaque RuntimeStatus payload that consumers
// can ignore unless they need runtime-specific detail.
type StatusMapper interface {
	Map(ctx context.Context, otg *workflowv1alpha1.OSMOTaskGroup) (workflowv1alpha1.OSMOTaskGroupStatus, error)
}

// Runtime bundles a Reconciler with its StatusMapper. The pair is the unit
// of runtime extensibility — register one of these and the dispatcher
// handles routing.
type Runtime struct {
	Reconciler   Reconciler
	StatusMapper StatusMapper
}

// Dispatcher is the runtime registry. It is safe for concurrent reads after
// Register calls complete; callers must finish all Register calls before
// starting reconciliation.
type Dispatcher struct {
	mu       sync.RWMutex
	runtimes map[workflowv1alpha1.RuntimeType]Runtime
}

// New returns an empty Dispatcher. Callers must Register at least one
// runtime before calling Reconcile.
func New() *Dispatcher {
	return &Dispatcher{
		runtimes: make(map[workflowv1alpha1.RuntimeType]Runtime),
	}
}

// Register installs a runtime in the dispatcher. Re-registering the same
// runtime type replaces the previous one; this is intentional for tests
// that swap in fakes.
func (d *Dispatcher) Register(t workflowv1alpha1.RuntimeType, r Runtime) {
	if r.Reconciler == nil || r.StatusMapper == nil {
		panic(fmt.Sprintf("dispatcher: runtime %q requires both Reconciler and StatusMapper", t))
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	d.runtimes[t] = r
}

// Get returns the registered runtime for a type. The second return value is
// false if no runtime is registered, in which case callers should treat the
// CR as a configuration error and surface it via Status.Conditions.
func (d *Dispatcher) Get(t workflowv1alpha1.RuntimeType) (Runtime, bool) {
	d.mu.RLock()
	defer d.mu.RUnlock()
	r, ok := d.runtimes[t]
	return r, ok
}

// Reconcile dispatches to the runtime named by spec.runtimeType. If no
// matching runtime is registered the call returns ErrUnknownRuntime, which
// the work queue treats as a permanent error (no retry).
func (d *Dispatcher) Reconcile(ctx context.Context, otg *workflowv1alpha1.OSMOTaskGroup) (Result, error) {
	rt, ok := d.Get(otg.Spec.RuntimeType)
	if !ok {
		return Result{}, fmt.Errorf("%w: %q", ErrUnknownRuntime, otg.Spec.RuntimeType)
	}
	return rt.Reconciler.Reconcile(ctx, otg)
}

// MapStatus computes status using the matching runtime's StatusMapper.
func (d *Dispatcher) MapStatus(ctx context.Context, otg *workflowv1alpha1.OSMOTaskGroup) (workflowv1alpha1.OSMOTaskGroupStatus, error) {
	rt, ok := d.Get(otg.Spec.RuntimeType)
	if !ok {
		return workflowv1alpha1.OSMOTaskGroupStatus{}, fmt.Errorf("%w: %q", ErrUnknownRuntime, otg.Spec.RuntimeType)
	}
	return rt.StatusMapper.Map(ctx, otg)
}

// ErrUnknownRuntime is returned when an OSMOTaskGroup references a
// runtimeType with no registered plugin. Surfaced to the user via
// Status.Conditions as a permanent configuration error.
var ErrUnknownRuntime = errUnknownRuntime{}

type errUnknownRuntime struct{}

func (errUnknownRuntime) Error() string { return "unknown runtime" }

// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

package session

import (
	"context"

	"k8s.io/client-go/util/workqueue"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/event"
	"sigs.k8s.io/controller-runtime/pkg/handler"
	"sigs.k8s.io/controller-runtime/pkg/predicate"

	v1alpha1 "github.com/nvidia/osmo/taskgroup/api/v1alpha1"
)

// StatusPublisher is a controller-runtime EventHandler that turns OSMOTaskGroup events
// into PushStatus calls on the session client. Plug it into the TaskGroup Reconciler's
// SetupWithManager so the controller emits status updates over the gRPC stream as soon
// as it writes them locally.
//
// Wiring (in cmd/controller/main.go after creating the session client):
//
//	pub := &session.StatusPublisher{Client: sessionClient}
//	ctrl.NewControllerManagedBy(mgr).
//	    For(&v1alpha1.OSMOTaskGroup{}, builder.WithEventFilter(pub.Predicate())).
//	    ...
//
// Or alternatively as a separate cluster-wide watch that doesn't trigger reconciles —
// see WatchAndPublish below.
type StatusPublisher struct {
	Client *Client
}

// Create/Update/Delete are EventHandler hooks. We treat them all as "send the current
// status over the wire." Generic is unused for this resource.
var _ handler.EventHandler = (*StatusPublisher)(nil)

// Create implements handler.EventHandler.
func (p *StatusPublisher) Create(_ context.Context, e event.CreateEvent, _ workqueue.RateLimitingInterface) {
	p.publish(e.Object)
}

// Update implements handler.EventHandler.
func (p *StatusPublisher) Update(_ context.Context, e event.UpdateEvent, _ workqueue.RateLimitingInterface) {
	p.publish(e.ObjectNew)
}

// Delete implements handler.EventHandler.
func (p *StatusPublisher) Delete(_ context.Context, e event.DeleteEvent, _ workqueue.RateLimitingInterface) {
	// On delete, push the final state. The control side learns that the resource is
	// gone via its own watch; the status push is informational.
	p.publish(e.Object)
}

// Generic implements handler.EventHandler.
func (p *StatusPublisher) Generic(_ context.Context, _ event.GenericEvent, _ workqueue.RateLimitingInterface) {
}

func (p *StatusPublisher) publish(obj client.Object) {
	otg, ok := obj.(*v1alpha1.OSMOTaskGroup)
	if !ok || p.Client == nil {
		return
	}
	p.Client.PushStatus(otg)
}

// Predicate ensures publishes happen only when status actually changes, not on every
// spec rev / metadata churn. Pair with WithEventFilter.
func (p *StatusPublisher) Predicate() predicate.Predicate {
	return predicate.Funcs{
		CreateFunc: func(event.CreateEvent) bool { return true },
		UpdateFunc: func(e event.UpdateEvent) bool {
			oldOtg, oldOK := e.ObjectOld.(*v1alpha1.OSMOTaskGroup)
			newOtg, newOK := e.ObjectNew.(*v1alpha1.OSMOTaskGroup)
			if !oldOK || !newOK {
				return false
			}
			// Push when phase changes or when generation changes (spec edits, rare).
			return oldOtg.Status.Phase != newOtg.Status.Phase ||
				oldOtg.Status.ObservedGeneration != newOtg.Status.ObservedGeneration
		},
		DeleteFunc:  func(event.DeleteEvent) bool { return true },
		GenericFunc: func(event.GenericEvent) bool { return false },
	}
}

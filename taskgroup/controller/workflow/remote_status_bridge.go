// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

package workflow

import (
	"context"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/event"
	"sigs.k8s.io/controller-runtime/pkg/log"
	"sigs.k8s.io/controller-runtime/pkg/reconcile"

	v1alpha1 "github.com/nvidia/osmo/taskgroup/api/v1alpha1"
	"github.com/nvidia/osmo/taskgroup/operator"
)

// RemoteStatusSource ties together (a) the operator-service StatusBus, (b) the
// RemoteStatusCache the Workflow Controller reads on reconcile, and (c) the
// controller-runtime event channel that triggers a reconcile for the affected workflow.
//
// One goroutine subscribes to the bus, writes events to the cache, and emits a
// reconcile.Request for the matching workflow. The Workflow Controller's
// SetupWithManager attaches `Events` via .WatchesRawSource(source.Channel{...}).
type RemoteStatusSource struct {
	Cache  *RemoteStatusCache
	Events chan event.GenericEvent
}

// StartRemoteStatusBridge wires the bus → cache → reconcile.Request channel. Returns
// the source for the Workflow Controller's SetupWithManager. The goroutine runs until
// ctx is cancelled.
func StartRemoteStatusBridge(ctx context.Context, c client.Client, bus *operator.StatusBus, cache *RemoteStatusCache) *RemoteStatusSource {
	src := &RemoteStatusSource{
		Cache:  cache,
		Events: make(chan event.GenericEvent, 64),
	}
	logger := log.FromContext(ctx).WithName("remote-status-bridge")
	events := make(chan operator.StatusEvent, 64)
	cancel := bus.Subscribe(events)

	go func() {
		defer cancel()
		for {
			select {
			case <-ctx.Done():
				return
			case ev := <-events:
				if ev.Event == nil {
					continue
				}
				src.Cache.Put(ev.ClusterID, ev.Event)
				wfName, ok := findWorkflowForOTG(ctx, c, ev.Event.GetNamespace(), ev.Event.GetName(), ev.ClusterID)
				if !ok {
					logger.V(1).Info("event dropped: no matching workflow",
						"cluster", ev.ClusterID, "otg", ev.Event.GetName())
					continue
				}
				// Generic event drives a reconcile of the parent workflow. The
				// reconciler reads the cache as its single source of remote truth, so
				// dropping the eager trigger is safe — the cache write already happened
				// above, and the periodic reconcile will pick the state up. Never block
				// here, otherwise a slow workflow reconciler could backpressure the bus.
				select {
				case src.Events <- event.GenericEvent{
					Object: &v1alpha1.OSMOWorkflow{
						ObjectMeta: metav1.ObjectMeta{
							Name:      wfName,
							Namespace: ev.Event.GetNamespace(),
						},
					},
				}:
				case <-ctx.Done():
					return
				default:
					logger.V(1).Info("dropped reconcile trigger; events channel full",
						"workflow", wfName, "namespace", ev.Event.GetNamespace())
				}
			}
		}
	}()
	return src
}

// findWorkflowForOTG resolves a remote OTG (cluster, namespace, name) to its parent
// workflow's name. We list workflows in the namespace and match (otgName + cluster)
// against each group. Returns "", false if no match — could be cross-tenant traffic
// or an OTG from a workflow already deleted.
func findWorkflowForOTG(ctx context.Context, c client.Client, namespace, name, clusterID string) (string, bool) {
	var wfs v1alpha1.OSMOWorkflowList
	if err := c.List(ctx, &wfs, client.InNamespace(namespace)); err != nil {
		return "", false
	}
	for i := range wfs.Items {
		w := &wfs.Items[i]
		for _, g := range w.Spec.Groups {
			if name == otgName(w.Name, g.Name) && g.Cluster == clusterID {
				return w.Name, true
			}
		}
	}
	return "", false
}

// MapWorkflow translates a GenericEvent (carrying a sentinel OSMOWorkflow shell) into
// the reconcile.Request the Workflow Controller wants. Wired via
// handler.EnqueueRequestsFromMapFunc in SetupWithManager.
func MapWorkflow(_ context.Context, obj client.Object) []reconcile.Request {
	return []reconcile.Request{{
		NamespacedName: types.NamespacedName{Name: obj.GetName(), Namespace: obj.GetNamespace()},
	}}
}

// coercePhase maps a wire-side phase string to a known v1alpha1.Phase. Unknown values
// fall back to PhasePending; the next event overwrites.
func coercePhase(s string) v1alpha1.Phase {
	switch v1alpha1.Phase(s) {
	case v1alpha1.PhasePending,
		v1alpha1.PhaseRunning,
		v1alpha1.PhaseSucceeded,
		v1alpha1.PhaseFailed,
		v1alpha1.PhaseTerminating:
		return v1alpha1.Phase(s)
	}
	return v1alpha1.PhasePending
}


// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

package workflow

import (
	"context"
	"testing"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	utilruntime "k8s.io/apimachinery/pkg/util/runtime"
	clientgoscheme "k8s.io/client-go/kubernetes/scheme"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"
	"sigs.k8s.io/controller-runtime/pkg/reconcile"

	v1alpha1 "github.com/nvidia/osmo/taskgroup/api/v1alpha1"
	"github.com/nvidia/osmo/taskgroup/operator"
)

func wfTestScheme(t *testing.T) *runtime.Scheme {
	t.Helper()
	s := runtime.NewScheme()
	utilruntime.Must(clientgoscheme.AddToScheme(s))
	utilruntime.Must(v1alpha1.AddToScheme(s))
	return s
}

// TestReconcileDelete_DispatchesRemoteDeleteAndRemovesFinalizer covers the finalizer
// contract: a workflow with one remote group recorded in status.Groups must trigger a
// DeleteOTG envelope to the registered session, then have its finalizer removed.
func TestReconcileDelete_DispatchesRemoteDeleteAndRemovesFinalizer(t *testing.T) {
	now := metav1.Now()
	wf := &v1alpha1.OSMOWorkflow{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "wf-1",
			Namespace:         "osmo-workflows",
			Finalizers:        []string{v1alpha1.FinalizerRemoteCleanup},
			DeletionTimestamp: &now,
		},
		Spec: v1alpha1.OSMOWorkflowSpec{
			Groups: []v1alpha1.WorkflowGroup{{
				Name: "g", Cluster: "backend-a", RuntimeType: v1alpha1.RuntimeKAI,
			}},
		},
		Status: v1alpha1.OSMOWorkflowStatus{
			Groups: map[string]v1alpha1.WorkflowGroupStatus{
				"g": {
					Phase: v1alpha1.PhaseRunning,
					TaskGroupRef: v1alpha1.TaskGroupRef{
						Cluster:   "backend-a",
						Namespace: "osmo-workflows",
						Name:      "wf-1-g",
					},
				},
			},
		},
	}

	scheme := wfTestScheme(t)
	k8s := fake.NewClientBuilder().WithScheme(scheme).
		WithObjects(wf).
		WithStatusSubresource(&v1alpha1.OSMOWorkflow{}).
		Build()

	reg := operator.NewSessionRegistry()
	sess := reg.Register("backend-a", 4)
	bus := &operator.CommandBus{Sessions: reg}

	r := &Reconciler{
		Client: k8s,
		Scheme: scheme,
		LocalDispatcher: &LocalDispatcher{Client: k8s, Namespace: "osmo-workflows"},
		RemoteResolver: func(clusterID string) (Dispatcher, error) {
			return &RemoteDispatcher{
				ClusterID: clusterID, Namespace: "osmo-workflows", Bus: bus,
			}, nil
		},
	}

	if _, err := r.Reconcile(context.Background(), reconcile.Request{
		NamespacedName: types.NamespacedName{Name: "wf-1", Namespace: "osmo-workflows"},
	}); err != nil {
		t.Fatalf("Reconcile: %v", err)
	}

	select {
	case env := <-sess.Drain():
		del := env.GetDelete()
		if del == nil {
			t.Fatalf("expected DeleteOTG envelope, got %T", env.Body)
		}
		if del.Namespace != "osmo-workflows" || del.Name != "wf-1-g" {
			t.Errorf("unexpected delete payload: %+v", del)
		}
	case <-time.After(time.Second):
		t.Fatal("no DeleteOTG envelope arrived")
	}

	var after v1alpha1.OSMOWorkflow
	if err := k8s.Get(context.Background(),
		types.NamespacedName{Name: "wf-1", Namespace: "osmo-workflows"}, &after); err != nil {
		// The fake client garbage-collects a deleting object once finalizers are gone.
		// That's the "success" outcome we want.
		return
	}
	for _, f := range after.Finalizers {
		if f == v1alpha1.FinalizerRemoteCleanup {
			t.Fatalf("finalizer was not removed: %v", after.Finalizers)
		}
	}
}

// TestReconcileDelete_FromDispatchIntentAnnotation covers the crash-window recovery
// path: even when status.Groups never recorded a TaskGroupRef (controller crashed
// between dispatch and status write), the dispatch-intent annotation lets
// reconcileDelete still emit DeleteOTG.
func TestReconcileDelete_FromDispatchIntentAnnotation(t *testing.T) {
	now := metav1.Now()
	wf := &v1alpha1.OSMOWorkflow{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "wf-2",
			Namespace:         "osmo-workflows",
			Finalizers:        []string{v1alpha1.FinalizerRemoteCleanup},
			DeletionTimestamp: &now,
			Annotations: map[string]string{
				dispatchIntentAnnotation("g"): "backend-a/wf-2-g",
			},
		},
		Spec: v1alpha1.OSMOWorkflowSpec{
			Groups: []v1alpha1.WorkflowGroup{{
				Name: "g", Cluster: "backend-a", RuntimeType: v1alpha1.RuntimeKAI,
			}},
		},
		// status.Groups intentionally empty — simulates pre-status-write crash.
	}

	scheme := wfTestScheme(t)
	k8s := fake.NewClientBuilder().WithScheme(scheme).
		WithObjects(wf).
		WithStatusSubresource(&v1alpha1.OSMOWorkflow{}).
		Build()

	reg := operator.NewSessionRegistry()
	sess := reg.Register("backend-a", 4)
	bus := &operator.CommandBus{Sessions: reg}

	r := &Reconciler{
		Client: k8s,
		Scheme: scheme,
		LocalDispatcher: &LocalDispatcher{Client: k8s, Namespace: "osmo-workflows"},
		RemoteResolver: func(clusterID string) (Dispatcher, error) {
			return &RemoteDispatcher{
				ClusterID: clusterID, Namespace: "osmo-workflows", Bus: bus,
			}, nil
		},
	}

	if _, err := r.Reconcile(context.Background(), reconcile.Request{
		NamespacedName: types.NamespacedName{Name: "wf-2", Namespace: "osmo-workflows"},
	}); err != nil {
		t.Fatalf("Reconcile: %v", err)
	}

	select {
	case env := <-sess.Drain():
		del := env.GetDelete()
		if del == nil {
			t.Fatalf("expected DeleteOTG envelope, got %T", env.Body)
		}
		if del.Name != "wf-2-g" || del.Namespace != "osmo-workflows" {
			t.Errorf("unexpected delete payload: %+v", del)
		}
	case <-time.After(time.Second):
		t.Fatal("no DeleteOTG envelope arrived from annotation-only target")
	}
}

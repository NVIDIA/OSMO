package taskgroup

import (
	"context"
	"testing"

	taskgroupv1alpha1 "example.com/taskgroup-phase1-standalone/api/taskgroup/v1alpha1"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"
	"sigs.k8s.io/controller-runtime/pkg/reconcile"
)

type recordingRuntime struct {
	validateCalled  bool
	reconcileCalled bool
	statusCalled    bool
}

func (r *recordingRuntime) Validate(_ context.Context, _ *taskgroupv1alpha1.OSMOTaskGroup) error {
	r.validateCalled = true
	return nil
}

func (r *recordingRuntime) ReconcileRuntime(_ context.Context, _ *taskgroupv1alpha1.OSMOTaskGroup) error {
	r.reconcileCalled = true
	return nil
}

func (r *recordingRuntime) MapStatus(_ context.Context, _ *taskgroupv1alpha1.OSMOTaskGroup) (taskgroupv1alpha1.OSMOTaskGroupStatus, error) {
	r.statusCalled = true
	return taskgroupv1alpha1.OSMOTaskGroupStatus{Phase: "Running"}, nil
}

func TestReconcilerDispatchesByRuntimeType(t *testing.T) {
	ctx := context.Background()
	scheme := newScheme(t)
	otg := validOTG("custom")
	kubeClient := fake.NewClientBuilder().
		WithScheme(scheme).
		WithStatusSubresource(&taskgroupv1alpha1.OSMOTaskGroup{}).
		WithObjects(otg).
		Build()
	runtimeHandler := &recordingRuntime{}
	reconciler := NewReconciler(kubeClient, scheme, map[string]RuntimeReconciler{
		"custom": runtimeHandler,
	})

	_, err := reconciler.Reconcile(ctx, reconcile.Request{NamespacedName: clientKey(otg)})
	if err != nil {
		t.Fatalf("Reconcile() error = %v", err)
	}
	if !runtimeHandler.validateCalled || !runtimeHandler.reconcileCalled || !runtimeHandler.statusCalled {
		t.Fatalf("runtime handler calls = validate:%v reconcile:%v status:%v",
			runtimeHandler.validateCalled,
			runtimeHandler.reconcileCalled,
			runtimeHandler.statusCalled)
	}
}

func TestReconcilerFailsUnsupportedRuntime(t *testing.T) {
	ctx := context.Background()
	scheme := newScheme(t)
	otg := validOTG("ray")
	kubeClient := fake.NewClientBuilder().
		WithScheme(scheme).
		WithStatusSubresource(&taskgroupv1alpha1.OSMOTaskGroup{}).
		WithObjects(otg).
		Build()
	reconciler := NewReconciler(kubeClient, scheme, map[string]RuntimeReconciler{})

	_, err := reconciler.Reconcile(ctx, reconcile.Request{NamespacedName: clientKey(otg)})
	if err != nil {
		t.Fatalf("Reconcile() error = %v", err)
	}
	updated := &taskgroupv1alpha1.OSMOTaskGroup{}
	if err := kubeClient.Get(ctx, clientKey(otg), updated); err != nil {
		t.Fatalf("Get() error = %v", err)
	}
	if updated.Status.Phase != "Failed" {
		t.Fatalf("status phase = %q, want Failed", updated.Status.Phase)
	}
}

func TestReconcilerIgnoresUnownedTaskGroup(t *testing.T) {
	ctx := context.Background()
	scheme := newScheme(t)
	otg := validOTG("custom")
	otg.Labels = nil
	kubeClient := fake.NewClientBuilder().
		WithScheme(scheme).
		WithStatusSubresource(&taskgroupv1alpha1.OSMOTaskGroup{}).
		WithObjects(otg).
		Build()
	runtimeHandler := &recordingRuntime{}
	reconciler := NewReconciler(kubeClient, scheme, map[string]RuntimeReconciler{
		"custom": runtimeHandler,
	})

	_, err := reconciler.Reconcile(ctx, reconcile.Request{NamespacedName: clientKey(otg)})
	if err != nil {
		t.Fatalf("Reconcile() error = %v", err)
	}
	if runtimeHandler.validateCalled || runtimeHandler.reconcileCalled || runtimeHandler.statusCalled {
		t.Fatalf("runtime handler was called for unowned OTG")
	}
	updated := &taskgroupv1alpha1.OSMOTaskGroup{}
	if err := kubeClient.Get(ctx, clientKey(otg), updated); err != nil {
		t.Fatalf("Get() error = %v", err)
	}
	if updated.Status.Phase != "" {
		t.Fatalf("status phase = %q, want empty", updated.Status.Phase)
	}
}

func validOTG(runtimeType string) *taskgroupv1alpha1.OSMOTaskGroup {
	return &taskgroupv1alpha1.OSMOTaskGroup{
		TypeMeta: metav1.TypeMeta{
			APIVersion: taskgroupv1alpha1.GroupVersion.String(),
			Kind:       "OSMOTaskGroup",
		},
		ObjectMeta: metav1.ObjectMeta{
			Name:      "otg-a",
			Namespace: "default",
			Labels: map[string]string{
				taskgroupv1alpha1.ControllerOwnerLabel: taskgroupv1alpha1.ControllerOwnerPhase1A,
			},
		},
		Spec: taskgroupv1alpha1.OSMOTaskGroupSpec{
			RuntimeType: runtimeType,
			Mode:        taskgroupv1alpha1.ModeActive,
		},
	}
}

func clientKey(otg *taskgroupv1alpha1.OSMOTaskGroup) client.ObjectKey {
	return client.ObjectKey{Namespace: otg.Namespace, Name: otg.Name}
}

func newScheme(t *testing.T) *runtime.Scheme {
	t.Helper()
	scheme := runtime.NewScheme()
	if err := taskgroupv1alpha1.AddToScheme(scheme); err != nil {
		t.Fatalf("AddToScheme() error = %v", err)
	}
	return scheme
}

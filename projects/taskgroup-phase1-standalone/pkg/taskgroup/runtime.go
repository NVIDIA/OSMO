package taskgroup

import (
	"context"
	"fmt"
	"reflect"
	"time"

	taskgroupv1alpha1 "example.com/taskgroup-phase1-standalone/api/taskgroup/v1alpha1"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"sigs.k8s.io/controller-runtime/pkg/builder"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/manager"
	"sigs.k8s.io/controller-runtime/pkg/reconcile"
)

const statusRefreshInterval = 15 * time.Second

type RuntimeReconciler interface {
	Validate(ctx context.Context, otg *taskgroupv1alpha1.OSMOTaskGroup) error
	ReconcileRuntime(ctx context.Context, otg *taskgroupv1alpha1.OSMOTaskGroup) error
	MapStatus(ctx context.Context, otg *taskgroupv1alpha1.OSMOTaskGroup) (taskgroupv1alpha1.OSMOTaskGroupStatus, error)
}

type Reconciler struct {
	client.Client
	Scheme   *runtime.Scheme
	Runtimes map[string]RuntimeReconciler
}

func NewReconciler(kubeClient client.Client, scheme *runtime.Scheme, runtimes map[string]RuntimeReconciler) *Reconciler {
	return &Reconciler{
		Client:   kubeClient,
		Scheme:   scheme,
		Runtimes: runtimes,
	}
}

func (r *Reconciler) SetupWithManager(mgr manager.Manager) error {
	return builder.ControllerManagedBy(mgr).
		For(&taskgroupv1alpha1.OSMOTaskGroup{}).
		Owns(&corev1.Pod{}).
		Complete(r)
}

func (r *Reconciler) Reconcile(ctx context.Context, request reconcile.Request) (reconcile.Result, error) {
	otg := &taskgroupv1alpha1.OSMOTaskGroup{}
	if err := r.Get(ctx, request.NamespacedName, otg); err != nil {
		return reconcile.Result{}, client.IgnoreNotFound(err)
	}
	if !IsPhase1AOwned(otg) {
		return reconcile.Result{}, nil
	}
	if err := otg.Validate(); err != nil {
		return reconcile.Result{RequeueAfter: statusRefreshInterval}, r.updateStatus(ctx, otg, failureStatus(otg, err.Error()))
	}
	runtimeReconciler, ok := r.Runtimes[otg.EffectiveRuntimeType()]
	if !ok {
		return reconcile.Result{RequeueAfter: statusRefreshInterval}, r.updateStatus(ctx, otg, failureStatus(
			otg,
			fmt.Sprintf("unsupported runtimeType %q", otg.EffectiveRuntimeType()),
		))
	}
	if err := runtimeReconciler.Validate(ctx, otg); err != nil {
		return reconcile.Result{RequeueAfter: statusRefreshInterval}, r.updateStatus(ctx, otg, failureStatus(otg, err.Error()))
	}
	if err := runtimeReconciler.ReconcileRuntime(ctx, otg); err != nil {
		statusErr := r.updateStatus(ctx, otg, failureStatus(otg, err.Error()))
		if statusErr != nil {
			return reconcile.Result{}, statusErr
		}
		return reconcile.Result{RequeueAfter: statusRefreshInterval}, err
	}
	status, err := runtimeReconciler.MapStatus(ctx, otg)
	if err != nil {
		return reconcile.Result{RequeueAfter: statusRefreshInterval}, err
	}
	return reconcile.Result{RequeueAfter: statusRefreshInterval}, r.updateStatus(ctx, otg, status)
}

func IsPhase1AOwned(otg *taskgroupv1alpha1.OSMOTaskGroup) bool {
	return otg.GetLabels()[taskgroupv1alpha1.ControllerOwnerLabel] == taskgroupv1alpha1.ControllerOwnerPhase1A
}

func (r *Reconciler) updateStatus(ctx context.Context, otg *taskgroupv1alpha1.OSMOTaskGroup, status taskgroupv1alpha1.OSMOTaskGroupStatus) error {
	status.ObservedGeneration = otg.Generation
	status.LastReportTime = metav1.Now()
	if statusEqual(otg.Status, status) {
		return nil
	}
	otg.Status = status
	return r.Status().Update(ctx, otg)
}

func failureStatus(otg *taskgroupv1alpha1.OSMOTaskGroup, message string) taskgroupv1alpha1.OSMOTaskGroupStatus {
	return taskgroupv1alpha1.OSMOTaskGroupStatus{
		Phase:   "Failed",
		Message: message,
		Conditions: []metav1.Condition{
			{
				Type:               "Reconciled",
				Status:             metav1.ConditionFalse,
				ObservedGeneration: otg.Generation,
				Reason:             "RuntimeError",
				Message:            message,
			},
		},
	}
}

func statusEqual(left, right taskgroupv1alpha1.OSMOTaskGroupStatus) bool {
	left.Conditions = normalizeConditions(left.Conditions)
	right.Conditions = normalizeConditions(right.Conditions)
	return reflect.DeepEqual(left, right)
}

func normalizeConditions(in []metav1.Condition) []metav1.Condition {
	out := append([]metav1.Condition(nil), in...)
	for i := range out {
		out[i].LastTransitionTime = metav1.Time{}
	}
	return out
}

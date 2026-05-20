// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

package workflow

import (
	"context"
	"fmt"
	"time"

	"k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/controller/controllerutil"
	"sigs.k8s.io/controller-runtime/pkg/handler"
	"sigs.k8s.io/controller-runtime/pkg/log"
	"sigs.k8s.io/controller-runtime/pkg/reconcile"

	v1alpha1 "github.com/nvidia/osmo/taskgroup/api/v1alpha1"
)

// PeriodicReconcileInterval bounds how often the Workflow Controller re-walks the DAG.
const PeriodicReconcileInterval = 30 * time.Second

// Reconciler implements the OSMOWorkflow controller. It is the orchestration brain in
// Architecture B (no Postgres): DAG resolution, dispatch decisions, and status rollup
// all live in this package.
type Reconciler struct {
	Client client.Client
	Scheme *runtime.Scheme

	// LocalDispatcher creates OSMOTaskGroup CRs in the control cluster (where the
	// Workflow Controller itself runs).
	LocalDispatcher Dispatcher

	// RemoteResolver, when non-nil, returns a Dispatcher for a given remote cluster_id.
	// Phase 2 wires this to the Operator Service's session registry. Nil in Phase 1
	// (only LocalDispatcher is used).
	RemoteResolver func(clusterID string) (Dispatcher, error)
}

// SetupWithManager registers the Reconciler with a controller-runtime Manager. The
// controller watches both OSMOWorkflow CRs (primary) and OSMOTaskGroup CRs (so status
// changes on children trigger a parent reconcile).
func (r *Reconciler) SetupWithManager(mgr ctrl.Manager) error {
	return ctrl.NewControllerManagedBy(mgr).
		For(&v1alpha1.OSMOWorkflow{}).
		Watches(
			&v1alpha1.OSMOTaskGroup{},
			handler.EnqueueRequestsFromMapFunc(r.taskGroupToWorkflow),
		).
		Complete(r)
}

// taskGroupToWorkflow maps a child OSMOTaskGroup event back to its parent OSMOWorkflow,
// so child status changes drive parent reconciliation.
func (r *Reconciler) taskGroupToWorkflow(_ context.Context, obj client.Object) []reconcile.Request {
	workflowID := obj.GetLabels()[v1alpha1.LabelWorkflowID]
	if workflowID == "" {
		return nil
	}
	return []reconcile.Request{{
		NamespacedName: types.NamespacedName{Name: workflowID, Namespace: obj.GetNamespace()},
	}}
}

// Reconcile is the entrypoint controller-runtime calls.
func (r *Reconciler) Reconcile(ctx context.Context, req reconcile.Request) (reconcile.Result, error) {
	logger := log.FromContext(ctx).WithValues("workflow", req.NamespacedName)

	var wf v1alpha1.OSMOWorkflow
	if err := r.Client.Get(ctx, req.NamespacedName, &wf); err != nil {
		return reconcile.Result{}, client.IgnoreNotFound(err)
	}

	if !wf.DeletionTimestamp.IsZero() {
		return r.reconcileDelete(ctx, &wf)
	}

	// Add the remote-cleanup finalizer on first sight when there are remote groups.
	// Local-only groups don't need it (K8s owner refs handle cascade locally), but the
	// finalizer is harmless when there are none.
	if controllerutil.AddFinalizer(&wf, v1alpha1.FinalizerRemoteCleanup) {
		if err := r.Client.Update(ctx, &wf); err != nil {
			return reconcile.Result{}, fmt.Errorf("adding finalizer: %w", err)
		}
		return reconcile.Result{Requeue: true}, nil
	}

	// Validate + dispatch ready groups.
	ready, err := resolveReady(&wf)
	if err != nil {
		logger.Error(err, "dag validation failed")
		return reconcile.Result{}, r.markFailed(ctx, &wf, fmt.Errorf("invalid DAG: %w", err))
	}

	for _, groupName := range ready {
		group, ok := findGroup(wf.Spec.Groups, groupName)
		if !ok {
			continue
		}
		dispatcher, err := r.dispatcherFor(group.Cluster)
		if err != nil {
			logger.Error(err, "no dispatcher for cluster", "cluster", group.Cluster)
			// Mark the group Failed; workflow rollup will pick it up.
			if wf.Status.Groups == nil {
				wf.Status.Groups = map[string]v1alpha1.WorkflowGroupStatus{}
			}
			wf.Status.Groups[groupName] = v1alpha1.WorkflowGroupStatus{
				Phase:   v1alpha1.PhaseFailed,
				Message: err.Error(),
			}
			continue
		}
		ref, err := dispatcher.Create(ctx, &wf, group)
		if err != nil {
			logger.Error(err, "creating OSMOTaskGroup", "group", groupName)
			return reconcile.Result{RequeueAfter: 5 * time.Second}, nil
		}
		if wf.Status.Groups == nil {
			wf.Status.Groups = map[string]v1alpha1.WorkflowGroupStatus{}
		}
		now := metav1.Now()
		wf.Status.Groups[groupName] = v1alpha1.WorkflowGroupStatus{
			Phase:        v1alpha1.PhasePending,
			TaskGroupRef: ref,
			LastUpdated:  &now,
		}
		logger.Info("dispatched group", "group", groupName, "cluster", group.Cluster, "ref", ref.Name)
	}

	// Refresh per-group statuses from local OSMOTaskGroups. Remote group statuses are
	// populated by the operator-service session loop (Phase 2) and arrive via separate
	// status update events; we simply trust whatever is in status.Groups here.
	if err := r.refreshLocalStatuses(ctx, &wf); err != nil {
		logger.Error(err, "refreshing local statuses")
	}

	// Roll up phase + counters.
	wf.Status.Phase = rollupPhase(&wf)
	wf.Status.GroupsTotal = int32(len(wf.Spec.Groups))
	succeeded, failed := int32(0), int32(0)
	for _, g := range wf.Spec.Groups {
		switch wf.Status.Groups[g.Name].Phase {
		case v1alpha1.PhaseSucceeded:
			succeeded++
		case v1alpha1.PhaseFailed:
			failed++
		}
	}
	wf.Status.GroupsSucceeded = succeeded
	wf.Status.GroupsFailed = failed
	wf.Status.ObservedGeneration = wf.Generation
	// meta.SetStatusCondition keeps LastTransitionTime stable when the condition's
	// Status field doesn't change, avoiding reconcile-feedback loops.
	meta.SetStatusCondition(&wf.Status.Conditions, metav1.Condition{
		Type:   v1alpha1.ConditionReady,
		Status: readyStatus(wf.Status.Phase),
		Reason: string(wf.Status.Phase),
	})

	if err := r.Client.Status().Update(ctx, &wf); err != nil {
		logger.Error(err, "writing workflow status")
		return reconcile.Result{RequeueAfter: 5 * time.Second}, nil
	}

	return reconcile.Result{RequeueAfter: PeriodicReconcileInterval}, nil
}

// dispatcherFor picks the right Dispatcher implementation for a group's cluster target.
// Empty cluster = LocalDispatcher. Non-empty = RemoteResolver lookup.
func (r *Reconciler) dispatcherFor(clusterID string) (Dispatcher, error) {
	if clusterID == "" {
		return r.LocalDispatcher, nil
	}
	if r.RemoteResolver == nil {
		return nil, fmt.Errorf("group targets cluster %q but multi-cluster routing is not configured (Phase 1 supports single cluster only)", clusterID)
	}
	return r.RemoteResolver(clusterID)
}

// refreshLocalStatuses reads each locally-dispatched group's OSMOTaskGroup status and
// folds it into the workflow's per-group status. Remote groups are not touched here —
// their status arrives via the session stream and is written to status.Groups by the
// session handler.
func (r *Reconciler) refreshLocalStatuses(ctx context.Context, wf *v1alpha1.OSMOWorkflow) error {
	for name, gs := range wf.Status.Groups {
		if gs.TaskGroupRef.Cluster != "" {
			continue
		}
		if gs.TaskGroupRef.Name == "" {
			continue
		}
		var otg v1alpha1.OSMOTaskGroup
		err := r.Client.Get(ctx, types.NamespacedName{
			Name:      gs.TaskGroupRef.Name,
			Namespace: gs.TaskGroupRef.Namespace,
		}, &otg)
		if err != nil {
			continue
		}
		now := metav1.Now()
		wf.Status.Groups[name] = v1alpha1.WorkflowGroupStatus{
			Phase:        otg.Status.Phase,
			TaskGroupRef: gs.TaskGroupRef,
			LastUpdated:  &now,
			Message:      otg.Status.Message,
		}
	}
	return nil
}

// reconcileDelete runs the finalizer logic before the OSMOWorkflow can be garbage-
// collected. Local OSMOTaskGroup children are cleaned up by K8s owner-ref cascade.
// Remote children (cross-cluster) need an explicit DeleteOTG via the Operator Service.
func (r *Reconciler) reconcileDelete(ctx context.Context, wf *v1alpha1.OSMOWorkflow) (reconcile.Result, error) {
	logger := log.FromContext(ctx)
	if !controllerutil.ContainsFinalizer(wf, v1alpha1.FinalizerRemoteCleanup) {
		return reconcile.Result{}, nil // K8s will GC
	}

	// For each remote group, send a Delete. Local groups skip (owner-ref cascade
	// handles them).
	remaining := 0
	for groupName, gs := range wf.Status.Groups {
		if gs.TaskGroupRef.Cluster == "" || gs.TaskGroupRef.Name == "" {
			continue
		}
		dispatcher, err := r.dispatcherFor(gs.TaskGroupRef.Cluster)
		if err != nil {
			// Cluster might not be connected right now. Don't block delete forever —
			// log and continue. The remote OTG will eventually be cleaned up by its
			// own controller's workflow-ID label garbage collection (Phase 3+).
			logger.Info("remote cluster unreachable; skipping cleanup", "cluster", gs.TaskGroupRef.Cluster, "group", groupName, "error", err.Error())
			continue
		}
		if err := dispatcher.Delete(ctx, gs.TaskGroupRef); err != nil {
			logger.Info("remote delete failed; will retry", "cluster", gs.TaskGroupRef.Cluster, "group", groupName, "error", err.Error())
			remaining++
		}
	}
	if remaining > 0 {
		return reconcile.Result{RequeueAfter: 10 * time.Second}, nil
	}

	controllerutil.RemoveFinalizer(wf, v1alpha1.FinalizerRemoteCleanup)
	if err := r.Client.Update(ctx, wf); err != nil {
		return reconcile.Result{}, fmt.Errorf("removing finalizer: %w", err)
	}
	return reconcile.Result{}, nil
}

func (r *Reconciler) markFailed(ctx context.Context, wf *v1alpha1.OSMOWorkflow, cause error) error {
	wf.Status.Phase = v1alpha1.PhaseFailed
	wf.Status.Message = cause.Error()
	wf.Status.ObservedGeneration = wf.Generation
	return r.Client.Status().Update(ctx, wf)
}

func findGroup(groups []v1alpha1.WorkflowGroup, name string) (v1alpha1.WorkflowGroup, bool) {
	for _, g := range groups {
		if g.Name == name {
			return g, true
		}
	}
	return v1alpha1.WorkflowGroup{}, false
}

func readyStatus(p v1alpha1.Phase) metav1.ConditionStatus {
	switch p {
	case v1alpha1.PhaseSucceeded, v1alpha1.PhaseRunning:
		return metav1.ConditionTrue
	default:
		return metav1.ConditionFalse
	}
}

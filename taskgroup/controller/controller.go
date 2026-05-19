// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

// Package controller is the top-level OSMOTaskGroup reconciler. It owns the lifecycle of
// every OSMOTaskGroup in the cluster: finalizer management, runtime dispatch, status
// rollup, and periodic drift-detection reconcile.
//
// Runtime-specific rendering and status interpretation live in subpackages under
// controller/runtimes/. Service-discovery (mesh) integrations live in
// controller/servicediscovery/. This file orchestrates the contract between them.
package controller

import (
	"context"
	"errors"
	"fmt"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/builder"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/controller/controllerutil"
	"sigs.k8s.io/controller-runtime/pkg/log"
	"sigs.k8s.io/controller-runtime/pkg/reconcile"

	v1alpha1 "github.com/nvidia/osmo/taskgroup/api/v1alpha1"
)

// PeriodicReconcileInterval bounds how stale the controller's status push can be in the
// absence of a triggering event. The periodic loop also serves as the drift-detection
// safety net described in the design doc.
const PeriodicReconcileInterval = 60 * time.Second

// FinalizerTimeout bounds how long log collection has to complete before the finalizer
// surrenders and lets cascade delete proceed.
const FinalizerTimeout = 5 * time.Minute

// Reconciler is the top-level controller-runtime Reconciler for OSMOTaskGroup CRs.
type Reconciler struct {
	Client     client.Client
	Scheme     *runtime.Scheme
	Dispatcher *Dispatcher

	// StatusReporter is invoked after every successful reconcile to push the rolled-up
	// status to the OSMO API server. Nil is allowed for testing and headless mode; in
	// that case status only lives in the CR.
	StatusReporter StatusReporter
}

// StatusReporter is the contract the controller uses to push status outward. The
// concrete implementation is a gRPC client to the Operator Service; tests can plug in
// fakes. Implementations must be safe for concurrent use.
type StatusReporter interface {
	Report(ctx context.Context, otg *v1alpha1.OSMOTaskGroup) error
}

// SetupWithManager registers the Reconciler with a controller-runtime Manager. The
// reconciler watches OSMOTaskGroup CRs and is also re-enqueued periodically to drive
// the drift-detection sweep.
func (r *Reconciler) SetupWithManager(mgr ctrl.Manager) error {
	return ctrl.NewControllerManagedBy(mgr).
		For(&v1alpha1.OSMOTaskGroup{}, builder.WithPredicates()).
		Complete(r)
}

// Reconcile is the controller-runtime entrypoint. It loads the CR, applies the finalizer
// if needed, dispatches to the runtime, rolls up status, and pushes the result.
func (r *Reconciler) Reconcile(ctx context.Context, req reconcile.Request) (reconcile.Result, error) {
	logger := log.FromContext(ctx).WithValues("otg", req.NamespacedName)

	var otg v1alpha1.OSMOTaskGroup
	if err := r.Client.Get(ctx, req.NamespacedName, &otg); err != nil {
		// Not found is normal during cascade delete.
		return reconcile.Result{}, client.IgnoreNotFound(err)
	}

	// Handle deletion via the finalizer pattern: as long as the finalizer is present,
	// K8s will not actually cascade-delete the children. We run our terminal-state
	// capture (log collection) and then remove the finalizer.
	if !otg.DeletionTimestamp.IsZero() {
		return r.reconcileDelete(ctx, &otg)
	}

	// Ensure our finalizer is in place on first sight so that future deletes are guarded.
	if controllerutil.AddFinalizer(&otg, v1alpha1.FinalizerLogCollection) {
		if err := r.Client.Update(ctx, &otg); err != nil {
			return reconcile.Result{}, fmt.Errorf("adding finalizer: %w", err)
		}
		// Re-fetch on next reconcile; finalizer update changes resourceVersion.
		return reconcile.Result{Requeue: true}, nil
	}

	rt, err := r.Dispatcher.Resolve(otg.Spec.RuntimeType)
	if err != nil {
		// Unknown runtime: mark the CR Failed with a clear condition but don't requeue
		// (the situation only changes via an admin registering a new runtime, which
		// causes a controller restart).
		logger.Error(err, "runtime not registered")
		return reconcile.Result{}, r.markUnknownRuntime(ctx, &otg, err)
	}

	// 1) Reconcile child resources via the runtime.
	res, reconcileErr := rt.Reconciler.Reconcile(ctx, &otg)

	// 2) Roll up status regardless of reconcile error — we want the status to reflect
	// failure when reconcile failed.
	status, statusErr := rt.StatusMapper.Map(ctx, &otg)
	if statusErr != nil {
		logger.Error(statusErr, "status mapper failed")
		// Surface the mapper error but don't lose the reconcile error.
		status.Message = statusErr.Error()
	}
	if reconcileErr != nil {
		status.Phase = v1alpha1.PhaseFailed
		if status.Message == "" {
			status.Message = reconcileErr.Error()
		}
	}
	status.ObservedGeneration = otg.Generation

	if err := r.writeStatus(ctx, &otg, status); err != nil {
		logger.Error(err, "writing status")
		// Don't fail the whole reconcile on status-write conflict; we'll retry.
		return reconcile.Result{RequeueAfter: 5 * time.Second}, nil
	}

	// 3) Push status outward (best effort; the periodic loop is the safety net).
	if r.StatusReporter != nil {
		if err := r.StatusReporter.Report(ctx, &otg); err != nil {
			logger.Info("status push deferred", "error", err.Error())
		}
	}

	if reconcileErr != nil {
		return res, reconcileErr
	}

	// Always re-enqueue for periodic drift detection unless the reconciler already asked
	// for an earlier requeue.
	if res.RequeueAfter == 0 && !res.Requeue {
		res.RequeueAfter = PeriodicReconcileInterval
	}
	return res, nil
}

func (r *Reconciler) reconcileDelete(ctx context.Context, otg *v1alpha1.OSMOTaskGroup) (reconcile.Result, error) {
	logger := log.FromContext(ctx).WithValues("otg", otg.Name)
	if !controllerutil.ContainsFinalizer(otg, v1alpha1.FinalizerLogCollection) {
		// Our work is done; let cascade delete proceed.
		return reconcile.Result{}, nil
	}

	rt, err := r.Dispatcher.Resolve(otg.Spec.RuntimeType)
	if err != nil {
		// Can't finalize cleanly without a runtime, but we must not block delete forever.
		logger.Info("removing finalizer despite missing runtime", "type", otg.Spec.RuntimeType)
	} else {
		finCtx, cancel := context.WithTimeout(ctx, FinalizerTimeout)
		defer cancel()
		if err := rt.Reconciler.Finalize(finCtx, otg); err != nil && !errors.Is(err, context.DeadlineExceeded) {
			logger.Error(err, "runtime finalize failed; removing finalizer to unblock delete")
		}
	}

	controllerutil.RemoveFinalizer(otg, v1alpha1.FinalizerLogCollection)
	if err := r.Client.Update(ctx, otg); err != nil {
		return reconcile.Result{}, fmt.Errorf("removing finalizer: %w", err)
	}
	return reconcile.Result{}, nil
}

func (r *Reconciler) writeStatus(ctx context.Context, otg *v1alpha1.OSMOTaskGroup, status v1alpha1.OSMOTaskGroupStatus) error {
	otg.Status = status
	return r.Client.Status().Update(ctx, otg)
}

func (r *Reconciler) markUnknownRuntime(ctx context.Context, otg *v1alpha1.OSMOTaskGroup, err error) error {
	otg.Status.Phase = v1alpha1.PhaseFailed
	otg.Status.Message = err.Error()
	otg.Status.Conditions = []metav1.Condition{{
		Type:               v1alpha1.ConditionReady,
		Status:             metav1.ConditionFalse,
		Reason:             "UnknownRuntime",
		Message:            err.Error(),
		LastTransitionTime: metav1.Now(),
	}}
	otg.Status.ObservedGeneration = otg.Generation
	return r.Client.Status().Update(ctx, otg)
}

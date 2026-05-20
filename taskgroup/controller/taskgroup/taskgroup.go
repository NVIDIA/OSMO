// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

// Package taskgroup is the top-level OSMOTaskGroup reconciler. It owns the lifecycle of
// every OSMOTaskGroup in the cluster: finalizer management, runtime dispatch, and status
// rollup. Runtime-specific rendering and status interpretation live in subpackages under
// controller/runtimes/; the Dispatcher selects which runtime handles a given CR.
package taskgroup

import (
	"context"
	"errors"
	"fmt"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/controller/controllerutil"
	"sigs.k8s.io/controller-runtime/pkg/log"
	"sigs.k8s.io/controller-runtime/pkg/reconcile"

	v1alpha1 "github.com/nvidia/osmo/taskgroup/api/v1alpha1"
	"github.com/nvidia/osmo/taskgroup/controller/runtimes"
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
	// status to the Operator Service. Nil is allowed for testing and headless mode; in
	// that case status only lives in the CR.
	StatusReporter runtimes.StatusReporter
}

// SetupWithManager registers the Reconciler with a controller-runtime Manager. Each
// registered Runtime contributes its own watches via runtimes.Runtime.Watches, so adding
// a new runtime (e.g. NIM, Ray) requires no edits to this file.
func (r *Reconciler) SetupWithManager(mgr ctrl.Manager) error {
	b := runtimes.SetupBuilder(mgr)
	for _, t := range r.Dispatcher.Registered() {
		rt, _ := r.Dispatcher.Resolve(t)
		if rt.Watches != nil {
			b = rt.Watches(b)
		}
	}
	return b.Complete(r)
}

func (r *Reconciler) Reconcile(ctx context.Context, req reconcile.Request) (reconcile.Result, error) {
	logger := log.FromContext(ctx).WithValues("otg", req.NamespacedName)

	var otg v1alpha1.OSMOTaskGroup
	if err := r.Client.Get(ctx, req.NamespacedName, &otg); err != nil {
		return reconcile.Result{}, client.IgnoreNotFound(err)
	}

	if !otg.DeletionTimestamp.IsZero() {
		return r.reconcileDelete(ctx, &otg)
	}

	if controllerutil.AddFinalizer(&otg, v1alpha1.FinalizerLogCollection) {
		if err := r.Client.Update(ctx, &otg); err != nil {
			return reconcile.Result{}, fmt.Errorf("adding finalizer: %w", err)
		}
		return reconcile.Result{Requeue: true}, nil
	}

	rt, err := r.Dispatcher.Resolve(otg.Spec.RuntimeType)
	if err != nil {
		logger.Error(err, "runtime not registered")
		return reconcile.Result{}, r.markUnknownRuntime(ctx, &otg, err)
	}

	res, reconcileErr := rt.Reconciler.Reconcile(ctx, &otg)

	status, statusErr := rt.StatusMapper.Map(ctx, &otg)
	if statusErr != nil {
		logger.Error(statusErr, "status mapper failed")
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
		return reconcile.Result{RequeueAfter: 5 * time.Second}, nil
	}

	if r.StatusReporter != nil {
		if err := r.StatusReporter.Report(ctx, &otg); err != nil {
			logger.Info("status push deferred", "error", err.Error())
		}
	}

	if reconcileErr != nil {
		return res, reconcileErr
	}

	if res.RequeueAfter == 0 && !res.Requeue {
		res.RequeueAfter = PeriodicReconcileInterval
	}
	return res, nil
}

func (r *Reconciler) reconcileDelete(ctx context.Context, otg *v1alpha1.OSMOTaskGroup) (reconcile.Result, error) {
	logger := log.FromContext(ctx).WithValues("otg", otg.Name)
	if !controllerutil.ContainsFinalizer(otg, v1alpha1.FinalizerLogCollection) {
		return reconcile.Result{}, nil
	}

	rt, err := r.Dispatcher.Resolve(otg.Spec.RuntimeType)
	if err != nil {
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

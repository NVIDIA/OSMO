// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// SPDX-License-Identifier: Apache-2.0

package taskgroup

import (
	"context"
	"time"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/util/sets"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"

	taskgroupv1alpha1 "go.corp.nvidia.com/osmo/apis/taskgroup/v1alpha1"
)

const (
	LogCollectionFinalizer  = "workflow.osmo.nvidia.com/log-collection"
	DefaultSweepInterval    = 60 * time.Second
	DefaultFinalizerTimeout = 30 * time.Second
)

type TaskGroupReconciler struct {
	client.Client
	Scheme           *runtime.Scheme
	Handlers         map[taskgroupv1alpha1.RuntimeType]RuntimeHandler
	FinalizerTimeout time.Duration
	LogCollector     LogCollector
}

func NewTaskGroupReconciler(
	client client.Client,
	scheme *runtime.Scheme,
) *TaskGroupReconciler {
	return &TaskGroupReconciler{
		Client: client,
		Scheme: scheme,
		Handlers: map[taskgroupv1alpha1.RuntimeType]RuntimeHandler{
			taskgroupv1alpha1.RuntimeTypeKAI: NewKAIReconciler(client),
		},
		FinalizerTimeout: DefaultFinalizerTimeout,
	}
}

func (r *TaskGroupReconciler) Reconcile(
	ctx context.Context,
	request ctrl.Request,
) (ctrl.Result, error) {
	otg := &taskgroupv1alpha1.OSMOTaskGroup{}
	if err := r.Get(ctx, request.NamespacedName, otg); err != nil {
		return ctrl.Result{}, client.IgnoreNotFound(err)
	}
	if err := otg.Validate(); err != nil {
		return ctrl.Result{}, r.updateStatus(ctx, otg, failureStatus(otg, err.Error()))
	}
	handler, ok := r.Handlers[otg.EffectiveRuntimeType()]
	if !ok {
		err := UnsupportedRuntimeError(otg.EffectiveRuntimeType())
		return ctrl.Result{}, r.updateStatus(ctx, otg, failureStatus(otg, err.Error()))
	}
	if !otg.DeletionTimestamp.IsZero() {
		return ctrl.Result{}, r.finalize(ctx, otg, handler)
	}
	if otg.ActiveMode() && !sets.New(otg.Finalizers...).Has(LogCollectionFinalizer) {
		otg.Finalizers = append(otg.Finalizers, LogCollectionFinalizer)
		return ctrl.Result{}, r.Update(ctx, otg)
	}
	if err := handler.ReconcileRuntime(ctx, otg); err != nil {
		statusErr := r.updateStatus(ctx, otg, failureStatus(otg, err.Error()))
		if statusErr != nil && !apierrors.IsNotFound(statusErr) {
			return ctrl.Result{}, statusErr
		}
		return ctrl.Result{}, err
	}
	status, err := handler.MapStatus(ctx, otg)
	if err != nil {
		return ctrl.Result{}, err
	}
	return ctrl.Result{RequeueAfter: DefaultSweepInterval}, r.updateStatus(ctx, otg, status)
}

func (r *TaskGroupReconciler) updateStatus(
	ctx context.Context,
	otg *taskgroupv1alpha1.OSMOTaskGroup,
	status taskgroupv1alpha1.OSMOTaskGroupStatus,
) error {
	otg.Status = status
	if err := r.Status().Update(ctx, otg); err != nil {
		return err
	}
	return nil
}

func (r *TaskGroupReconciler) finalize(
	ctx context.Context,
	otg *taskgroupv1alpha1.OSMOTaskGroup,
	handler RuntimeHandler,
) error {
	if !sets.New(otg.Finalizers...).Has(LogCollectionFinalizer) {
		return nil
	}
	if r.LogCollector != nil {
		finalizerContext, cancel := context.WithTimeout(ctx, r.FinalizerTimeout)
		defer cancel()
		statusMapper, ok := handler.(*KAIReconciler)
		if ok {
			pods, err := statusMapper.listPods(finalizerContext, otg)
			if err == nil {
				_ = r.LogCollector.CollectPodLogs(finalizerContext, otg, pods)
			}
		}
	}
	otg.Finalizers = removeString(otg.Finalizers, LogCollectionFinalizer)
	return r.Update(ctx, otg)
}

func failureStatus(
	otg *taskgroupv1alpha1.OSMOTaskGroup,
	message string,
) taskgroupv1alpha1.OSMOTaskGroupStatus {
	return taskgroupv1alpha1.OSMOTaskGroupStatus{
		Phase:   taskgroupv1alpha1.PhaseFailed,
		Message: message,
		Conditions: []metav1.Condition{
			{
				Type:               string(taskgroupv1alpha1.ConditionReconciled),
				Status:             metav1.ConditionFalse,
				ObservedGeneration: otg.Generation,
				LastTransitionTime: metav1.Now(),
				Reason:             "RuntimeError",
				Message:            message,
			},
		},
	}
}

func removeString(values []string, value string) []string {
	filtered := values[:0]
	for _, item := range values {
		if item != value {
			filtered = append(filtered, item)
		}
	}
	return filtered
}

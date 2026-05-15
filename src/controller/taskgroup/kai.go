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
	"encoding/json"
	"fmt"
	"log/slog"
	"strconv"

	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"

	taskgroupv1alpha1 "go.corp.nvidia.com/osmo/apis/taskgroup/v1alpha1"
)

type KAIReconciler struct {
	client client.Client
}

func NewKAIReconciler(client client.Client) *KAIReconciler {
	return &KAIReconciler{client: client}
}

func (r *KAIReconciler) ReconcileRuntime(
	ctx context.Context,
	otg *taskgroupv1alpha1.OSMOTaskGroup,
) error {
	config, err := decodeRuntimeConfig(otg)
	if err != nil {
		return err
	}
	logRenderDivergence(ctx, otg, config)
	objects, err := renderKAIObjects(config)
	if err != nil {
		return err
	}
	if otg.ShadowMode() && !otg.ActiveMode() {
		return nil
	}
	for index := range objects {
		object := objects[index]
		scope, err := kaiResourceScope(config, object)
		if err != nil {
			return err
		}
		if scope == ResourceScopeCluster {
			object.SetNamespace("")
			if err := r.validateClusterResource(ctx, object); err != nil {
				return err
			}
			continue
		}
		object.SetNamespace(defaultNamespace(object.GetNamespace(), otg.Namespace))
		if err := setControllerLabels(otg, &object); err != nil {
			return err
		}
		setOwnerReference(otg, &object)
		if err := r.client.Create(ctx, &object); err != nil && !apierrors.IsAlreadyExists(err) {
			return err
		}
	}
	return nil
}

func (r *KAIReconciler) validateClusterResource(
	ctx context.Context,
	object unstructured.Unstructured,
) error {
	existing := &unstructured.Unstructured{}
	existing.SetAPIVersion(object.GetAPIVersion())
	existing.SetKind(object.GetKind())
	if err := r.client.Get(ctx, client.ObjectKey{Name: object.GetName()}, existing); err != nil {
		if apierrors.IsNotFound(err) {
			return fmt.Errorf("%s/%s %q must already exist in the cluster",
				object.GetAPIVersion(), object.GetKind(), object.GetName())
		}
		return err
	}
	return nil
}

func (r *KAIReconciler) MapStatus(
	ctx context.Context,
	otg *taskgroupv1alpha1.OSMOTaskGroup,
) (taskgroupv1alpha1.OSMOTaskGroupStatus, error) {
	pods, err := r.listPods(ctx, otg)
	if err != nil {
		return taskgroupv1alpha1.OSMOTaskGroupStatus{}, err
	}
	summary := summarizePods(pods)
	phase := normalizePhase(summary, len(pods))
	runtimeStatusBytes, err := json.Marshal(map[string]any{
		"podNames":            podNames(pods),
		"task_status_updates": taskStatusUpdatesFromPods(otg, pods),
	})
	if err != nil {
		return taskgroupv1alpha1.OSMOTaskGroupStatus{}, err
	}
	return taskgroupv1alpha1.OSMOTaskGroupStatus{
		Phase:      phase,
		PodSummary: summary,
		Conditions: []metav1.Condition{
			{
				Type:               string(taskgroupv1alpha1.ConditionReconciled),
				Status:             metav1.ConditionTrue,
				ObservedGeneration: otg.Generation,
				LastTransitionTime: metav1.Now(),
				Reason:             "RuntimeMapped",
				Message:            "KAI workload status mapped",
			},
		},
		RuntimeStatus: runtime.RawExtension{Raw: runtimeStatusBytes},
	}, nil
}

func (r *KAIReconciler) listPods(
	ctx context.Context,
	otg *taskgroupv1alpha1.OSMOTaskGroup,
) ([]corev1.Pod, error) {
	objects, err := DecodeRuntimeConfig(otg)
	if err != nil {
		return nil, err
	}
	pods := []corev1.Pod{}
	for index := range objects {
		object := objects[index]
		if object.GetKind() != "Pod" || object.GetAPIVersion() != "v1" {
			continue
		}
		pod := &corev1.Pod{}
		key := client.ObjectKey{
			Namespace: defaultNamespace(object.GetNamespace(), otg.Namespace),
			Name:      object.GetName(),
		}
		if err := r.client.Get(ctx, key, pod); err != nil {
			if apierrors.IsNotFound(err) {
				pods = append(pods, corev1.Pod{
					ObjectMeta: metav1.ObjectMeta{Name: key.Name, Namespace: key.Namespace},
					Status:     corev1.PodStatus{Phase: corev1.PodPending},
				})
				continue
			}
			return nil, err
		}
		pods = append(pods, *pod)
	}
	return pods, nil
}

func setOwnerReference(
	otg *taskgroupv1alpha1.OSMOTaskGroup,
	object *unstructured.Unstructured,
) {
	controller := true
	ownerReferences := object.GetOwnerReferences()
	ownerReferences = append(ownerReferences, metav1.OwnerReference{
		APIVersion: taskgroupv1alpha1.GroupVersion.String(),
		Kind:       "OSMOTaskGroup",
		Name:       otg.Name,
		UID:        otg.UID,
		Controller: &controller,
	})
	object.SetOwnerReferences(ownerReferences)
}

func setControllerLabels(
	otg *taskgroupv1alpha1.OSMOTaskGroup,
	object *unstructured.Unstructured,
) error {
	labels := object.GetLabels()
	if labels == nil {
		labels = map[string]string{}
	}
	if otg.Spec.WorkflowID != "" {
		labels[taskgroupv1alpha1.LabelWorkflowID] = otg.Spec.WorkflowID
	}
	if otg.Spec.WorkflowUUID != "" {
		labels[taskgroupv1alpha1.LabelWorkflowUUID] = otg.Spec.WorkflowUUID
	}
	if otg.Spec.GroupName != "" {
		labels[taskgroupv1alpha1.LabelGroupName] = otg.Spec.GroupName
	}
	if otg.Spec.GroupUUID != "" {
		labels[taskgroupv1alpha1.LabelGroupUUID] = otg.Spec.GroupUUID
	}
	object.SetLabels(labels)
	return nil
}

func summarizePods(pods []corev1.Pod) taskgroupv1alpha1.PodSummary {
	summary := taskgroupv1alpha1.PodSummary{}
	for _, pod := range pods {
		switch pod.Status.Phase {
		case corev1.PodPending:
			summary.Pending++
		case corev1.PodRunning:
			summary.Running++
		case corev1.PodSucceeded:
			summary.Succeeded++
		case corev1.PodFailed:
			summary.Failed++
		default:
			summary.Unknown++
		}
	}
	return summary
}

func normalizePhase(
	summary taskgroupv1alpha1.PodSummary,
	totalPods int,
) taskgroupv1alpha1.OSMOTaskGroupPhase {
	if totalPods == 0 {
		return taskgroupv1alpha1.PhasePending
	}
	if summary.Failed > 0 {
		return taskgroupv1alpha1.PhaseFailed
	}
	if int(summary.Succeeded) == totalPods {
		return taskgroupv1alpha1.PhaseSucceeded
	}
	if summary.Running > 0 {
		return taskgroupv1alpha1.PhaseRunning
	}
	if summary.Unknown > 0 {
		return taskgroupv1alpha1.PhaseUnknown
	}
	return taskgroupv1alpha1.PhasePending
}

func podNames(pods []corev1.Pod) []string {
	names := make([]string, 0, len(pods))
	for _, pod := range pods {
		names = append(names, pod.Name)
	}
	return names
}

func taskStatusUpdatesFromPods(
	otg *taskgroupv1alpha1.OSMOTaskGroup,
	pods []corev1.Pod,
) []taskStatusUpdateReport {
	updates := make([]taskStatusUpdateReport, 0, len(pods))
	for _, pod := range pods {
		taskUUID := pod.Labels["osmo.task_uuid"]
		if taskUUID == "" {
			continue
		}
		retryID, err := strconv.Atoi(pod.Labels["osmo.retry_id"])
		if err != nil {
			retryID = 0
		}
		updates = append(updates, taskStatusUpdateReport{
			WorkflowUUID: defaultString(pod.Labels["osmo.workflow_uuid"], otg.Spec.WorkflowUUID),
			TaskUUID:     taskUUID,
			RetryID:      int32(retryID),
			Container:    firstContainerName(pod),
			Node:         pod.Spec.NodeName,
			PodIP:        pod.Status.PodIP,
			Message:      podStatusMessage(pod),
			Status:       podPhaseToTaskStatus(pod),
			ExitCode:     podExitCode(pod),
			Backend:      pod.Labels["osmo.backend"],
			Conditions:   podConditionReports(pod),
		})
	}
	return updates
}

func firstContainerName(pod corev1.Pod) string {
	if len(pod.Spec.Containers) > 0 {
		return pod.Spec.Containers[0].Name
	}
	if len(pod.Status.ContainerStatuses) > 0 {
		return pod.Status.ContainerStatuses[0].Name
	}
	return ""
}

func podStatusMessage(pod corev1.Pod) string {
	if pod.Status.Message != "" {
		return pod.Status.Message
	}
	if pod.Status.Reason != "" {
		return pod.Status.Reason
	}
	for _, containerStatus := range pod.Status.ContainerStatuses {
		if containerStatus.State.Waiting != nil && containerStatus.State.Waiting.Message != "" {
			return containerStatus.State.Waiting.Message
		}
		if containerStatus.State.Waiting != nil && containerStatus.State.Waiting.Reason != "" {
			return containerStatus.State.Waiting.Reason
		}
		if containerStatus.State.Terminated != nil && containerStatus.State.Terminated.Message != "" {
			return containerStatus.State.Terminated.Message
		}
		if containerStatus.State.Terminated != nil && containerStatus.State.Terminated.Reason != "" {
			return containerStatus.State.Terminated.Reason
		}
	}
	return ""
}

func podPhaseToTaskStatus(pod corev1.Pod) string {
	if failureStatus := podFailureStatus(pod); failureStatus != "" {
		return failureStatus
	}
	switch pod.Status.Phase {
	case corev1.PodRunning:
		return "RUNNING"
	case corev1.PodSucceeded:
		return "COMPLETED"
	case corev1.PodFailed:
		return "FAILED"
	case corev1.PodPending:
		if pod.Spec.NodeName != "" {
			return "INITIALIZING"
		}
		return "SCHEDULING"
	default:
		return "FAILED"
	}
}

func podFailureStatus(pod corev1.Pod) string {
	if pod.Status.Reason == "Evicted" {
		return "FAILED_EVICTED"
	}
	for _, containerStatus := range pod.Status.ContainerStatuses {
		if containerStatus.State.Waiting != nil {
			switch containerStatus.State.Waiting.Reason {
			case "ErrImagePull", "ImagePullBackOff":
				return "FAILED_IMAGE_PULL"
			case "CreateContainerConfigError", "CreateContainerError", "RunContainerError":
				return "FAILED_START_ERROR"
			}
		}
	}
	return ""
}

func podExitCode(pod corev1.Pod) int32 {
	for _, containerStatus := range pod.Status.ContainerStatuses {
		if containerStatus.State.Terminated != nil {
			return containerStatus.State.Terminated.ExitCode
		}
	}
	return -1
}

func podConditionReports(pod corev1.Pod) []conditionReport {
	conditions := make([]conditionReport, 0, len(pod.Status.Conditions))
	for _, condition := range pod.Status.Conditions {
		conditions = append(conditions, conditionReport{
			Type:      string(condition.Type),
			Status:    string(condition.Status),
			Reason:    condition.Reason,
			Message:   condition.Message,
			Timestamp: condition.LastTransitionTime.Time.Format("2006-01-02T15:04:05Z07:00"),
		})
	}
	return conditions
}

func defaultString(value string, fallback string) string {
	if value != "" {
		return value
	}
	return fallback
}

func logRenderDivergence(
	ctx context.Context,
	otg *taskgroupv1alpha1.OSMOTaskGroup,
	config RuntimeConfig,
) {
	if len(config.ExpectedResources) == 0 {
		return
	}
	actualObjects, renderErr := renderKAIObjects(config)
	if renderErr != nil {
		slog.WarnContext(ctx, "failed to render OSMOTaskGroup resources for comparison",
			slog.String("namespace", otg.Namespace),
			slog.String("name", otg.Name),
			slog.String("error", renderErr.Error()))
		return
	}
	expected, expectedErr := json.Marshal(config.ExpectedResources)
	actualResources := make([]map[string]any, 0, len(actualObjects))
	for _, object := range actualObjects {
		actualResources = append(actualResources, object.Object)
	}
	actual, actualErr := json.Marshal(actualResources)
	if expectedErr != nil || actualErr != nil {
		slog.WarnContext(ctx, "failed to compare OSMOTaskGroup rendered resources",
			slog.String("namespace", otg.Namespace),
			slog.String("name", otg.Name))
		return
	}
	if string(expected) == string(actual) {
		return
	}
	slog.ErrorContext(ctx, "OSMOTaskGroup render divergence",
		slog.String("namespace", otg.Namespace),
		slog.String("name", otg.Name),
		slog.String("workflow_uuid", otg.Spec.WorkflowUUID),
		slog.Int("expected_resources", len(config.ExpectedResources)),
		slog.Int("actual_resources", len(actualResources)))
}

func defaultNamespace(resourceNamespace string, fallback string) string {
	if resourceNamespace != "" {
		return resourceNamespace
	}
	if fallback == "" {
		return metav1.NamespaceDefault
	}
	return fallback
}

func UnsupportedRuntimeError(runtimeType taskgroupv1alpha1.RuntimeType) error {
	return fmt.Errorf("unsupported runtimeType %q", runtimeType)
}

/*
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

SPDX-License-Identifier: Apache-2.0
*/

package kai

import (
	"context"
	"encoding/json"
	"fmt"

	workflowv1alpha1 "go.corp.nvidia.com/osmo/apis/workflow/v1alpha1"
	"go.corp.nvidia.com/osmo/controller/dispatcher"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/kubernetes"
)

// StatusMapper implements dispatcher.StatusMapper for KAI.
//
// Mapping rules (from PROJ-taskgroup-crd.md "Status mapping"):
//
//	Phase=Running   if any Pod has phase=Running
//	Phase=Succeeded if all lead Pods have phase=Succeeded
//	Phase=Failed    if any Pod has phase=Failed beyond the retry budget, OR
//	                if PodGroup's minAvailable was never met within grace
type StatusMapper struct {
	KubeClient kubernetes.Interface
}

var _ dispatcher.StatusMapper = (*StatusMapper)(nil)

// Map walks the Pods backing this task group and aggregates their phases
// into a normalized OSMOTaskGroupStatus.
func (m *StatusMapper) Map(ctx context.Context, otg *workflowv1alpha1.OSMOTaskGroup) (workflowv1alpha1.OSMOTaskGroupStatus, error) {
	status := workflowv1alpha1.OSMOTaskGroupStatus{
		ObservedGeneration: otg.Generation,
		Retries:            otg.Status.Retries,
	}

	pods, err := m.listGroupPods(ctx, otg)
	if err != nil {
		return status, err
	}

	cfg, err := DecodeKAIConfig(otg)
	if err != nil {
		return status, err
	}

	taskByPod := make(map[string]workflowv1alpha1.KAITaskTemplate, len(cfg.Tasks))
	for _, t := range cfg.Tasks {
		taskByPod[fmt.Sprintf("%s-%s", otg.Name, t.Name)] = t
	}

	taskStatuses := make([]workflowv1alpha1.KAITaskStatus, 0, len(pods))
	var anyRunning, anyFailed bool
	leadSucceeded := true
	leadCount := 0

	for _, pod := range pods {
		taskStatus := podToTaskStatus(pod)
		taskStatuses = append(taskStatuses, taskStatus)

		switch pod.Status.Phase {
		case corev1.PodRunning, corev1.PodPending:
			anyRunning = true
		case corev1.PodFailed:
			anyFailed = true
		}
		if t, ok := taskByPod[pod.Name]; ok && t.Lead {
			leadCount++
			if pod.Status.Phase != corev1.PodSucceeded {
				leadSucceeded = false
			}
		}
	}

	switch {
	case anyFailed && otg.Status.Retries >= otg.Spec.MaxRetries:
		status.Phase = workflowv1alpha1.PhaseFailed
	case leadCount > 0 && leadSucceeded && !anyRunning:
		status.Phase = workflowv1alpha1.PhaseSucceeded
	case len(pods) == 0:
		status.Phase = workflowv1alpha1.PhasePending
	default:
		status.Phase = workflowv1alpha1.PhaseRunning
	}

	rs := workflowv1alpha1.KAIRuntimeStatus{
		PodGroupName: otg.Name,
		Tasks:        taskStatuses,
	}
	raw, err := json.Marshal(rs)
	if err != nil {
		return status, fmt.Errorf("marshal runtimeStatus: %w", err)
	}
	status.RuntimeStatus = &runtime.RawExtension{Raw: raw}
	return status, nil
}

func (m *StatusMapper) listGroupPods(ctx context.Context, otg *workflowv1alpha1.OSMOTaskGroup) ([]corev1.Pod, error) {
	if m.KubeClient == nil {
		// No cluster connection (unit-test path); empty pod list is the
		// equivalent of "fresh group, nothing scheduled yet".
		return nil, nil
	}
	selector := fmt.Sprintf("%s=%s,%s=%s",
		workflowv1alpha1.LabelWorkflowID, otg.Spec.WorkflowID,
		workflowv1alpha1.LabelGroupName, otg.Spec.GroupName,
	)
	list, err := m.KubeClient.CoreV1().Pods(otg.Namespace).List(ctx, metav1.ListOptions{LabelSelector: selector})
	if err != nil {
		return nil, fmt.Errorf("list pods: %w", err)
	}
	return list.Items, nil
}

func podToTaskStatus(pod corev1.Pod) workflowv1alpha1.KAITaskStatus {
	name := pod.Labels["osmo.task_name"]
	if name == "" {
		name = pod.Name
	}
	ts := workflowv1alpha1.KAITaskStatus{
		Name:    name,
		PodName: pod.Name,
		State:   string(pod.Status.Phase),
	}
	if pod.Status.StartTime != nil {
		ts.StartTime = pod.Status.StartTime
	}
	return ts
}

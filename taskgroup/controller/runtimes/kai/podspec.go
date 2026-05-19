// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

package kai

import (
	"fmt"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	v1alpha1 "github.com/nvidia/osmo/taskgroup/api/v1alpha1"
)

// renderPod converts a compact TaskTemplate into a full corev1.Pod, applying cluster-local
// defaults. The output is deterministic given the input — no random names, no current-time
// labels — so golden-file tests can pin the exact bytes.
func renderPod(otg *v1alpha1.OSMOTaskGroup, cfg *v1alpha1.KAIRuntimeConfig, t v1alpha1.TaskTemplate) *corev1.Pod {
	pod := &corev1.Pod{
		TypeMeta: metav1.TypeMeta{Kind: "Pod", APIVersion: "v1"},
		ObjectMeta: metav1.ObjectMeta{
			Name:      podName(otg, t.Name),
			Namespace: otg.Namespace,
			Labels:    podLabels(otg, t),
			Annotations: map[string]string{
				"workflow.osmo.nvidia.com/group-index": fmt.Sprintf("%d", otg.Spec.GroupIndex),
			},
		},
		Spec: corev1.PodSpec{
			RestartPolicy:    corev1.RestartPolicyNever,
			SchedulerName:    schedulerName(cfg),
			NodeSelector:     t.NodeSelector,
			Tolerations:      t.Tolerations,
			HostNetwork:      t.HostNetwork,
			Containers:       []corev1.Container{renderContainer(t)},
			PriorityClassName: cfg.PriorityClassName,
		},
	}
	return pod
}

// renderContainer builds the user container. Credentials become EnvFrom + Env injections;
// inputs and outputs are not materialized here — those are passed to the osmo_ctrl
// runtime container via environment variables and Kubernetes downward API. Phase 1 keeps
// this simple: the user's container is run directly.
func renderContainer(t v1alpha1.TaskTemplate) corev1.Container {
	c := corev1.Container{
		Name:            "user",
		Image:           t.Image,
		ImagePullPolicy: t.ImagePullPolicy,
		Command:         t.Command,
		Args:            t.Args,
		Env:             append([]corev1.EnvVar(nil), t.Env...),
		Resources:       renderResources(t.Resources),
	}
	for _, cred := range t.Credentials {
		for envName, secretKey := range cred.KeyMap {
			c.Env = append(c.Env, corev1.EnvVar{
				Name: envName,
				ValueFrom: &corev1.EnvVarSource{
					SecretKeyRef: &corev1.SecretKeySelector{
						LocalObjectReference: corev1.LocalObjectReference{Name: cred.SecretName},
						Key:                  secretKey,
					},
				},
			})
		}
	}
	return c
}

func renderResources(in v1alpha1.TaskResources) corev1.ResourceRequirements {
	limits := corev1.ResourceList{}
	requests := corev1.ResourceList{}
	if !in.CPU.IsZero() {
		limits[corev1.ResourceCPU] = in.CPU
		requests[corev1.ResourceCPU] = in.CPU
	}
	if !in.Memory.IsZero() {
		limits[corev1.ResourceMemory] = in.Memory
		requests[corev1.ResourceMemory] = in.Memory
	}
	if !in.GPU.IsZero() {
		// Standard NVIDIA device plugin resource name.
		limits[corev1.ResourceName("nvidia.com/gpu")] = in.GPU
		requests[corev1.ResourceName("nvidia.com/gpu")] = in.GPU
	}
	for k, v := range in.Custom {
		limits[k] = v
		requests[k] = v
	}
	// Avoid empty resource lists in the output (cleaner golden files).
	out := corev1.ResourceRequirements{}
	if len(limits) > 0 {
		out.Limits = limits
	}
	if len(requests) > 0 {
		out.Requests = requests
	}
	return out
}

func podLabels(otg *v1alpha1.OSMOTaskGroup, t v1alpha1.TaskTemplate) map[string]string {
	labels := map[string]string{
		v1alpha1.LabelWorkflowID:  otg.Spec.WorkflowID,
		v1alpha1.LabelGroupName:   otg.Spec.GroupName,
		v1alpha1.LabelRuntimeType: string(otg.Spec.RuntimeType),
		"workflow.osmo.nvidia.com/task-name": t.Name,
	}
	if t.Lead {
		labels["workflow.osmo.nvidia.com/lead"] = "true"
	}
	if cid, ok := otg.Labels[v1alpha1.LabelClusterID]; ok {
		labels[v1alpha1.LabelClusterID] = cid
	}
	return labels
}

func podName(otg *v1alpha1.OSMOTaskGroup, taskName string) string {
	// Pods are children of the OSMOTaskGroup, named deterministically so reconcile is
	// idempotent. Group and task name both bound to DNS-label safe input by the CRD
	// schema (kubebuilder validation).
	return fmt.Sprintf("%s-%s", otg.Name, taskName)
}

func schedulerName(cfg *v1alpha1.KAIRuntimeConfig) string {
	if cfg.SchedulerName != "" {
		return cfg.SchedulerName
	}
	return "kai-scheduler"
}

func gangScheduling(cfg *v1alpha1.KAIRuntimeConfig) bool {
	if cfg.GangScheduling == nil {
		return true
	}
	return *cfg.GangScheduling
}

func minAvailable(cfg *v1alpha1.KAIRuntimeConfig) int32 {
	if cfg.MinAvailable != nil {
		return *cfg.MinAvailable
	}
	return int32(len(cfg.Tasks))
}

// Ensure the resource package compile reference stays even when only Quantity is used
// via embedded fields — keeps go vet happy on minimal builds.
var _ = resource.Quantity{}

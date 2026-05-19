// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

package kai

import (
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"

	v1alpha1 "github.com/nvidia/osmo/taskgroup/api/v1alpha1"
)

// PodGroupGVK is the KAI Scheduler's PodGroup CRD GroupVersionKind.
//
// We use unstructured rather than typed Go bindings to avoid pulling the KAI Scheduler
// repo in as a build dependency. The PodGroup spec is small and stable.
var PodGroupGVK = schema.GroupVersionKind{
	Group:   "scheduling.kai.run.ai",
	Version: "v2alpha2",
	Kind:    "PodGroup",
}

// renderPodGroup builds the KAI PodGroup that gangs the task group's pods together.
// PodGroup name matches the OSMOTaskGroup name (one PodGroup per group).
func renderPodGroup(otg *v1alpha1.OSMOTaskGroup, cfg *v1alpha1.KAIRuntimeConfig) *unstructured.Unstructured {
	pg := &unstructured.Unstructured{}
	pg.SetGroupVersionKind(PodGroupGVK)
	pg.SetName(otg.Name)
	pg.SetNamespace(otg.Namespace)
	pg.SetLabels(map[string]string{
		v1alpha1.LabelWorkflowID:  otg.Spec.WorkflowID,
		v1alpha1.LabelGroupName:   otg.Spec.GroupName,
		v1alpha1.LabelRuntimeType: string(otg.Spec.RuntimeType),
	})

	spec := map[string]any{
		"minMember": minAvailable(cfg),
	}
	if cfg.Queue != "" {
		spec["queue"] = cfg.Queue
	}
	if cfg.PriorityClassName != "" {
		spec["priorityClassName"] = cfg.PriorityClassName
	}
	pg.Object["spec"] = spec
	return pg
}

// podOwnerRefToGroup builds the OwnerReference for Pods that points at the PodGroup. The
// PodGroup itself is owned by the OSMOTaskGroup, completing the cascade chain:
//
//   OSMOTaskGroup → PodGroup → Pod
//
// Delete the OSMOTaskGroup, K8s cascade-deletes the PodGroup, K8s cascade-deletes the Pods.
func podOwnerRefToGroup(pg *unstructured.Unstructured) metav1.OwnerReference {
	t := true
	return metav1.OwnerReference{
		APIVersion:         PodGroupGVK.GroupVersion().String(),
		Kind:               PodGroupGVK.Kind,
		Name:               pg.GetName(),
		UID:                pg.GetUID(),
		Controller:         &t,
		BlockOwnerDeletion: &t,
	}
}

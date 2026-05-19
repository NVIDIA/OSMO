// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

package v1alpha1

import (
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
)

// KAIRuntimeConfig is the typed shape stored in OSMOTaskGroupSpec.RuntimeConfig when
// RuntimeType == RuntimeKAI. Use UnmarshalKAIConfig to extract it from the unstructured
// transport.
type KAIRuntimeConfig struct {
	// GangScheduling toggles creation of a kai-scheduler PodGroup that holds all tasks
	// in this group together. Defaults to true if not set.
	GangScheduling *bool `json:"gangScheduling,omitempty"`

	// MinAvailable for the PodGroup. Defaults to len(Tasks) if not set.
	MinAvailable *int32 `json:"minAvailable,omitempty"`

	// SchedulerName for the rendered Pods. Defaults to "kai-scheduler".
	SchedulerName string `json:"schedulerName,omitempty"`

	// Queue is the kai-scheduler queue name. Optional.
	Queue string `json:"queue,omitempty"`

	// PriorityClassName forwarded to the rendered Pods.
	PriorityClassName string `json:"priorityClassName,omitempty"`

	// Tasks are the compact pod templates. The controller renders each into a corev1.Pod
	// with cluster-local additions (security context, default volume mounts, topology
	// spread, affinity, tolerations).
	Tasks []TaskTemplate `json:"tasks"`
}

// TaskTemplate is a compact, runtime-agnostic description of one pod in a group.
// The controller adds cluster-local boilerplate when rendering to a full Pod spec.
type TaskTemplate struct {
	// Name uniquely identifies the task within its group.
	Name string `json:"name"`

	// Lead designates which task's exit decides the group's terminal state. Exactly one
	// task should be marked lead; non-lead pods are terminated when the lead exits.
	Lead bool `json:"lead,omitempty"`

	// Image is the container image reference. Required.
	Image string `json:"image"`

	// ImagePullPolicy is forwarded as-is to the rendered container.
	ImagePullPolicy corev1.PullPolicy `json:"imagePullPolicy,omitempty"`

	// Resources is the requested + limited compute resources for the container.
	Resources TaskResources `json:"resources,omitempty"`

	// Env are additional environment variables for the container.
	Env []corev1.EnvVar `json:"env,omitempty"`

	// Command and Args override the container image's defaults.
	Command []string `json:"command,omitempty"`
	Args    []string `json:"args,omitempty"`

	// Credentials reference Secrets in the target namespace. The controller materializes
	// them into env vars (Secret keys → env names) at render time. Secret material never
	// travels in the CR body itself.
	Credentials []CredentialRef `json:"credentials,omitempty"`

	// Inputs and Outputs are URL-shaped references to data the task consumes/produces.
	// The controller passes these to the runtime container (osmo_ctrl) for download/upload.
	Inputs  []DataRef `json:"inputs,omitempty"`
	Outputs []DataRef `json:"outputs,omitempty"`

	// HostNetwork toggles host networking. Default false.
	HostNetwork bool `json:"hostNetwork,omitempty"`

	// NodeSelector and Tolerations follow the standard Pod-spec shape.
	NodeSelector map[string]string  `json:"nodeSelector,omitempty"`
	Tolerations  []corev1.Toleration `json:"tolerations,omitempty"`
}

// TaskResources expresses the resource requirements for a task. Requests and limits are
// derived from these values uniformly (request == limit) for simplicity in Phase 1.
type TaskResources struct {
	CPU    resource.Quantity            `json:"cpu,omitempty"`
	Memory resource.Quantity            `json:"memory,omitempty"`
	GPU    resource.Quantity            `json:"gpu,omitempty"`
	// Custom resources keyed by their full K8s name (e.g. "nvidia.com/mig-2g.20gb").
	Custom map[corev1.ResourceName]resource.Quantity `json:"custom,omitempty"`
}

// CredentialRef ties a target environment variable to a Secret key.
type CredentialRef struct {
	SecretName string            `json:"secretName"`
	KeyMap     map[string]string `json:"keyMap"` // {envVarName: secretKey}
}

// DataRef points at one input or output for a task. URL-shaped so it can target any
// storage backend (Swift, S3, Azure Blob, GCS) and reference outputs of upstream task groups
// by name.
type DataRef struct {
	// URL is a storage URL like swift://container/path or s3://bucket/key.
	URL string `json:"url,omitempty"`

	// Task references the named upstream task group's outputs by group name.
	Task string `json:"task,omitempty"`

	// LocalPath optionally overrides the path inside the container.
	LocalPath string `json:"localPath,omitempty"`
}

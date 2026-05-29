// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

package v1alpha1

import (
	corev1 "k8s.io/api/core/v1"
)

// RayRuntimeConfig is the typed shape stored in OSMOTaskGroupSpec.RuntimeConfig when
// RuntimeType == RuntimeRay. The reconciler in controller/runtimes/ray/ renders a
// RayJob CR (group: ray.io, kind: RayJob, version: v1) from this config. The RayJob
// embeds a RayCluster spec; we let KubeRay manage the cluster's lifecycle alongside
// the job (ShutdownAfterJobFinishes=true so the cluster is reaped with the OTG).
//
// Field shape mirrors the common subset of KubeRay's RayJob/RayCluster spec.
type RayRuntimeConfig struct {
	// Entrypoint is the command Ray submits as the job's driver. Required.
	// Example: "python /workspace/train.py --epochs 10"
	Entrypoint string `json:"entrypoint"`

	// RayVersion to install; must match the image. Defaults to "2.9.0".
	// +optional
	RayVersion string `json:"rayVersion,omitempty"`

	// RuntimeEnv is a JSON-serialized Ray runtime_env spec (pip, conda, working_dir,
	// env_vars). Forwarded as-is to RayJob.spec.runtimeEnvYAML. Optional.
	// +optional
	RuntimeEnv string `json:"runtimeEnv,omitempty"`

	// HeadGroup describes the Ray head node. Exactly one head pod is created.
	HeadGroup RayGroupSpec `json:"headGroup"`

	// WorkerGroups describes one or more Ray worker pools. Each pool can have
	// independent resource shapes (e.g. one GPU group + one CPU group).
	WorkerGroups []RayGroupSpec `json:"workerGroups,omitempty"`

	// ShutdownAfterJobFinishes controls whether KubeRay tears down the RayCluster
	// once the job terminates. Defaults to true — the OTG lifecycle owns both the
	// job and its cluster.
	// +optional
	ShutdownAfterJobFinishes *bool `json:"shutdownAfterJobFinishes,omitempty"`

	// SubmitterPodTemplate overrides the default submitter pod (the pod KubeRay
	// uses to run the entrypoint). Almost never needed — KubeRay's default
	// submitter image works for most cases.
	// +optional
	SubmitterPodTemplate *corev1.PodTemplateSpec `json:"submitterPodTemplate,omitempty"`
}

// RayGroupSpec describes a single Ray pod group (head or one of N worker groups).
type RayGroupSpec struct {
	// GroupName uniquely identifies this worker pool. Required for worker groups;
	// ignored for the head group (which is always named "head").
	GroupName string `json:"groupName,omitempty"`

	// Replicas is the initial replica count for this group. For the head group,
	// must be 1.
	Replicas int32 `json:"replicas"`

	// MinReplicas and MaxReplicas bound the autoscaler if enabled at the RayCluster
	// level. Optional.
	// +optional
	MinReplicas *int32 `json:"minReplicas,omitempty"`
	// +optional
	MaxReplicas *int32 `json:"maxReplicas,omitempty"`

	// Image is the Ray container image. Required.
	// Example: "rayproject/ray:2.9.0-py310-gpu"
	Image string `json:"image"`

	// ImagePullPolicy forwarded to the rendered pods.
	// +optional
	ImagePullPolicy corev1.PullPolicy `json:"imagePullPolicy,omitempty"`

	// Resources is the per-pod resource shape. GPU count drives the GPU
	// request; CPU/memory forwarded as-is.
	Resources TaskResources `json:"resources,omitempty"`

	// RayStartParams are forwarded to `ray start` as CLI flags
	// (e.g. {"num-cpus": "8", "num-gpus": "1", "dashboard-host": "0.0.0.0"}).
	// KubeRay overlays these onto its computed defaults.
	// +optional
	RayStartParams map[string]string `json:"rayStartParams,omitempty"`

	// Env are additional environment variables for the Ray container.
	// +optional
	Env []corev1.EnvVar `json:"env,omitempty"`

	// Credentials reference Secrets in the target namespace. The reconciler
	// materializes them into env vars at render time (Secret keys → env names).
	// +optional
	Credentials []CredentialRef `json:"credentials,omitempty"`

	// NodeSelector and Tolerations follow the standard Pod-spec shape.
	// +optional
	NodeSelector map[string]string `json:"nodeSelector,omitempty"`
	// +optional
	Tolerations []corev1.Toleration `json:"tolerations,omitempty"`
}

// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

package v1alpha1

import (
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
)

// NIMRuntimeConfig is the typed shape stored in OSMOTaskGroupSpec.RuntimeConfig when
// RuntimeType == RuntimeNIM. The reconciler in controller/runtimes/nim/ renders a
// NIMService CR (group: apps.nvidia.com, kind: NIMService) from this config.
//
// Field shape mirrors the common subset of NVIDIA NIM Operator's NIMService spec. Not
// every field of NIMService is exposed here — only what's relevant to OSMO workflow
// composition. Exact upstream field names may evolve with NIM Operator versions; the
// reconciler is the single point that adapts.
type NIMRuntimeConfig struct {
	// Image is the NIM container image including tag. Required.
	// Reconciler splits on the LAST ":" into repository + tag for the
	// NIMService spec (which requires them separate).
	// Example: "nvcr.io/nim/meta/llama-3.1-8b-instruct:1.0.0"
	Image string `json:"image"`

	// ImagePullPolicy forwarded to the NIMService pod template.
	// +optional
	ImagePullPolicy corev1.PullPolicy `json:"imagePullPolicy,omitempty"`

	// AuthSecret is the name of the docker-registry-shaped Secret in the
	// target namespace that holds nvcr.io pull credentials and the NGC API
	// key. Required by NIMService (it uses this Secret both as imagePullSecret
	// and to authenticate model artifact downloads from NGC).
	// Typical value: "ngc-image-pull" or "ngc-credentials".
	AuthSecret string `json:"authSecret"`

	// Replicas is the desired number of NIMService replicas. Defaults to 1.
	// +optional
	Replicas *int32 `json:"replicas,omitempty"`

	// Resources is the requested + limited compute resources per replica. GPU
	// count drives the GPU request; CPU/memory are forwarded as-is. Custom
	// resources (e.g. nvidia.com/mig-2g.20gb) are honored via the Custom map.
	Resources TaskResources `json:"resources,omitempty"`

	// StorageClass for the model cache PVC (if NIMService is configured to mount one).
	// +optional
	StorageClass string `json:"storageClass,omitempty"`

	// StorageSize for the model cache PVC.
	// +optional
	StorageSize *resource.Quantity `json:"storageSize,omitempty"`

	// Env are additional environment variables. Common uses: NGC_API_KEY (via
	// CredentialRef instead), NIM_MODEL_PROFILE, NIM_LOG_LEVEL, NIM_CACHE_PATH.
	// +optional
	Env []corev1.EnvVar `json:"env,omitempty"`

	// Credentials reference Secrets in the target namespace. The reconciler
	// materializes them into env vars at render time (Secret keys → env names).
	// The most common credential here is NGC_API_KEY for pulling NIM images and
	// model artifacts.
	// +optional
	Credentials []CredentialRef `json:"credentials,omitempty"`

	// NodeSelector and Tolerations follow the standard Pod-spec shape; forwarded
	// onto the NIMService template.
	// +optional
	NodeSelector map[string]string `json:"nodeSelector,omitempty"`
	// +optional
	Tolerations []corev1.Toleration `json:"tolerations,omitempty"`

	// ExposedPort is the gRPC/HTTP serving port. Defaults to 8000.
	// +optional
	ExposedPort *int32 `json:"exposedPort,omitempty"`

	// ReadinessProbeTimeout bounds how long the reconciler waits for NIMService
	// to reach Ready before reporting OTG as Failed. Defaults to 15m
	// (NIM warm-up + model load can be slow).
	// +optional
	ReadinessProbeTimeout *resource.Quantity `json:"readinessProbeTimeout,omitempty"`
}

// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

package v1alpha1

// This file holds the typed shapes for runtimes that are not yet implemented in Phase 1
// but whose CR contract is fixed up front so workflows can be written against them and
// reconcilers can be added incrementally.
//
// Each type is the shape that lands inside OSMOTaskGroupSpec.RuntimeConfig when
// RuntimeType is the matching constant. Until the reconciler is implemented, the
// dispatcher will reject CRs of that runtime type with a clear error condition.

// NIMRuntimeConfig — RuntimeType == RuntimeNIM. Phase 3.
type NIMRuntimeConfig struct {
	// Image is the NIM container reference. Required when implemented.
	Image string `json:"image"`

	// AuthSecretName references the NGC API secret in the target namespace.
	AuthSecretName string `json:"authSecretName,omitempty"`

	// Model identifies the served model.
	Model NIMModelSource `json:"model"`

	// Env are extra environment variables forwarded to the NIM container.
	Env map[string]string `json:"env,omitempty"`

	// Storage controls how model weights are staged.
	Storage *NIMStorage `json:"storage,omitempty"`

	// Resources requested for the inference container.
	Resources TaskResources `json:"resources,omitempty"`

	// Replicas for the NIMService deployment. Defaults to 1.
	Replicas *int32 `json:"replicas,omitempty"`
}

// NIMModelSource describes where the NIM finds its model weights.
type NIMModelSource struct {
	Source    string `json:"source"`    // "hf" | "ngc" | "local"
	ModelName string `json:"modelName"`
}

// NIMStorage controls model staging behavior.
type NIMStorage struct {
	PVCName         string `json:"pvcName,omitempty"`
	PVCStorageClass string `json:"pvcStorageClass,omitempty"`
	PVCSize         string `json:"pvcSize,omitempty"`
	PreDownloadJob  bool   `json:"preDownloadJob,omitempty"`
}

// RayRuntimeConfig — RuntimeType == RuntimeRay. Phase 3.
type RayRuntimeConfig struct {
	// Mode picks between long-lived RayCluster and one-shot RayJob.
	Mode       string `json:"mode"` // "cluster" | "job"
	RayVersion string `json:"rayVersion,omitempty"`

	Head   RayNodeSpec `json:"head"`
	Worker RayNodeSpec `json:"worker,omitempty"`

	// Entrypoint is the script/command for RayJob mode.
	Entrypoint string `json:"entrypoint,omitempty"`
}

type RayNodeSpec struct {
	Image     string        `json:"image"`
	Replicas  int32         `json:"replicas,omitempty"`
	Resources TaskResources `json:"resources,omitempty"`
}

// DynamoRuntimeConfig — RuntimeType == RuntimeDynamo. Phase 5.
type DynamoRuntimeConfig struct {
	Graph DynamoGraph `json:"graph"`
}

type DynamoGraph struct {
	Components []DynamoComponent `json:"components"`
	KVTransfer DynamoKVTransfer  `json:"kvTransfer,omitempty"`
}

type DynamoComponent struct {
	Name      string        `json:"name"`
	Image     string        `json:"image"`
	Replicas  int32         `json:"replicas,omitempty"`
	Resources TaskResources `json:"resources,omitempty"`
}

type DynamoKVTransfer struct {
	Backend string `json:"backend"` // "nixl" | ...
}

// GroveRuntimeConfig — RuntimeType == RuntimeGrove. Phase 5.
type GroveRuntimeConfig struct {
	Cliques   []GroveClique `json:"cliques"`
	Scheduler string        `json:"scheduler,omitempty"`
}

type GroveClique struct {
	Name     string   `json:"name"`
	Replicas int32    `json:"replicas,omitempty"`
	Members  []string `json:"members"`
}

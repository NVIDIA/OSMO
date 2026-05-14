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

// Package v1alpha1 defines the OSMOTaskGroup CRD types described in
// projects/PROJ-taskgroup-crd/PROJ-taskgroup-crd.md.
//
// The CRD is the declarative contract between the OSMO API server and the
// per-cluster controller. Schema evolution is via new CRD versions plus a
// conversion webhook; this file is the v1alpha1 surface.
package v1alpha1

import (
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
)

// Phase is the normalized lifecycle state of an OSMOTaskGroup. Each runtime's
// status mapper aggregates runtime-specific signals into one of these values
// so the API server has a stable interpretation surface across runtimes.
type Phase string

const (
	PhasePending     Phase = "Pending"
	PhaseRunning     Phase = "Running"
	PhaseSucceeded   Phase = "Succeeded"
	PhaseFailed      Phase = "Failed"
	PhaseTerminating Phase = "Terminating"
)

// RuntimeType identifies which reconciler interprets a task group.
// Phase 1 ships only RuntimeKAI; other values are reserved for later phases
// (Phase 3 NIM/Ray, Phase 5 Dynamo/Grove).
type RuntimeType string

const (
	RuntimeKAI    RuntimeType = "kai"
	RuntimeNIM    RuntimeType = "nim"
	RuntimeRay    RuntimeType = "ray"
	RuntimeDynamo RuntimeType = "dynamo"
	RuntimeGrove  RuntimeType = "grove"
)

// Standard finalizer keys.
const (
	// FinalizerLogCollection blocks cascade delete until the controller has
	// streamed Pod logs to the workflow's storage backend. Removed by the
	// controller after upload (or after a 5-minute timeout to avoid blocking
	// delete indefinitely).
	FinalizerLogCollection = "workflow.osmo.nvidia.com/log-collection"
)

// Standard label keys.
const (
	LabelWorkflowID = "osmo.nvidia.com/workflow-id"
	LabelClusterID  = "osmo.nvidia.com/cluster-id"
	LabelGroupName  = "osmo.nvidia.com/group-name"
)

// OSMOTaskGroup is the schema for the osmotaskgroups API.
//
// +kubebuilder:object:root=true
// +kubebuilder:subresource:status
// +kubebuilder:resource:scope=Namespaced,shortName=otg
// +kubebuilder:printcolumn:name="Runtime",type=string,JSONPath=`.spec.runtimeType`
// +kubebuilder:printcolumn:name="Phase",type=string,JSONPath=`.status.phase`
// +kubebuilder:printcolumn:name="Age",type=date,JSONPath=`.metadata.creationTimestamp`
type OSMOTaskGroup struct {
	metav1.TypeMeta   `json:",inline"`
	metav1.ObjectMeta `json:"metadata,omitempty"`

	Spec   OSMOTaskGroupSpec   `json:"spec,omitempty"`
	Status OSMOTaskGroupStatus `json:"status,omitempty"`
}

// OSMOTaskGroupList contains a list of OSMOTaskGroup.
//
// +kubebuilder:object:root=true
type OSMOTaskGroupList struct {
	metav1.TypeMeta `json:",inline"`
	metav1.ListMeta `json:"metadata,omitempty"`
	Items           []OSMOTaskGroup `json:"items"`
}

// OSMOTaskGroupSpec is the user-facing portion of an OSMOTaskGroup. The split
// between universal fields (workflowId, timeout, maxRetries) and the
// per-runtime RuntimeConfig mirrors the K8s Service.spec.type pattern: top
// level is stable across runtimes; the shape inside RuntimeConfig is
// discriminator-typed.
//
// etcd object size budget is 500 KB (etcd hard limit 1.5 MB). Compact task
// templates keep even 100-task groups well under that budget; the controller
// is responsible for expanding them into full Pod specs.
type OSMOTaskGroupSpec struct {
	// WorkflowID identifies the OSMO workflow this group belongs to.
	WorkflowID string `json:"workflowId"`

	// GroupIndex orders this group within the workflow's DAG.
	GroupIndex int32 `json:"groupIndex"`

	// GroupName is the user-facing name of the group from the workflow YAML.
	GroupName string `json:"groupName"`

	// RuntimeType picks the reconciler that interprets RuntimeConfig.
	// +kubebuilder:validation:Enum=kai;nim;ray;dynamo;grove
	RuntimeType RuntimeType `json:"runtimeType"`

	// RuntimeConfig holds runtime-specific configuration. Its shape varies by
	// RuntimeType. Kept as a raw extension so each runtime can evolve its own
	// schema without versioning the wrapper CRD.
	// +kubebuilder:pruning:PreserveUnknownFields
	RuntimeConfig *runtime.RawExtension `json:"runtimeConfig,omitempty"`

	// Timeout, if set, terminates the task group after this duration from
	// transition into Running. Wall-clock; not aggregated across retries.
	// +optional
	Timeout *metav1.Duration `json:"timeout,omitempty"`

	// MaxRetries caps retry attempts on transient Failed states. The
	// controller is responsible for translating retries into runtime-native
	// retry mechanisms.
	// +optional
	MaxRetries int32 `json:"maxRetries,omitempty"`

	// Priority is the workflow priority bucket the API server assigned to
	// this group at submission. The controller turns it into a
	// scheduler-native PriorityClass name (KAI: "osmo-<priority>", lowercased).
	// Free-form string at the CR level so other runtimes can map it
	// differently without re-versioning the schema.
	// +optional
	Priority string `json:"priority,omitempty"`

	// PoolName is the OSMO pool this group belongs to. The controller uses
	// it to derive scheduler-specific resources (KAI queue name:
	// "osmo-pool-<namespace>-<poolName>"). Defaults to "default" when unset.
	// +optional
	PoolName string `json:"poolName,omitempty"`
}

// KAIConfig is the RuntimeConfig shape for RuntimeKAI. It is decoded out of
// the raw RuntimeConfig RawExtension by the KAI reconciler. The Phase 0
// golden-file fixtures pin the rendered Pod + PodGroup output that the
// reconciler must reproduce from this config.
type KAIConfig struct {
	// GangScheduling, when true, requires all tasks to be admitted together
	// via a KAI PodGroup. The default for Phase 1 is true; KAI without gang
	// scheduling is not a use case we support today.
	GangScheduling bool `json:"gangScheduling,omitempty"`

	// MinAvailable overrides the default of len(Tasks). Setting this below
	// len(Tasks) allows partial gang admission, useful for elastic workloads.
	// +optional
	MinAvailable int32 `json:"minAvailable,omitempty"`

	// SchedulerName overrides the default "kai-scheduler". Pinned per-cluster
	// at controller startup unless callers need a non-default value.
	// +optional
	SchedulerName string `json:"schedulerName,omitempty"`

	// Queue is the KAI Queue name. Defaults to the pool-derived queue
	// (osmo-pool-<namespace>-<pool>) computed by the controller.
	// +optional
	Queue string `json:"queue,omitempty"`

	// Tasks is the list of compact task templates the controller expands into
	// full Pod specs.
	Tasks []KAITaskTemplate `json:"tasks"`
}

// KAITaskTemplate is the per-task compact template. Cluster-local policy
// (security context, base volume mounts, topology spread, affinity,
// tolerations) is added by the controller, not carried in the CR.
type KAITaskTemplate struct {
	// Name is the task name within the group. Must be unique within Tasks.
	Name string `json:"name"`

	// Lead marks the task whose Succeeded state determines group-level
	// Succeeded. Exactly one task must be Lead for batch workloads.
	Lead bool `json:"lead,omitempty"`

	// Image is the container image to run.
	Image string `json:"image"`

	// Resources is the resource request/limit. Maps directly to the
	// container's resources field.
	Resources corev1.ResourceRequirements `json:"resources,omitempty"`

	// Env are environment variables passed to the container.
	// +optional
	Env []corev1.EnvVar `json:"env,omitempty"`

	// Command overrides the image entrypoint.
	// +optional
	Command []string `json:"command,omitempty"`

	// Args are arguments passed to the entrypoint.
	// +optional
	Args []string `json:"args,omitempty"`

	// Inputs are storage URL or peer-task references read by the task.
	// +optional
	Inputs []DataReference `json:"inputs,omitempty"`

	// Outputs are storage URL targets the task writes to.
	// +optional
	Outputs []DataReference `json:"outputs,omitempty"`

	// Credentials are references to existing Kubernetes Secrets in the
	// cluster. Materialized as env vars or volume mounts by the controller.
	// Cleartext secrets never live in the CR body.
	// +optional
	Credentials []CredentialReference `json:"credentials,omitempty"`
}

// DataReference is a typed reference to data flowing between tasks. Either
// URL is set (object-storage path) or Task is set (peer-task reference in
// the same workflow).
type DataReference struct {
	// URL is a storage backend URL (swift://, s3://, gs://, azure://).
	// +optional
	URL string `json:"url,omitempty"`

	// Task names a peer task whose output this task consumes.
	// +optional
	Task string `json:"task,omitempty"`

	// Service references a service exposed by a task group in a possibly
	// different cluster. Phase 2 wires this up via the cluster mesh; Phase 1
	// leaves it unused.
	// +optional
	Service *ServiceReference `json:"service,omitempty"`
}

// ServiceReference is a cluster-qualified service name. The OSMO API server
// resolves it to a mesh-appropriate DNS name at workflow render time using
// the cluster's network_config; see PROJ-taskgroup-crd.md "Cross-cluster
// networking" for the resolver behavior.
type ServiceReference struct {
	Name    string `json:"name"`
	Cluster string `json:"cluster,omitempty"`
}

// CredentialReference points to a Kubernetes Secret in the target cluster.
// The controller materializes the named keys as either env vars (KeyMap) or
// volume mounts (MountPath).
type CredentialReference struct {
	SecretName string            `json:"secretName"`
	KeyMap     map[string]string `json:"keyMap,omitempty"`
	MountPath  string            `json:"mountPath,omitempty"`
}

// OSMOTaskGroupStatus is the controller-managed status surface.
type OSMOTaskGroupStatus struct {
	// Phase is the normalized lifecycle state.
	// +optional
	Phase Phase `json:"phase,omitempty"`

	// Conditions are standard Kubernetes-style conditions
	// (Ready, Progressing, ...). Each runtime's status mapper populates
	// the relevant subset.
	// +optional
	Conditions []metav1.Condition `json:"conditions,omitempty"`

	// RuntimeStatus is the runtime-specific status payload. Shape varies by
	// RuntimeType; consumers that only look at Phase + Conditions never
	// decode this field.
	// +kubebuilder:pruning:PreserveUnknownFields
	// +optional
	RuntimeStatus *runtime.RawExtension `json:"runtimeStatus,omitempty"`

	// ObservedGeneration is the .metadata.generation the controller last
	// reconciled. Standard K8s pattern for detecting reconciliation lag.
	// +optional
	ObservedGeneration int64 `json:"observedGeneration,omitempty"`

	// Retries counts attempted retries against MaxRetries.
	// +optional
	Retries int32 `json:"retries,omitempty"`

	// Message is a human-readable status summary, surfaced in `kubectl get`.
	// +optional
	Message string `json:"message,omitempty"`
}

// KAIRuntimeStatus is the typed shape of RuntimeStatus when RuntimeType=KAI.
type KAIRuntimeStatus struct {
	// PodGroupName is the name of the KAI PodGroup the reconciler created.
	PodGroupName string `json:"podGroupName,omitempty"`

	// Tasks reports per-task state aggregated from Pod phases.
	Tasks []KAITaskStatus `json:"tasks,omitempty"`
}

// KAITaskStatus is the per-task status entry under KAIRuntimeStatus.
type KAITaskStatus struct {
	Name       string             `json:"name"`
	PodName    string             `json:"podName,omitempty"`
	State      string             `json:"state,omitempty"`
	StartTime  *metav1.Time       `json:"startTime,omitempty"`
	Conditions []metav1.Condition `json:"conditions,omitempty"`
}

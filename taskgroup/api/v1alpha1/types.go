// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

package v1alpha1

import (
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
)

// RuntimeType discriminates the runtime-specific shape of OSMOTaskGroupSpec.RuntimeConfig.
//
// New runtimes are added without changing the CRD schema: register a new RuntimeType constant,
// add a matching field to RuntimeConfig, and register the runtime in the controller dispatcher.
type RuntimeType string

const (
	RuntimeKAI RuntimeType = "kai"
)

// OSMOTaskGroupSpec is the desired state of an OSMOTaskGroup.
type OSMOTaskGroupSpec struct {
	// WorkflowID identifies the parent workflow this task group belongs to. Required.
	WorkflowID string `json:"workflowId"`

	// GroupIndex is the ordinal position of this group within its workflow.
	GroupIndex int `json:"groupIndex"`

	// GroupName is the human-readable name of the group from the workflow YAML.
	GroupName string `json:"groupName"`

	// RuntimeType selects which runtime reconciler interprets RuntimeConfig.
	// +kubebuilder:validation:Enum=kai
	RuntimeType RuntimeType `json:"runtimeType"`

	// RuntimeConfig holds the runtime-specific configuration. The shape depends on
	// RuntimeType — e.g. for "kai" the bytes deserialize to KAIRuntimeConfig. We use
	// runtime.RawExtension (not Unstructured) because it round-trips JSON correctly
	// through the apiserver and `json.Unmarshal` produces a usable []byte for the
	// runtime-specific decoder.
	// +kubebuilder:validation:Schemaless
	// +kubebuilder:pruning:PreserveUnknownFields
	RuntimeConfig runtime.RawExtension `json:"runtimeConfig,omitempty"`

	// Timeout bounds how long the task group is allowed to run before being terminated.
	// Optional. If unset, defaults to 24h.
	// +optional
	Timeout *metav1.Duration `json:"timeout,omitempty"`

	// MaxRetries is the maximum number of times a failing task group will be retried
	// at the controller level before being marked permanently failed.
	// +optional
	MaxRetries int `json:"maxRetries,omitempty"`
}

// Phase represents the high-level state of an OSMOTaskGroup. Normalized across runtimes.
type Phase string

const (
	PhasePending     Phase = "Pending"
	PhaseRunning     Phase = "Running"
	PhaseSucceeded   Phase = "Succeeded"
	PhaseFailed      Phase = "Failed"
	PhaseTerminating Phase = "Terminating"
)

// Condition type constants used in Status.Conditions.
const (
	ConditionReady       = "Ready"
	ConditionProgressing = "Progressing"
)

// TaskState captures the per-task status reported by a runtime.
type TaskState struct {
	Name      string       `json:"name"`
	PodName   string       `json:"podName,omitempty"`
	State     string       `json:"state"`
	StartTime *metav1.Time `json:"startTime,omitempty"`
	EndTime   *metav1.Time `json:"endTime,omitempty"`
	ExitCode  *int32       `json:"exitCode,omitempty"`
	Message   string       `json:"message,omitempty"`
}

// OSMOTaskGroupStatus is the observed state of an OSMOTaskGroup. The top-level fields
// (Phase, Conditions, ObservedGeneration, Retries, Message) are normalized across runtimes
// so the workflow controller and any UI have a stable interpretation surface.
//
// RuntimeStatus is opaque runtime-specific payload — the runtime reconciler writes it;
// the workflow controller does not interpret it.
type OSMOTaskGroupStatus struct {
	Phase              Phase                `json:"phase,omitempty"`
	Conditions         []metav1.Condition   `json:"conditions,omitempty"`
	Tasks              []TaskState          `json:"tasks,omitempty"`
	// +kubebuilder:validation:Schemaless
	// +kubebuilder:pruning:PreserveUnknownFields
	RuntimeStatus      runtime.RawExtension `json:"runtimeStatus,omitempty"`
	ObservedGeneration int64                `json:"observedGeneration,omitempty"`
	Retries            int                  `json:"retries,omitempty"`
	Message            string               `json:"message,omitempty"`
}

// OSMOTaskGroup is the Schema for the osmotaskgroups API.
//
// +kubebuilder:object:root=true
// +kubebuilder:subresource:status
// +kubebuilder:resource:shortName=otg
// +kubebuilder:printcolumn:name="Runtime",type=string,JSONPath=`.spec.runtimeType`
// +kubebuilder:printcolumn:name="Phase",type=string,JSONPath=`.status.phase`
// +kubebuilder:printcolumn:name="Workflow",type=string,JSONPath=`.spec.workflowId`
// +kubebuilder:printcolumn:name="Age",type=date,JSONPath=`.metadata.creationTimestamp`
type OSMOTaskGroup struct {
	metav1.TypeMeta   `json:",inline"`
	metav1.ObjectMeta `json:"metadata,omitempty"`

	Spec   OSMOTaskGroupSpec   `json:"spec,omitempty"`
	Status OSMOTaskGroupStatus `json:"status,omitempty"`
}

// +kubebuilder:object:root=true

// OSMOTaskGroupList contains a list of OSMOTaskGroup.
type OSMOTaskGroupList struct {
	metav1.TypeMeta `json:",inline"`
	metav1.ListMeta `json:"metadata,omitempty"`
	Items           []OSMOTaskGroup `json:"items"`
}

// Finalizer names owned by this controller.
const (
	// FinalizerLogCollection ensures the controller flushes container logs to object storage
	// before Kubernetes cascade-deletes the rendered child resources.
	FinalizerLogCollection = "workflow.osmo.nvidia.com/log-collection"

	// FinalizerRemoteCleanup blocks OSMOWorkflow deletion until the Workflow Controller
	// has dispatched DeleteOTG commands for every remote (cross-cluster) OSMOTaskGroup
	// it created. Cross-cluster owner references don't exist in Kubernetes, so without
	// this the remote children would leak.
	FinalizerRemoteCleanup = "workflow.osmo.nvidia.com/remote-cleanup"
)

// Label keys.
const (
	// LabelWorkflowID is set on the CR and all rendered child resources to identify the
	// owning workflow.
	LabelWorkflowID = "workflow.osmo.nvidia.com/workflow-id"

	// LabelGroupName is set on rendered child resources to identify their owning group.
	LabelGroupName = "workflow.osmo.nvidia.com/group-name"

	// LabelClusterID identifies which cluster a CR is targeted at. Single-cluster
	// deployments may ignore it; Phase 2 multi-cluster dispatch uses it for routing.
	LabelClusterID = "workflow.osmo.nvidia.com/cluster-id"

	// LabelRuntimeType mirrors spec.runtimeType for selector convenience.
	LabelRuntimeType = "workflow.osmo.nvidia.com/runtime-type"
)

func init() {
	SchemeBuilder.Register(&OSMOTaskGroup{}, &OSMOTaskGroupList{})
}

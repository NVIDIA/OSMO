// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

package v1alpha1

import (
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
)

// OSMOWorkflow is the parent resource that orchestrates a DAG of OSMOTaskGroup CRs.
// It lives in the control cluster; the Workflow Controller in that cluster creates one
// OSMOTaskGroup per group in the workflow's spec, in the right backend cluster, when each
// group's dependencies are satisfied.
//
// In Architecture B (no Postgres) this is the source of truth for "what a user submitted."
// Status of the workflow is the rollup of its children's statuses, projected back here.
//
// +kubebuilder:object:root=true
// +kubebuilder:subresource:status
// +kubebuilder:resource:shortName=owf
// +kubebuilder:printcolumn:name="Phase",type=string,JSONPath=`.status.phase`
// +kubebuilder:printcolumn:name="Groups",type=integer,JSONPath=`.status.groupsTotal`
// +kubebuilder:printcolumn:name="Done",type=integer,JSONPath=`.status.groupsSucceeded`
// +kubebuilder:printcolumn:name="Age",type=date,JSONPath=`.metadata.creationTimestamp`
type OSMOWorkflow struct {
	metav1.TypeMeta   `json:",inline"`
	metav1.ObjectMeta `json:"metadata,omitempty"`

	Spec   OSMOWorkflowSpec   `json:"spec,omitempty"`
	Status OSMOWorkflowStatus `json:"status,omitempty"`
}

// OSMOWorkflowSpec describes a DAG of task groups to be executed.
type OSMOWorkflowSpec struct {
	// Groups is the ordered list of task groups in this workflow. Order is informational;
	// actual dispatch order is determined by DependsOn.
	Groups []WorkflowGroup `json:"groups"`

	// Timeout bounds the entire workflow. If exceeded, all in-flight TaskGroups are
	// cancelled and the workflow is marked Failed. Optional.
	// +optional
	Timeout *metav1.Duration `json:"timeout,omitempty"`

	// Owner is the workflow submitter (username/email). Set by the API server from the
	// authenticated JWT; immutable after creation. Used for audit and quota.
	// +optional
	Owner string `json:"owner,omitempty"`

	// TTLSecondsAfterFinished, when set, schedules the workflow (and all its child
	// OSMOTaskGroups via the normal delete cascade) for deletion this many seconds
	// after it reaches a terminal phase (Succeeded or Failed). 0 = delete immediately
	// on terminal. nil = never auto-delete (the controller's --default-ttl-after-finished
	// flag still applies). Mirrors batch/v1 Job's field of the same name.
	// +optional
	TTLSecondsAfterFinished *int32 `json:"ttlSecondsAfterFinished,omitempty"`
}

// WorkflowGroup is one node of the workflow DAG. The Workflow Controller materializes
// each group as an OSMOTaskGroup CR once its DependsOn entries are all Succeeded.
type WorkflowGroup struct {
	// Name uniquely identifies the group within the workflow. Used as a node label in the
	// DAG and as the basis for the generated OSMOTaskGroup name.
	Name string `json:"name"`

	// DependsOn names other groups in the same workflow that must reach Succeeded before
	// this group is dispatched. Empty = run immediately at workflow start.
	// +optional
	DependsOn []string `json:"dependsOn,omitempty"`

	// Cluster names the backend cluster this group should run in. If empty, the workflow
	// runs in the control cluster (Phase 1 single-cluster default). For multi-cluster
	// workflows the Cluster field is required.
	// +optional
	Cluster string `json:"cluster,omitempty"`

	// RuntimeType selects which TaskGroup runtime interprets RuntimeConfig.
	// +kubebuilder:validation:Enum=kai;nim;ray;dynamo;grove
	RuntimeType RuntimeType `json:"runtimeType"`

	// RuntimeConfig is forwarded verbatim into the rendered OSMOTaskGroup's spec.runtimeConfig.
	// +kubebuilder:validation:Schemaless
	// +kubebuilder:pruning:PreserveUnknownFields
	RuntimeConfig runtime.RawExtension `json:"runtimeConfig,omitempty"`
}

// OSMOWorkflowStatus is the observed state. Updated by the Workflow Controller based on
// child OSMOTaskGroup statuses received via the Operator Service stream.
type OSMOWorkflowStatus struct {
	// Phase is the rolled-up workflow phase.
	Phase Phase `json:"phase,omitempty"`

	Conditions []metav1.Condition `json:"conditions,omitempty"`

	// Groups holds per-group status keyed by group name. The Workflow Controller writes
	// here on every reconcile.
	Groups map[string]WorkflowGroupStatus `json:"groups,omitempty"`

	// GroupsTotal and GroupsSucceeded are denormalized counters for the printer columns.
	GroupsTotal     int32 `json:"groupsTotal,omitempty"`
	GroupsSucceeded int32 `json:"groupsSucceeded,omitempty"`
	GroupsFailed    int32 `json:"groupsFailed,omitempty"`

	ObservedGeneration int64 `json:"observedGeneration,omitempty"`

	// CompletionTime is stamped the first time Phase reaches a terminal state (Succeeded
	// or Failed). Used together with Spec.TTLSecondsAfterFinished to schedule auto-
	// deletion. Never cleared once set.
	// +optional
	CompletionTime *metav1.Time `json:"completionTime,omitempty"`

	// Message holds the most recent human-readable error or status note.
	Message string `json:"message,omitempty"`
}

// WorkflowGroupStatus is the controller's view of one group within a workflow.
type WorkflowGroupStatus struct {
	// Phase is the latest known phase of the underlying OSMOTaskGroup.
	Phase Phase `json:"phase,omitempty"`

	// TaskGroupRef points at the OSMOTaskGroup CR that materializes this workflow group.
	// In single-cluster mode the ref's Cluster is empty (means "this cluster").
	TaskGroupRef TaskGroupRef `json:"taskGroupRef,omitempty"`

	// LastUpdated is when the Workflow Controller last received a status update for
	// this group from the Operator Service stream.
	LastUpdated *metav1.Time `json:"lastUpdated,omitempty"`

	Message string `json:"message,omitempty"`
}

// TaskGroupRef identifies one OSMOTaskGroup, possibly in a different cluster.
type TaskGroupRef struct {
	Cluster   string `json:"cluster,omitempty"`
	Namespace string `json:"namespace"`
	Name      string `json:"name"`
	UID       string `json:"uid,omitempty"`
}

// +kubebuilder:object:root=true

type OSMOWorkflowList struct {
	metav1.TypeMeta `json:",inline"`
	metav1.ListMeta `json:"metadata,omitempty"`
	Items           []OSMOWorkflow `json:"items"`
}

func init() {
	SchemeBuilder.Register(&OSMOWorkflow{}, &OSMOWorkflowList{})
}

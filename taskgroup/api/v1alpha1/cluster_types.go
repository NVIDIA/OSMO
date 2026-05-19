// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

package v1alpha1

import (
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// OSMOCluster is the registry entry for a backend cluster. It lives in the control
// cluster (alongside OSMOWorkflow CRs). The cluster registry has two purposes:
//
//   1. Declaring the cluster exists and how to reach its services (network_config,
//      mesh type, region).
//   2. Tracking whether the cluster's TaskGroup Controller is currently connected to
//      the Operator Service (a live status field updated by the Operator Service on
//      session open/close).
//
// Workflow groups reference a cluster by Name (matching metadata.name of an
// OSMOCluster). The Workflow Controller uses the registry to know which Operator
// Service stream to send CreateOTG commands on.
//
// +kubebuilder:object:root=true
// +kubebuilder:subresource:status
// +kubebuilder:resource:scope=Cluster,shortName=ocl
// +kubebuilder:printcolumn:name="Region",type=string,JSONPath=`.spec.region`
// +kubebuilder:printcolumn:name="Mesh",type=string,JSONPath=`.spec.network.type`
// +kubebuilder:printcolumn:name="Status",type=string,JSONPath=`.status.connection`
// +kubebuilder:printcolumn:name="Age",type=date,JSONPath=`.metadata.creationTimestamp`
type OSMOCluster struct {
	metav1.TypeMeta   `json:",inline"`
	metav1.ObjectMeta `json:"metadata,omitempty"`

	Spec   OSMOClusterSpec   `json:"spec,omitempty"`
	Status OSMOClusterStatus `json:"status,omitempty"`
}

// OSMOClusterSpec describes a registered backend cluster.
type OSMOClusterSpec struct {
	// Region is informational (e.g. "eastus", "us-west", "on-prem-bld-3"). Useful for
	// data-locality heuristics in the workflow router.
	Region string `json:"region,omitempty"`

	// Provider identifies the substrate (e.g. "aks", "eks", "gke", "coreweave",
	// "nebius", "on-prem"). Informational.
	Provider string `json:"provider,omitempty"`

	// Network describes how cross-cluster service discovery works for this cluster.
	// In Phase 1 this is recorded but not acted on. Phase 2+ uses it to dispatch the
	// right ServiceDiscoveryReconciler.
	Network ClusterNetwork `json:"network,omitempty"`

	// GPUTypes lists the GPU SKUs available on this cluster (informational, used by
	// schedulers and the API server's quota checks).
	GPUTypes []string `json:"gpuTypes,omitempty"`
}

// ClusterNetwork captures the deployment's choice of cross-cluster mesh for one cluster.
// Workflow groups in this cluster expose Services via the mesh's discovery primitive
// (e.g. Submariner ServiceExport, Tailscale annotation).
type ClusterNetwork struct {
	// Type names the mesh implementation. Empty means "no mesh; this cluster is
	// isolated for cross-cluster service calls".
	// +kubebuilder:validation:Enum=submariner;tailnet;netmaker;ingress;""
	Type string `json:"type,omitempty"`

	// Config is a free-form bag whose schema depends on Type. See each mesh package's
	// doc.go for the expected keys.
	// +optional
	Config map[string]string `json:"config,omitempty"`
}

// OSMOClusterStatus reflects the current liveness of the cluster's TaskGroup Controller
// and any operator-service-side observations.
type OSMOClusterStatus struct {
	// Connection is the latest known liveness state of the cluster's session to the
	// Operator Service.
	// +kubebuilder:validation:Enum=Connected;Disconnected;Unknown
	Connection ClusterConnectionState `json:"connection,omitempty"`

	// LastSeen is when the Operator Service last received any message from this cluster's
	// controller (heartbeat, status event, or initial Hello).
	LastSeen *metav1.Time `json:"lastSeen,omitempty"`

	// ControllerVersion is reported by the controller on each Hello. Used to detect
	// version skew between controllers and the operator service.
	ControllerVersion string `json:"controllerVersion,omitempty"`

	// SupportedRuntimes is the list of RuntimeType values this cluster's controller has
	// reconcilers registered for. The Workflow Controller validates per-group runtime
	// targets against this list.
	SupportedRuntimes []RuntimeType `json:"supportedRuntimes,omitempty"`

	Conditions []metav1.Condition `json:"conditions,omitempty"`
}

// ClusterConnectionState enumerates the controller-session liveness states.
type ClusterConnectionState string

const (
	ClusterConnected    ClusterConnectionState = "Connected"
	ClusterDisconnected ClusterConnectionState = "Disconnected"
	ClusterUnknown      ClusterConnectionState = "Unknown"
)

// +kubebuilder:object:root=true

type OSMOClusterList struct {
	metav1.TypeMeta `json:",inline"`
	metav1.ListMeta `json:"metadata,omitempty"`
	Items           []OSMOCluster `json:"items"`
}

func init() {
	SchemeBuilder.Register(&OSMOCluster{}, &OSMOClusterList{})
}

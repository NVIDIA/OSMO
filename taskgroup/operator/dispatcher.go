// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

package operator

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"sigs.k8s.io/yaml"

	v1alpha1 "github.com/nvidia/osmo/taskgroup/api/v1alpha1"
	operatorpb "github.com/nvidia/osmo/taskgroup/operator/proto"
)

// CommandBus is the in-process API the Workflow Controller calls to send commands to
// remote clusters. It wraps the SessionRegistry with a friendlier signature.
//
// Both Workflow Controller and Operator Service run in the same binary in the control
// cluster, so there's no extra RPC hop here — just a Go method call.
type CommandBus struct {
	Sessions *SessionRegistry
}

// DispatchCreateOTG serializes the OSMOTaskGroup as YAML and sends a CreateOTG command
// to the cluster's open stream. Returns ErrClusterNotConnected if the cluster has no
// live session right now.
//
// The OSMOTaskGroup namespace is taken from otg.Namespace and is applied verbatim on the
// remote side. Callers should ensure the remote namespace exists / is the convention
// across the deployment.
func (b *CommandBus) DispatchCreateOTG(ctx context.Context, clusterID string, otg *v1alpha1.OSMOTaskGroup) error {
	if !b.Sessions.Connected(clusterID) {
		return ErrClusterNotConnected
	}
	// Strip server-side fields that don't apply on the remote: ResourceVersion, UID,
	// CreationTimestamp, etc. We're effectively saying "create THIS spec over there".
	clean := otg.DeepCopy()
	clean.ObjectMeta = metav1.ObjectMeta{
		Name:        otg.Name,
		Namespace:   otg.Namespace,
		Labels:      otg.Labels,
		Annotations: otg.Annotations,
		Finalizers:  otg.Finalizers,
	}
	clean.Status = v1alpha1.OSMOTaskGroupStatus{}

	raw, err := yaml.Marshal(clean)
	if err != nil {
		return fmt.Errorf("serializing OSMOTaskGroup: %w", err)
	}
	cmd := &operatorpb.CreateOTG{
		CommandId: uuid.NewString(),
		OtgYaml:   raw,
	}
	return b.Sessions.Send(clusterID, &operatorpb.OperatorEnvelope{
		Body: &operatorpb.OperatorEnvelope_Create{Create: cmd},
	})
}

// DispatchDeleteOTG sends a DeleteOTG command. Idempotent on the remote side: a delete
// for a non-existent OTG is treated as success.
func (b *CommandBus) DispatchDeleteOTG(ctx context.Context, clusterID, namespace, name string) error {
	if !b.Sessions.Connected(clusterID) {
		return ErrClusterNotConnected
	}
	cmd := &operatorpb.DeleteOTG{
		CommandId: uuid.NewString(),
		Namespace: namespace,
		Name:      name,
	}
	return b.Sessions.Send(clusterID, &operatorpb.OperatorEnvelope{
		Body: &operatorpb.OperatorEnvelope_Delete{Delete: cmd},
	})
}

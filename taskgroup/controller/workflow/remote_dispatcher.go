// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

package workflow

import (
	"context"
	"fmt"

	v1alpha1 "github.com/nvidia/osmo/taskgroup/api/v1alpha1"
	"github.com/nvidia/osmo/taskgroup/operator"
)

// RemoteDispatcher dispatches OSMOTaskGroup CRs to a remote cluster via the Operator
// Service's session stream.
//
// "Remote" here means "any cluster other than the one this Workflow Controller runs in."
// In a single-cluster all-in-one deployment, only LocalDispatcher is used; the
// RemoteDispatcher is constructed per-cluster lazily by the Reconciler's RemoteResolver
// when a workflow group declares a non-empty `cluster`.
type RemoteDispatcher struct {
	ClusterID string
	Namespace string // target namespace on the remote cluster
	Bus       *operator.CommandBus
}

// Create implements Dispatcher.
//
// Idempotency: the remote controller's session-client handler treats AlreadyExists as
// success, so a retried Create is safe.
func (d *RemoteDispatcher) Create(ctx context.Context, wf *v1alpha1.OSMOWorkflow, group v1alpha1.WorkflowGroup) (v1alpha1.TaskGroupRef, error) {
	name := otgName(wf.Name, group.Name)
	otg := &v1alpha1.OSMOTaskGroup{
		Spec: v1alpha1.OSMOTaskGroupSpec{
			WorkflowID:    wf.Name,
			GroupName:     group.Name,
			GroupIndex:    indexOf(wf.Spec.Groups, group.Name),
			RuntimeType:   group.RuntimeType,
			RuntimeConfig: group.RuntimeConfig,
			Timeout:       wf.Spec.Timeout,
		},
	}
	otg.SetName(name)
	otg.SetNamespace(d.Namespace)
	otg.SetLabels(map[string]string{
		v1alpha1.LabelWorkflowID:  wf.Name,
		v1alpha1.LabelGroupName:   group.Name,
		v1alpha1.LabelRuntimeType: string(group.RuntimeType),
		v1alpha1.LabelClusterID:   d.ClusterID,
	})

	if err := d.Bus.DispatchCreateOTG(ctx, d.ClusterID, otg); err != nil {
		return v1alpha1.TaskGroupRef{}, fmt.Errorf("dispatching CreateOTG to %q: %w", d.ClusterID, err)
	}

	return v1alpha1.TaskGroupRef{
		Cluster:   d.ClusterID,
		Namespace: d.Namespace,
		Name:      name,
		// UID is unknown until the remote side echoes status back. Empty for now;
		// the Workflow Controller's status-rollup path treats this as "Pending".
	}, nil
}

// Delete sends a DeleteOTG command to the cluster's session. Returns nil if the cluster
// is no longer connected — Kubernetes garbage collection will eventually catch up via
// the parent's deletion, and the remote controller's idempotent handling means a later
// retry succeeds.
func (d *RemoteDispatcher) Delete(ctx context.Context, ref v1alpha1.TaskGroupRef) error {
	err := d.Bus.DispatchDeleteOTG(ctx, ref.Cluster, ref.Namespace, ref.Name)
	if err == operator.ErrClusterNotConnected {
		return nil // best-effort
	}
	return err
}

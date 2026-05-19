// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

package workflow

import (
	"context"
	"fmt"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/controller/controllerutil"

	v1alpha1 "github.com/nvidia/osmo/taskgroup/api/v1alpha1"
)

// Dispatcher creates the OSMOTaskGroup CR for one workflow group in its target cluster.
// In single-cluster (Phase 1) it writes to the local K8s API. In multi-cluster (Phase 2+)
// it sends a CreateOTG command on the Operator Service's stream to the target cluster's
// controller.
//
// Two implementations are wired below: localDispatcher and remoteDispatcher. The Workflow
// Controller picks one per group based on whether group.Cluster names a remote cluster.
type Dispatcher interface {
	// Create materializes the workflow group as an OSMOTaskGroup CR in the target cluster.
	// Returns a TaskGroupRef pointing at the created CR (cluster/namespace/name/uid).
	// Idempotent: calling twice for the same workflow + group returns the existing ref.
	Create(ctx context.Context, wf *v1alpha1.OSMOWorkflow, group v1alpha1.WorkflowGroup) (v1alpha1.TaskGroupRef, error)

	// Delete removes the OSMOTaskGroup CR identified by ref. Cascade deletion of child
	// pods/podgroups happens via Kubernetes owner references inside the target cluster.
	Delete(ctx context.Context, ref v1alpha1.TaskGroupRef) error
}

// LocalDispatcher writes OSMOTaskGroup CRs to the controller's own K8s API. Used for
// workflow groups that target the control cluster (or for single-cluster deployments).
type LocalDispatcher struct {
	Client    client.Client
	Namespace string // namespace where OSMOTaskGroup CRs are created
}

// Create implements Dispatcher.
func (d *LocalDispatcher) Create(ctx context.Context, wf *v1alpha1.OSMOWorkflow, group v1alpha1.WorkflowGroup) (v1alpha1.TaskGroupRef, error) {
	name := otgName(wf.Name, group.Name)
	otg := &v1alpha1.OSMOTaskGroup{
		ObjectMeta: metav1.ObjectMeta{
			Name:      name,
			Namespace: d.Namespace,
			Labels: map[string]string{
				v1alpha1.LabelWorkflowID:  wf.Name,
				v1alpha1.LabelGroupName:   group.Name,
				v1alpha1.LabelRuntimeType: string(group.RuntimeType),
			},
		},
		Spec: v1alpha1.OSMOTaskGroupSpec{
			WorkflowID:    wf.Name,
			GroupName:     group.Name,
			GroupIndex:    indexOf(wf.Spec.Groups, group.Name),
			RuntimeType:   group.RuntimeType,
			RuntimeConfig: group.RuntimeConfig,
			Timeout:       wf.Spec.Timeout,
		},
	}
	// OSMOTaskGroup is owned by the OSMOWorkflow so cascade delete propagates to children.
	if err := controllerutil.SetControllerReference(wf, otg, d.Client.Scheme()); err != nil {
		return v1alpha1.TaskGroupRef{}, fmt.Errorf("setting owner: %w", err)
	}

	err := d.Client.Create(ctx, otg)
	switch {
	case err == nil:
	case apierrors.IsAlreadyExists(err):
		// Idempotent retry — fetch the existing CR to return its UID.
		if getErr := d.Client.Get(ctx, types.NamespacedName{Name: name, Namespace: d.Namespace}, otg); getErr != nil {
			return v1alpha1.TaskGroupRef{}, fmt.Errorf("reading back existing OSMOTaskGroup: %w", getErr)
		}
	default:
		return v1alpha1.TaskGroupRef{}, fmt.Errorf("creating OSMOTaskGroup: %w", err)
	}

	return v1alpha1.TaskGroupRef{
		Cluster:   "", // empty = local
		Namespace: otg.Namespace,
		Name:      otg.Name,
		UID:       string(otg.UID),
	}, nil
}

// Delete implements Dispatcher.
func (d *LocalDispatcher) Delete(ctx context.Context, ref v1alpha1.TaskGroupRef) error {
	otg := &v1alpha1.OSMOTaskGroup{}
	if err := d.Client.Get(ctx, types.NamespacedName{Name: ref.Name, Namespace: ref.Namespace}, otg); err != nil {
		if apierrors.IsNotFound(err) {
			return nil
		}
		return err
	}
	return client.IgnoreNotFound(d.Client.Delete(ctx, otg))
}

// remoteDispatcher dispatches CRs to another cluster via the Operator Service's session
// stream. Phase 2 implementation. Phase 1 returns an error if used.
//
// Wire in by injecting a session.RemoteSink (defined in operator/session) that resolves
// cluster_id → stream and sends ControllerEnvelope{OperatorEnvelope_Create} on it.

// otgName generates a stable, K8s-DNS-label-safe OSMOTaskGroup name from a workflow name
// and group name. Deterministic so retries are idempotent.
func otgName(workflowName, groupName string) string {
	return fmt.Sprintf("%s-%s", workflowName, groupName)
}

// indexOf returns the position of group `name` in the workflow's Groups slice.
// Used to populate OSMOTaskGroupSpec.GroupIndex which the runtimes use for printing.
func indexOf(groups []v1alpha1.WorkflowGroup, name string) int {
	for i, g := range groups {
		if g.Name == name {
			return i
		}
	}
	return -1
}

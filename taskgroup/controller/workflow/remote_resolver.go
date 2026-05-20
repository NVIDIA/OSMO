// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

package workflow

import (
	"context"
	"fmt"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/types"
	"sigs.k8s.io/controller-runtime/pkg/client"

	v1alpha1 "github.com/nvidia/osmo/taskgroup/api/v1alpha1"
	"github.com/nvidia/osmo/taskgroup/operator"
)

// NewRemoteResolver returns a function that resolves cluster IDs to RemoteDispatchers.
// The Workflow Reconciler's RemoteResolver field is set to this function in multi-cluster
// deployments. In single-cluster Phase 1 the field stays nil and only LocalDispatcher is
// used.
//
// The resolver consults OSMOCluster CRs to:
//   - confirm the cluster is registered (returns an error otherwise)
//   - check status.connection == Connected (returns an error if not, so the Workflow
//     Controller surfaces "waiting for cluster X" rather than silently dispatching to
//     a dead session)
//
// The OSMOCluster namespace for OTGs is hardcoded to taskGroupNamespace for the MVP. A
// future enhancement could store this in OSMOClusterSpec.
func NewRemoteResolver(c client.Client, bus *operator.CommandBus, taskGroupNamespace string) func(clusterID string) (Dispatcher, error) {
	return func(clusterID string) (Dispatcher, error) {
		var cluster v1alpha1.OSMOCluster
		if err := c.Get(context.Background(), types.NamespacedName{Name: clusterID}, &cluster); err != nil {
			if apierrors.IsNotFound(err) {
				return nil, fmt.Errorf("OSMOCluster %q not registered", clusterID)
			}
			return nil, err
		}
		if cluster.Status.Connection != v1alpha1.ClusterConnected {
			return nil, fmt.Errorf("cluster %q is %s (need Connected)", clusterID, cluster.Status.Connection)
		}
		return &RemoteDispatcher{
			ClusterID: clusterID,
			Namespace: taskGroupNamespace,
			Bus:       bus,
		}, nil
	}
}

// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// SPDX-License-Identifier: Apache-2.0

package taskgroup

import (
	"context"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"

	taskgroupv1alpha1 "go.corp.nvidia.com/osmo/apis/taskgroup/v1alpha1"
)

type Reconciler interface {
	ReconcileRuntime(ctx context.Context, otg *taskgroupv1alpha1.OSMOTaskGroup) error
}

type StatusMapper interface {
	MapStatus(ctx context.Context, otg *taskgroupv1alpha1.OSMOTaskGroup) (taskgroupv1alpha1.OSMOTaskGroupStatus, error)
}

type RuntimeHandler interface {
	Reconciler
	StatusMapper
}

type GenericCRDReconciler interface {
	Apply(ctx context.Context, objects []unstructured.Unstructured) error
}

type ServiceDiscoveryReconciler interface {
	ReconcileServices(ctx context.Context, otg *taskgroupv1alpha1.OSMOTaskGroup) error
}

type LogCollector interface {
	CollectPodLogs(ctx context.Context, otg *taskgroupv1alpha1.OSMOTaskGroup, pods []corev1.Pod) error
}

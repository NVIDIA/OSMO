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
	"testing"

	"k8s.io/apimachinery/pkg/types"

	taskgroupv1alpha1 "go.corp.nvidia.com/osmo/apis/taskgroup/v1alpha1"
)

func TestUpdateStatusWritesCRStatusOnly(t *testing.T) {
	ctx := context.Background()
	otg := testOTG(taskgroupv1alpha1.ModeActive)
	kubernetesClient := newFakeClient(t, otg)
	reconciler := NewTaskGroupReconciler(kubernetesClient, kubernetesClient.Scheme())

	if err := reconciler.updateStatus(ctx, otg, taskgroupv1alpha1.OSMOTaskGroupStatus{
		Phase: taskgroupv1alpha1.PhaseRunning,
	}); err != nil {
		t.Fatalf("updateStatus() error = %v", err)
	}
	updated := &taskgroupv1alpha1.OSMOTaskGroup{}
	if err := kubernetesClient.Get(ctx, types.NamespacedName{
		Namespace: otg.Namespace,
		Name:      otg.Name,
	}, updated); err != nil {
		t.Fatalf("Get() error = %v", err)
	}
	if updated.Status.Phase != taskgroupv1alpha1.PhaseRunning {
		t.Fatalf("status phase = %q, want %q", updated.Status.Phase, taskgroupv1alpha1.PhaseRunning)
	}
}

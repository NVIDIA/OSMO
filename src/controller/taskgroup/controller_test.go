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

	taskgroupv1alpha1 "go.corp.nvidia.com/osmo/apis/taskgroup/v1alpha1"
)

func TestUpdateStatusReportsThroughGRPCBoundary(t *testing.T) {
	ctx := context.Background()
	otg := testOTG(taskgroupv1alpha1.ModeActive)
	kubernetesClient := newFakeClient(t, otg)
	reporter := &recordingStatusReporter{}
	reconciler := NewTaskGroupReconciler(kubernetesClient, kubernetesClient.Scheme())
	reconciler.StatusReporter = reporter

	if err := reconciler.updateStatus(ctx, otg, taskgroupv1alpha1.OSMOTaskGroupStatus{
		Phase: taskgroupv1alpha1.PhaseRunning,
	}); err != nil {
		t.Fatalf("updateStatus() error = %v", err)
	}
	if reporter.phase != taskgroupv1alpha1.PhaseRunning {
		t.Fatalf("reported phase = %q, want %q", reporter.phase, taskgroupv1alpha1.PhaseRunning)
	}
}

type recordingStatusReporter struct {
	phase taskgroupv1alpha1.OSMOTaskGroupPhase
}

func (r *recordingStatusReporter) ReportStatus(
	_ context.Context,
	_ *taskgroupv1alpha1.OSMOTaskGroup,
	status taskgroupv1alpha1.OSMOTaskGroupStatus,
) error {
	r.phase = status.Phase
	return nil
}

/*
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

SPDX-License-Identifier: Apache-2.0
*/

package kai

import (
	"context"
	"encoding/json"
	"testing"

	workflowv1alpha1 "go.corp.nvidia.com/osmo/apis/workflow/v1alpha1"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/dynamic"
)

// noopDynamic is a non-nil dynamic.Interface that panics if any method is
// called. Tests that just need to flip the "is a client wired?" branch use
// this so we don't drag in the fake client (which pulls a transitive
// json-patch dep not in MODULE.bazel).
type noopDynamic struct{ dynamic.Interface }

func makeOTG(t *testing.T, tasks []workflowv1alpha1.KAITaskTemplate) *workflowv1alpha1.OSMOTaskGroup {
	t.Helper()
	cfg := workflowv1alpha1.KAIConfig{
		GangScheduling: true,
		Tasks:          tasks,
	}
	raw, err := json.Marshal(cfg)
	if err != nil {
		t.Fatalf("marshal cfg: %v", err)
	}
	return &workflowv1alpha1.OSMOTaskGroup{
		ObjectMeta: metav1.ObjectMeta{Name: "group-xyz", Namespace: "osmo-test"},
		Spec: workflowv1alpha1.OSMOTaskGroupSpec{
			WorkflowID:    "wf-abc",
			GroupName:     "training",
			RuntimeType:   workflowv1alpha1.RuntimeKAI,
			RuntimeConfig: &runtime.RawExtension{Raw: raw},
		},
	}
}

func TestRenderSingleTask(t *testing.T) {
	r := &Reconciler{Config: Config{SchedulerName: "kai-scheduler", Namespace: "osmo-test"}}
	otg := makeOTG(t, []workflowv1alpha1.KAITaskTemplate{
		{Name: "worker_0", Lead: true, Image: "nvcr.io/example/user:1.0"},
	})
	cfg, err := DecodeKAIConfig(otg)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	out, err := r.Render(otg, cfg)
	if err != nil {
		t.Fatalf("Render: %v", err)
	}
	if out.PodGroup == nil {
		t.Fatal("no podgroup")
	}
	if got, want := out.PodGroup.Spec.MinMember, int32(1); got != want {
		t.Errorf("minMember=%d, want %d", got, want)
	}
	if got, want := out.PodGroup.Spec.Queue, "osmo-pool-osmo-test-default"; got != want {
		t.Errorf("queue=%q, want %q", got, want)
	}
	if len(out.Pods) != 1 {
		t.Fatalf("got %d pods, want 1", len(out.Pods))
	}
	pod := out.Pods[0]
	if got, want := pod.Spec.SchedulerName, "kai-scheduler"; got != want {
		t.Errorf("schedulerName=%q, want %q", got, want)
	}
	if got := pod.Annotations["pod-group-name"]; got != otg.Name {
		t.Errorf("pod-group-name annotation=%q, want %q", got, otg.Name)
	}
}

func TestRenderRequiresTasks(t *testing.T) {
	r := &Reconciler{Config: Config{SchedulerName: "kai-scheduler", Namespace: "osmo-test"}}
	otg := makeOTG(t, nil)
	cfg, err := DecodeKAIConfig(otg)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if _, err := r.Render(otg, cfg); err == nil {
		t.Fatal("expected error for empty tasks")
	}
}

func TestRenderIsDeterministicWithSortedTasks(t *testing.T) {
	r := &Reconciler{Config: Config{SchedulerName: "kai-scheduler", Namespace: "osmo-test"}}
	otg := makeOTG(t, []workflowv1alpha1.KAITaskTemplate{
		{Name: "worker_2", Image: "img"},
		{Name: "worker_0", Lead: true, Image: "img"},
		{Name: "worker_1", Image: "img"},
	})
	cfg, _ := DecodeKAIConfig(otg)
	out, err := r.Render(otg, cfg)
	if err != nil {
		t.Fatalf("Render: %v", err)
	}
	wantNames := []string{"group-xyz-worker_0", "group-xyz-worker_1", "group-xyz-worker_2"}
	for i, pod := range out.Pods {
		if pod.Name != wantNames[i] {
			t.Errorf("pod[%d].Name=%q, want %q", i, pod.Name, wantNames[i])
		}
	}
}

func TestRenderUsesPriorityAndPoolName(t *testing.T) {
	r := &Reconciler{Config: Config{SchedulerName: "kai-scheduler", Namespace: "osmo-test"}}
	otg := makeOTG(t, []workflowv1alpha1.KAITaskTemplate{
		{Name: "worker_0", Lead: true, Image: "img"},
	})
	otg.Spec.Priority = "HIGH"
	otg.Spec.PoolName = "gpus"

	cfg, _ := DecodeKAIConfig(otg)
	out, err := r.Render(otg, cfg)
	if err != nil {
		t.Fatalf("Render: %v", err)
	}
	if got, want := out.PodGroup.Spec.Queue, "osmo-pool-osmo-test-gpus"; got != want {
		t.Errorf("queue=%q, want %q", got, want)
	}
	if got, want := out.PodGroup.Spec.PriorityClassName, "osmo-high"; got != want {
		t.Errorf("priorityClassName=%q, want %q", got, want)
	}
	if got := out.Pods[0].Labels["osmo.priority"]; got != "high" {
		t.Errorf("osmo.priority label=%q, want %q", got, "high")
	}
	if got, want := out.Pods[0].Spec.PriorityClassName, "osmo-high"; got != want {
		t.Errorf("pod priorityClassName=%q, want %q", got, want)
	}
}

func TestApplyReturnsErrorWhenClientsWiredButUnimplemented(t *testing.T) {
	r := &Reconciler{
		Config:        Config{SchedulerName: "kai-scheduler", Namespace: "osmo-test"},
		DynamicClient: noopDynamic{},
	}
	otg := makeOTG(t, []workflowv1alpha1.KAITaskTemplate{{Name: "worker_0", Lead: true, Image: "img"}})
	_, err := r.Reconcile(context.Background(), otg)
	if err == nil {
		t.Fatal("expected error when clients are wired but apply is unimplemented")
	}
}

func TestStatusMapperPendingNoCluster(t *testing.T) {
	sm := &StatusMapper{}
	otg := makeOTG(t, []workflowv1alpha1.KAITaskTemplate{{Name: "worker_0", Lead: true, Image: "img"}})
	st, err := sm.Map(context.Background(), otg)
	if err != nil {
		t.Fatalf("Map: %v", err)
	}
	if st.Phase != workflowv1alpha1.PhasePending {
		t.Errorf("phase=%q, want Pending", st.Phase)
	}
}

// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

package workflow

import (
	"testing"

	v1alpha1 "github.com/nvidia/osmo/taskgroup/api/v1alpha1"
)

func TestValidateGraph_ValidLinear(t *testing.T) {
	wf := &v1alpha1.OSMOWorkflow{
		Spec: v1alpha1.OSMOWorkflowSpec{
			Groups: []v1alpha1.WorkflowGroup{
				{Name: "a"},
				{Name: "b", DependsOn: []string{"a"}},
				{Name: "c", DependsOn: []string{"b"}},
			},
		},
	}
	if err := validateGraph(wf); err != nil {
		t.Fatalf("expected valid graph, got: %v", err)
	}
}

func TestValidateGraph_DuplicateName(t *testing.T) {
	wf := &v1alpha1.OSMOWorkflow{
		Spec: v1alpha1.OSMOWorkflowSpec{
			Groups: []v1alpha1.WorkflowGroup{
				{Name: "a"},
				{Name: "a"},
			},
		},
	}
	if err := validateGraph(wf); err == nil {
		t.Fatal("expected error for duplicate group name")
	}
}

func TestValidateGraph_UnknownDep(t *testing.T) {
	wf := &v1alpha1.OSMOWorkflow{
		Spec: v1alpha1.OSMOWorkflowSpec{
			Groups: []v1alpha1.WorkflowGroup{
				{Name: "a", DependsOn: []string{"ghost"}},
			},
		},
	}
	if err := validateGraph(wf); err == nil {
		t.Fatal("expected error for unknown dependency")
	}
}

func TestValidateGraph_Cycle(t *testing.T) {
	wf := &v1alpha1.OSMOWorkflow{
		Spec: v1alpha1.OSMOWorkflowSpec{
			Groups: []v1alpha1.WorkflowGroup{
				{Name: "a", DependsOn: []string{"b"}},
				{Name: "b", DependsOn: []string{"c"}},
				{Name: "c", DependsOn: []string{"a"}},
			},
		},
	}
	if err := validateGraph(wf); err == nil {
		t.Fatal("expected cycle error")
	}
}

func TestResolveReady_InitialFrontier(t *testing.T) {
	wf := &v1alpha1.OSMOWorkflow{
		Spec: v1alpha1.OSMOWorkflowSpec{
			Groups: []v1alpha1.WorkflowGroup{
				{Name: "a"},
				{Name: "b"},
				{Name: "c", DependsOn: []string{"a", "b"}},
			},
		},
	}
	ready, err := resolveReady(wf)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !equalUnordered(ready, []string{"a", "b"}) {
		t.Fatalf("expected initial frontier {a,b}, got %v", ready)
	}
}

func TestResolveReady_AfterDepsSatisfied(t *testing.T) {
	wf := &v1alpha1.OSMOWorkflow{
		Spec: v1alpha1.OSMOWorkflowSpec{
			Groups: []v1alpha1.WorkflowGroup{
				{Name: "a"},
				{Name: "b", DependsOn: []string{"a"}},
			},
		},
		Status: v1alpha1.OSMOWorkflowStatus{
			Groups: map[string]v1alpha1.WorkflowGroupStatus{
				"a": {
					Phase:        v1alpha1.PhaseSucceeded,
					TaskGroupRef: v1alpha1.TaskGroupRef{Name: "wf-a"},
				},
			},
		},
	}
	ready, err := resolveReady(wf)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !equalUnordered(ready, []string{"b"}) {
		t.Fatalf("expected {b}, got %v", ready)
	}
}

func TestResolveReady_NothingReadyWhileDepRunning(t *testing.T) {
	wf := &v1alpha1.OSMOWorkflow{
		Spec: v1alpha1.OSMOWorkflowSpec{
			Groups: []v1alpha1.WorkflowGroup{
				{Name: "a"},
				{Name: "b", DependsOn: []string{"a"}},
			},
		},
		Status: v1alpha1.OSMOWorkflowStatus{
			Groups: map[string]v1alpha1.WorkflowGroupStatus{
				"a": {
					Phase:        v1alpha1.PhaseRunning,
					TaskGroupRef: v1alpha1.TaskGroupRef{Name: "wf-a"},
				},
			},
		},
	}
	ready, err := resolveReady(wf)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(ready) != 0 {
		t.Fatalf("expected nothing ready while a is running, got %v", ready)
	}
}

func TestResolveReady_DispatchedNotReDispatched(t *testing.T) {
	wf := &v1alpha1.OSMOWorkflow{
		Spec: v1alpha1.OSMOWorkflowSpec{
			Groups: []v1alpha1.WorkflowGroup{{Name: "a"}},
		},
		Status: v1alpha1.OSMOWorkflowStatus{
			Groups: map[string]v1alpha1.WorkflowGroupStatus{
				"a": {
					Phase:        v1alpha1.PhasePending,
					TaskGroupRef: v1alpha1.TaskGroupRef{Name: "wf-a"},
				},
			},
		},
	}
	ready, err := resolveReady(wf)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(ready) != 0 {
		t.Fatalf("dispatched groups must not appear in ready set, got %v", ready)
	}
}

func TestRollupPhase(t *testing.T) {
	cases := []struct {
		name   string
		groups []v1alpha1.WorkflowGroup
		status map[string]v1alpha1.WorkflowGroupStatus
		want   v1alpha1.Phase
	}{
		{
			name:   "empty workflow → Succeeded",
			groups: nil,
			want:   v1alpha1.PhaseSucceeded,
		},
		{
			name:   "all succeeded",
			groups: []v1alpha1.WorkflowGroup{{Name: "a"}, {Name: "b"}},
			status: map[string]v1alpha1.WorkflowGroupStatus{
				"a": {Phase: v1alpha1.PhaseSucceeded},
				"b": {Phase: v1alpha1.PhaseSucceeded},
			},
			want: v1alpha1.PhaseSucceeded,
		},
		{
			name:   "one failed → Failed even if others running",
			groups: []v1alpha1.WorkflowGroup{{Name: "a"}, {Name: "b"}},
			status: map[string]v1alpha1.WorkflowGroupStatus{
				"a": {Phase: v1alpha1.PhaseRunning},
				"b": {Phase: v1alpha1.PhaseFailed},
			},
			want: v1alpha1.PhaseFailed,
		},
		{
			name:   "mix of running and succeeded",
			groups: []v1alpha1.WorkflowGroup{{Name: "a"}, {Name: "b"}},
			status: map[string]v1alpha1.WorkflowGroupStatus{
				"a": {Phase: v1alpha1.PhaseSucceeded},
				"b": {Phase: v1alpha1.PhaseRunning},
			},
			want: v1alpha1.PhaseRunning,
		},
		{
			name:   "all pending",
			groups: []v1alpha1.WorkflowGroup{{Name: "a"}},
			status: map[string]v1alpha1.WorkflowGroupStatus{},
			want:   v1alpha1.PhasePending,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			wf := &v1alpha1.OSMOWorkflow{
				Spec:   v1alpha1.OSMOWorkflowSpec{Groups: tc.groups},
				Status: v1alpha1.OSMOWorkflowStatus{Groups: tc.status},
			}
			got := rollupPhase(wf)
			if got != tc.want {
				t.Errorf("got %s, want %s", got, tc.want)
			}
		})
	}
}

func equalUnordered(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	m := make(map[string]int, len(a))
	for _, s := range a {
		m[s]++
	}
	for _, s := range b {
		m[s]--
	}
	for _, v := range m {
		if v != 0 {
			return false
		}
	}
	return true
}

// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

package workflow

import (
	"testing"

	operatorpb "github.com/nvidia/osmo/taskgroup/operator/proto"
)

func TestRemoteStatusCache_PutGetForget(t *testing.T) {
	c := NewRemoteStatusCache()
	ev := &operatorpb.OTGStatusEvent{
		Namespace: "osmo-workflows",
		Name:      "wf-a-g1",
		Status:    &operatorpb.OTGStatus{Phase: "Running"},
	}
	c.Put("backend-a", ev)

	if got := c.Get("backend-a", "osmo-workflows", "wf-a-g1"); got != ev {
		t.Fatalf("Get returned %v, want %v", got, ev)
	}
	if got := c.Get("backend-other", "osmo-workflows", "wf-a-g1"); got != nil {
		t.Errorf("Get on a different cluster should return nil, got %v", got)
	}

	c.Forget("backend-a", "osmo-workflows", "wf-a-g1")
	if got := c.Get("backend-a", "osmo-workflows", "wf-a-g1"); got != nil {
		t.Fatalf("after Forget Get returned %v, want nil", got)
	}
}

func TestRemoteStatusCache_NilSafety(t *testing.T) {
	c := NewRemoteStatusCache()
	// Put with nil or empty-name events should be no-ops, not panic.
	c.Put("backend-a", nil)
	c.Put("backend-a", &operatorpb.OTGStatusEvent{})
	if got := c.Get("backend-a", "", ""); got != nil {
		t.Errorf("expected nil, got %v", got)
	}
}

func TestRemoteStatusCache_OverwriteOnDuplicatePut(t *testing.T) {
	c := NewRemoteStatusCache()
	first := &operatorpb.OTGStatusEvent{Namespace: "ns", Name: "n", Status: &operatorpb.OTGStatus{Phase: "Running"}}
	second := &operatorpb.OTGStatusEvent{Namespace: "ns", Name: "n", Status: &operatorpb.OTGStatus{Phase: "Succeeded"}}
	c.Put("c1", first)
	c.Put("c1", second)
	got := c.Get("c1", "ns", "n")
	if got == nil || got.GetStatus().GetPhase() != "Succeeded" {
		t.Fatalf("expected Succeeded, got %v", got)
	}
}

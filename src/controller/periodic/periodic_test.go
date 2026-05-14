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

package periodic

import (
	"context"
	"sync/atomic"
	"testing"
	"time"

	workflowv1alpha1 "go.corp.nvidia.com/osmo/apis/workflow/v1alpha1"
	"go.corp.nvidia.com/osmo/controller/dispatcher"
)

type fakeLister struct {
	items []workflowv1alpha1.OSMOTaskGroup
}

func (f *fakeLister) List(_ context.Context) ([]workflowv1alpha1.OSMOTaskGroup, error) {
	return f.items, nil
}

type fakePusher struct {
	calls atomic.Int32
}

func (f *fakePusher) Push(_ context.Context, _ *workflowv1alpha1.OSMOTaskGroup, _ workflowv1alpha1.OSMOTaskGroupStatus) error {
	f.calls.Add(1)
	return nil
}

type fakeReconciler struct{}

func (fakeReconciler) Reconcile(_ context.Context, _ *workflowv1alpha1.OSMOTaskGroup) (dispatcher.Result, error) {
	return dispatcher.Result{}, nil
}

type fakeStatusMapper struct{}

func (fakeStatusMapper) Map(_ context.Context, _ *workflowv1alpha1.OSMOTaskGroup) (workflowv1alpha1.OSMOTaskGroupStatus, error) {
	return workflowv1alpha1.OSMOTaskGroupStatus{Phase: workflowv1alpha1.PhaseRunning}, nil
}

func TestLoopRunsAtLeastOnceImmediately(t *testing.T) {
	d := dispatcher.New()
	d.Register(workflowv1alpha1.RuntimeKAI, dispatcher.Runtime{
		Reconciler:   fakeReconciler{},
		StatusMapper: fakeStatusMapper{},
	})
	pusher := &fakePusher{}
	lister := &fakeLister{items: []workflowv1alpha1.OSMOTaskGroup{
		{Spec: workflowv1alpha1.OSMOTaskGroupSpec{RuntimeType: workflowv1alpha1.RuntimeKAI}},
		{Spec: workflowv1alpha1.OSMOTaskGroupSpec{RuntimeType: workflowv1alpha1.RuntimeKAI}},
	}}
	loop := &Loop{
		Interval:     500 * time.Millisecond,
		Lister:       lister,
		StatusMapper: d,
		Pusher:       pusher,
	}
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	_ = loop.Run(ctx)

	// Initial tick must have pushed both items before the first interval.
	if got := pusher.calls.Load(); got != 2 {
		t.Fatalf("got %d push calls, want 2", got)
	}
}

func TestLoopRequiresDeps(t *testing.T) {
	err := (&Loop{}).Run(context.Background())
	if err == nil {
		t.Fatal("expected error for missing deps")
	}
}

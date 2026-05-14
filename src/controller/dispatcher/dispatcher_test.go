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

package dispatcher

import (
	"context"
	"errors"
	"testing"

	workflowv1alpha1 "go.corp.nvidia.com/osmo/apis/workflow/v1alpha1"
)

type fakeReconciler struct {
	called bool
	result Result
	err    error
}

func (f *fakeReconciler) Reconcile(_ context.Context, _ *workflowv1alpha1.OSMOTaskGroup) (Result, error) {
	f.called = true
	return f.result, f.err
}

type fakeStatusMapper struct {
	called bool
	out    workflowv1alpha1.OSMOTaskGroupStatus
	err    error
}

func (f *fakeStatusMapper) Map(_ context.Context, _ *workflowv1alpha1.OSMOTaskGroup) (workflowv1alpha1.OSMOTaskGroupStatus, error) {
	f.called = true
	return f.out, f.err
}

func TestDispatcherRoutesToRegisteredRuntime(t *testing.T) {
	d := New()
	rec := &fakeReconciler{}
	sm := &fakeStatusMapper{out: workflowv1alpha1.OSMOTaskGroupStatus{Phase: workflowv1alpha1.PhaseRunning}}
	d.Register(workflowv1alpha1.RuntimeKAI, Runtime{Reconciler: rec, StatusMapper: sm})

	otg := &workflowv1alpha1.OSMOTaskGroup{Spec: workflowv1alpha1.OSMOTaskGroupSpec{RuntimeType: workflowv1alpha1.RuntimeKAI}}
	if _, err := d.Reconcile(context.Background(), otg); err != nil {
		t.Fatalf("Reconcile: %v", err)
	}
	if !rec.called {
		t.Fatal("reconciler not called")
	}
	if _, err := d.MapStatus(context.Background(), otg); err != nil {
		t.Fatalf("MapStatus: %v", err)
	}
	if !sm.called {
		t.Fatal("status mapper not called")
	}
}

func TestDispatcherUnknownRuntime(t *testing.T) {
	d := New()
	otg := &workflowv1alpha1.OSMOTaskGroup{Spec: workflowv1alpha1.OSMOTaskGroupSpec{RuntimeType: workflowv1alpha1.RuntimeNIM}}
	_, err := d.Reconcile(context.Background(), otg)
	if !errors.Is(err, ErrUnknownRuntime) {
		t.Fatalf("expected ErrUnknownRuntime, got %v", err)
	}
}

func TestDispatcherRejectsPartialRegistration(t *testing.T) {
	defer func() {
		if r := recover(); r == nil {
			t.Fatal("expected panic on partial registration")
		}
	}()
	New().Register(workflowv1alpha1.RuntimeKAI, Runtime{Reconciler: &fakeReconciler{}})
}

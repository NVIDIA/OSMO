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

package finalizer

import (
	"context"
	"testing"
	"time"

	workflowv1alpha1 "go.corp.nvidia.com/osmo/apis/workflow/v1alpha1"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

type fakeUploader struct {
	calls int
}

func (f *fakeUploader) Upload(_ context.Context, _ *workflowv1alpha1.OSMOTaskGroup, _ string, _ []byte) error {
	f.calls++
	return nil
}

func TestEnsureAddedIsIdempotent(t *testing.T) {
	otg := &workflowv1alpha1.OSMOTaskGroup{}
	if !EnsureAdded(otg) {
		t.Fatal("first add returned false")
	}
	if EnsureAdded(otg) {
		t.Fatal("second add returned true")
	}
	if len(otg.Finalizers) != 1 {
		t.Fatalf("expected 1 finalizer, got %d: %v", len(otg.Finalizers), otg.Finalizers)
	}
}

func TestIsBeingDeleted(t *testing.T) {
	otg := &workflowv1alpha1.OSMOTaskGroup{}
	if IsBeingDeleted(otg) {
		t.Fatal("expected false for live CR")
	}
	now := metav1.Now()
	otg.DeletionTimestamp = &now
	if !IsBeingDeleted(otg) {
		t.Fatal("expected true for deleting CR")
	}
}

func TestRunRemovesFinalizerEvenWithoutClient(t *testing.T) {
	otg := &workflowv1alpha1.OSMOTaskGroup{
		ObjectMeta: metav1.ObjectMeta{
			Finalizers: []string{workflowv1alpha1.FinalizerLogCollection, "other"},
		},
	}
	f := &Finalizer{Timeout: 100 * time.Millisecond}
	if err := f.Run(context.Background(), otg); err != nil {
		t.Fatalf("Run: %v", err)
	}
	for _, fz := range otg.Finalizers {
		if fz == workflowv1alpha1.FinalizerLogCollection {
			t.Fatal("log-collection finalizer not removed")
		}
	}
	// Other finalizers are left in place.
	if len(otg.Finalizers) != 1 || otg.Finalizers[0] != "other" {
		t.Fatalf("unexpected finalizers: %v", otg.Finalizers)
	}
}

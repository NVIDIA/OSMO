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

package v1alpha1

import (
	"testing"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
)

func TestAddToScheme(t *testing.T) {
	s := runtime.NewScheme()
	if err := AddToScheme(s); err != nil {
		t.Fatalf("AddToScheme: %v", err)
	}
	gvk := GroupVersion.WithKind("OSMOTaskGroup")
	if !s.Recognizes(gvk) {
		t.Fatalf("scheme does not recognize %s", gvk)
	}
}

func TestDeepCopyPreservesFields(t *testing.T) {
	in := &OSMOTaskGroup{
		ObjectMeta: metav1.ObjectMeta{
			Name:       "g",
			Namespace:  "ns",
			Finalizers: []string{FinalizerLogCollection},
		},
		Spec: OSMOTaskGroupSpec{
			WorkflowID:  "wf",
			GroupIndex:  2,
			GroupName:   "group",
			RuntimeType: RuntimeKAI,
			MaxRetries:  3,
		},
		Status: OSMOTaskGroupStatus{
			Phase: PhaseRunning,
			Conditions: []metav1.Condition{
				{Type: "Ready", Status: metav1.ConditionTrue},
			},
			ObservedGeneration: 5,
		},
	}
	out := in.DeepCopy()
	if out == in {
		t.Fatal("deep copy returned same pointer")
	}
	if out.Spec.WorkflowID != in.Spec.WorkflowID {
		t.Errorf("spec lost: %+v", out.Spec)
	}
	if len(out.Status.Conditions) != 1 || out.Status.Conditions[0].Type != "Ready" {
		t.Errorf("conditions lost: %+v", out.Status.Conditions)
	}
	// Mutating the copy must not affect the original.
	out.Status.Conditions[0].Type = "Mutated"
	if in.Status.Conditions[0].Type == "Mutated" {
		t.Error("DeepCopy shared slice with original")
	}
}

func TestDeepCopyObjectImplementsRuntimeObject(t *testing.T) {
	var _ runtime.Object = (&OSMOTaskGroup{}).DeepCopyObject()
	var _ runtime.Object = (&OSMOTaskGroupList{}).DeepCopyObject()
}

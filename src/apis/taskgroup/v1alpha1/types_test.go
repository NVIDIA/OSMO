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

package v1alpha1

import (
	"testing"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
)

func TestEffectiveRuntimeTypeDefaultsToKAI(t *testing.T) {
	otg := &OSMOTaskGroup{}
	if got := otg.EffectiveRuntimeType(); got != RuntimeTypeKAI {
		t.Fatalf("EffectiveRuntimeType() = %q, want %q", got, RuntimeTypeKAI)
	}
}

func TestValidateRejectsMissingRuntimeConfig(t *testing.T) {
	otg := &OSMOTaskGroup{}
	if err := otg.Validate(); err == nil {
		t.Fatal("Validate() succeeded, want error")
	}
}

func TestModeHelpers(t *testing.T) {
	otg := &OSMOTaskGroup{
		ObjectMeta: metav1.ObjectMeta{
			Annotations: map[string]string{AnnotationMode: ModeShadow},
		},
	}
	if !otg.ShadowMode() {
		t.Fatal("ShadowMode() = false, want true")
	}
	if otg.ActiveMode() {
		t.Fatal("ActiveMode() = true, want false")
	}
}

func TestDeepCopyObjectCopiesRuntimeConfig(t *testing.T) {
	otg := &OSMOTaskGroup{
		Spec: OSMOTaskGroupSpec{
			RuntimeConfig: runtime.RawExtension{Raw: []byte(`{"resources":[]}`)},
		},
	}

	copied := otg.DeepCopyObject().(*OSMOTaskGroup)
	copied.Spec.RuntimeConfig.Raw[0] = '['

	if string(otg.Spec.RuntimeConfig.Raw) != `{"resources":[]}` {
		t.Fatalf("DeepCopyObject() shared runtime config bytes: %s", otg.Spec.RuntimeConfig.Raw)
	}
}

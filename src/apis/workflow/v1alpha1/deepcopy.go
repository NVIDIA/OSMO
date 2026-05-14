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

DeepCopy implementations for OSMOTaskGroup types. Normally produced by
controller-gen; written by hand here so Phase 1 doesn't require introducing
the codegen toolchain into the Bazel build. Phase 6 (legacy path removal) is
the natural point to add controller-gen and replace this file with a
zz_generated.deepcopy.go.
*/

package v1alpha1

import (
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
)

// DeepCopyInto copies the receiver into the given out OSMOTaskGroup.
func (in *OSMOTaskGroup) DeepCopyInto(out *OSMOTaskGroup) {
	*out = *in
	out.TypeMeta = in.TypeMeta
	in.ObjectMeta.DeepCopyInto(&out.ObjectMeta)
	in.Spec.DeepCopyInto(&out.Spec)
	in.Status.DeepCopyInto(&out.Status)
}

// DeepCopy returns a deep copy of OSMOTaskGroup.
func (in *OSMOTaskGroup) DeepCopy() *OSMOTaskGroup {
	if in == nil {
		return nil
	}
	out := new(OSMOTaskGroup)
	in.DeepCopyInto(out)
	return out
}

// DeepCopyObject implements runtime.Object.
func (in *OSMOTaskGroup) DeepCopyObject() runtime.Object {
	if c := in.DeepCopy(); c != nil {
		return c
	}
	return nil
}

// DeepCopyInto copies the receiver into the given out OSMOTaskGroupList.
func (in *OSMOTaskGroupList) DeepCopyInto(out *OSMOTaskGroupList) {
	*out = *in
	out.TypeMeta = in.TypeMeta
	in.ListMeta.DeepCopyInto(&out.ListMeta)
	if in.Items != nil {
		out.Items = make([]OSMOTaskGroup, len(in.Items))
		for i := range in.Items {
			in.Items[i].DeepCopyInto(&out.Items[i])
		}
	}
}

// DeepCopy returns a deep copy of OSMOTaskGroupList.
func (in *OSMOTaskGroupList) DeepCopy() *OSMOTaskGroupList {
	if in == nil {
		return nil
	}
	out := new(OSMOTaskGroupList)
	in.DeepCopyInto(out)
	return out
}

// DeepCopyObject implements runtime.Object.
func (in *OSMOTaskGroupList) DeepCopyObject() runtime.Object {
	if c := in.DeepCopy(); c != nil {
		return c
	}
	return nil
}

// DeepCopyInto copies the receiver into the given out OSMOTaskGroupSpec.
func (in *OSMOTaskGroupSpec) DeepCopyInto(out *OSMOTaskGroupSpec) {
	*out = *in
	if in.RuntimeConfig != nil {
		out.RuntimeConfig = in.RuntimeConfig.DeepCopy()
	}
	if in.Timeout != nil {
		dup := *in.Timeout
		out.Timeout = &dup
	}
}

// DeepCopyInto copies the receiver into the given out OSMOTaskGroupStatus.
func (in *OSMOTaskGroupStatus) DeepCopyInto(out *OSMOTaskGroupStatus) {
	*out = *in
	if in.Conditions != nil {
		out.Conditions = make([]metav1.Condition, len(in.Conditions))
		for i := range in.Conditions {
			in.Conditions[i].DeepCopyInto(&out.Conditions[i])
		}
	}
	if in.RuntimeStatus != nil {
		out.RuntimeStatus = in.RuntimeStatus.DeepCopy()
	}
}

// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

// Hand-written DeepCopy methods. In a controller-gen-integrated build these would be
// generated; we maintain them by hand to keep the project's dependency surface small
// for now. When the build picks up controller-gen, this file can be regenerated.
//
// One method per exported type, plus DeepCopyObject for the top-level CRD types.

package v1alpha1

import (
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
)

// --- OSMOTaskGroup ---

func (in *OSMOTaskGroup) DeepCopyInto(out *OSMOTaskGroup) {
	*out = *in
	out.TypeMeta = in.TypeMeta
	in.ObjectMeta.DeepCopyInto(&out.ObjectMeta)
	in.Spec.DeepCopyInto(&out.Spec)
	in.Status.DeepCopyInto(&out.Status)
}

func (in *OSMOTaskGroup) DeepCopy() *OSMOTaskGroup {
	if in == nil {
		return nil
	}
	out := new(OSMOTaskGroup)
	in.DeepCopyInto(out)
	return out
}

func (in *OSMOTaskGroup) DeepCopyObject() runtime.Object { return in.DeepCopy() }

func (in *OSMOTaskGroupSpec) DeepCopyInto(out *OSMOTaskGroupSpec) {
	*out = *in
	in.RuntimeConfig.DeepCopyInto(&out.RuntimeConfig)
	if in.Timeout != nil {
		out.Timeout = new(metav1.Duration)
		*out.Timeout = *in.Timeout
	}
}

func (in *OSMOTaskGroupStatus) DeepCopyInto(out *OSMOTaskGroupStatus) {
	*out = *in
	if in.Conditions != nil {
		out.Conditions = make([]metav1.Condition, len(in.Conditions))
		for i := range in.Conditions {
			in.Conditions[i].DeepCopyInto(&out.Conditions[i])
		}
	}
	if in.Tasks != nil {
		out.Tasks = make([]TaskState, len(in.Tasks))
		for i := range in.Tasks {
			in.Tasks[i].DeepCopyInto(&out.Tasks[i])
		}
	}
	in.RuntimeStatus.DeepCopyInto(&out.RuntimeStatus)
}

func (in *TaskState) DeepCopyInto(out *TaskState) {
	*out = *in
	if in.StartTime != nil {
		out.StartTime = in.StartTime.DeepCopy()
	}
	if in.EndTime != nil {
		out.EndTime = in.EndTime.DeepCopy()
	}
	if in.ExitCode != nil {
		out.ExitCode = new(int32)
		*out.ExitCode = *in.ExitCode
	}
	if in.Container != nil {
		out.Container = in.Container.DeepCopy()
	}
}

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

func (in *OSMOTaskGroupList) DeepCopy() *OSMOTaskGroupList {
	if in == nil {
		return nil
	}
	out := new(OSMOTaskGroupList)
	in.DeepCopyInto(out)
	return out
}

func (in *OSMOTaskGroupList) DeepCopyObject() runtime.Object { return in.DeepCopy() }

// --- OSMOWorkflow ---

func (in *OSMOWorkflow) DeepCopyInto(out *OSMOWorkflow) {
	*out = *in
	out.TypeMeta = in.TypeMeta
	in.ObjectMeta.DeepCopyInto(&out.ObjectMeta)
	in.Spec.DeepCopyInto(&out.Spec)
	in.Status.DeepCopyInto(&out.Status)
}

func (in *OSMOWorkflow) DeepCopy() *OSMOWorkflow {
	if in == nil {
		return nil
	}
	out := new(OSMOWorkflow)
	in.DeepCopyInto(out)
	return out
}

func (in *OSMOWorkflow) DeepCopyObject() runtime.Object { return in.DeepCopy() }

func (in *OSMOWorkflowSpec) DeepCopyInto(out *OSMOWorkflowSpec) {
	*out = *in
	if in.Groups != nil {
		out.Groups = make([]WorkflowGroup, len(in.Groups))
		for i := range in.Groups {
			in.Groups[i].DeepCopyInto(&out.Groups[i])
		}
	}
	if in.Timeout != nil {
		out.Timeout = new(metav1.Duration)
		*out.Timeout = *in.Timeout
	}
}

func (in *WorkflowGroup) DeepCopyInto(out *WorkflowGroup) {
	*out = *in
	if in.DependsOn != nil {
		out.DependsOn = append([]string(nil), in.DependsOn...)
	}
	in.RuntimeConfig.DeepCopyInto(&out.RuntimeConfig)
}

func (in *OSMOWorkflowStatus) DeepCopyInto(out *OSMOWorkflowStatus) {
	*out = *in
	if in.Conditions != nil {
		out.Conditions = make([]metav1.Condition, len(in.Conditions))
		for i := range in.Conditions {
			in.Conditions[i].DeepCopyInto(&out.Conditions[i])
		}
	}
	if in.Groups != nil {
		out.Groups = make(map[string]WorkflowGroupStatus, len(in.Groups))
		for k, v := range in.Groups {
			var copied WorkflowGroupStatus
			v.DeepCopyInto(&copied)
			out.Groups[k] = copied
		}
	}
}

func (in *WorkflowGroupStatus) DeepCopyInto(out *WorkflowGroupStatus) {
	*out = *in
	out.TaskGroupRef = in.TaskGroupRef
	if in.LastUpdated != nil {
		out.LastUpdated = in.LastUpdated.DeepCopy()
	}
}

func (in *OSMOWorkflowList) DeepCopyInto(out *OSMOWorkflowList) {
	*out = *in
	out.TypeMeta = in.TypeMeta
	in.ListMeta.DeepCopyInto(&out.ListMeta)
	if in.Items != nil {
		out.Items = make([]OSMOWorkflow, len(in.Items))
		for i := range in.Items {
			in.Items[i].DeepCopyInto(&out.Items[i])
		}
	}
}

func (in *OSMOWorkflowList) DeepCopy() *OSMOWorkflowList {
	if in == nil {
		return nil
	}
	out := new(OSMOWorkflowList)
	in.DeepCopyInto(out)
	return out
}

func (in *OSMOWorkflowList) DeepCopyObject() runtime.Object { return in.DeepCopy() }

// --- OSMOCluster ---

func (in *OSMOCluster) DeepCopyInto(out *OSMOCluster) {
	*out = *in
	out.TypeMeta = in.TypeMeta
	in.ObjectMeta.DeepCopyInto(&out.ObjectMeta)
	in.Spec.DeepCopyInto(&out.Spec)
	in.Status.DeepCopyInto(&out.Status)
}

func (in *OSMOCluster) DeepCopy() *OSMOCluster {
	if in == nil {
		return nil
	}
	out := new(OSMOCluster)
	in.DeepCopyInto(out)
	return out
}

func (in *OSMOCluster) DeepCopyObject() runtime.Object { return in.DeepCopy() }

func (in *OSMOClusterSpec) DeepCopyInto(out *OSMOClusterSpec) {
	*out = *in
	if in.GPUTypes != nil {
		out.GPUTypes = append([]string(nil), in.GPUTypes...)
	}
	in.Network.DeepCopyInto(&out.Network)
	if in.TokenSecretRef != nil {
		out.TokenSecretRef = new(SecretRef)
		*out.TokenSecretRef = *in.TokenSecretRef
	}
}

func (in *ClusterNetwork) DeepCopyInto(out *ClusterNetwork) {
	*out = *in
	if in.Config != nil {
		out.Config = make(map[string]string, len(in.Config))
		for k, v := range in.Config {
			out.Config[k] = v
		}
	}
}

func (in *OSMOClusterStatus) DeepCopyInto(out *OSMOClusterStatus) {
	*out = *in
	if in.LastSeen != nil {
		out.LastSeen = in.LastSeen.DeepCopy()
	}
	if in.SupportedRuntimes != nil {
		out.SupportedRuntimes = append([]RuntimeType(nil), in.SupportedRuntimes...)
	}
	if in.Conditions != nil {
		out.Conditions = make([]metav1.Condition, len(in.Conditions))
		for i := range in.Conditions {
			in.Conditions[i].DeepCopyInto(&out.Conditions[i])
		}
	}
}

func (in *OSMOClusterList) DeepCopyInto(out *OSMOClusterList) {
	*out = *in
	out.TypeMeta = in.TypeMeta
	in.ListMeta.DeepCopyInto(&out.ListMeta)
	if in.Items != nil {
		out.Items = make([]OSMOCluster, len(in.Items))
		for i := range in.Items {
			in.Items[i].DeepCopyInto(&out.Items[i])
		}
	}
}

func (in *OSMOClusterList) DeepCopy() *OSMOClusterList {
	if in == nil {
		return nil
	}
	out := new(OSMOClusterList)
	in.DeepCopyInto(out)
	return out
}

func (in *OSMOClusterList) DeepCopyObject() runtime.Object { return in.DeepCopy() }

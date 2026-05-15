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
	"fmt"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
)

const (
	LabelWorkflowID   = "osmo.workflow_id"
	LabelWorkflowUUID = "osmo.workflow_uuid"
	LabelGroupName    = "osmo.group_name"
	LabelGroupUUID    = "osmo.group_uuid"

	AnnotationMode   = "workflow.osmo.nvidia.com/mode"
	AnnotationShadow = "workflow.osmo.nvidia.com/shadow"

	ModeShadow = "shadow"
	ModeActive = "active"
)

type RuntimeMode string

const (
	RuntimeModeShadow RuntimeMode = ModeShadow
	RuntimeModeActive RuntimeMode = ModeActive
)

type RuntimeType string

const (
	RuntimeTypeKAI RuntimeType = "kai"
)

type OSMOTaskGroupPhase string

const (
	PhasePending   OSMOTaskGroupPhase = "Pending"
	PhaseRunning   OSMOTaskGroupPhase = "Running"
	PhaseSucceeded OSMOTaskGroupPhase = "Succeeded"
	PhaseFailed    OSMOTaskGroupPhase = "Failed"
	PhaseUnknown   OSMOTaskGroupPhase = "Unknown"
)

type ConditionType string

const (
	ConditionReady      ConditionType = "Ready"
	ConditionReconciled ConditionType = "Reconciled"
	ConditionFinalized  ConditionType = "Finalized"
)

type OSMOTaskGroupSpec struct {
	WorkflowID    string               `json:"workflowID,omitempty"`
	WorkflowUUID  string               `json:"workflowUUID,omitempty"`
	GroupName     string               `json:"groupName,omitempty"`
	GroupUUID     string               `json:"groupUUID,omitempty"`
	Mode          RuntimeMode          `json:"mode,omitempty"`
	RuntimeType   RuntimeType          `json:"runtimeType,omitempty"`
	RuntimeConfig runtime.RawExtension `json:"runtimeConfig,omitempty"`
}

type OSMOTaskGroupStatus struct {
	Phase         OSMOTaskGroupPhase   `json:"phase,omitempty"`
	Message       string               `json:"message,omitempty"`
	PodSummary    PodSummary           `json:"podSummary,omitempty"`
	Conditions    []metav1.Condition   `json:"conditions,omitempty"`
	RuntimeStatus runtime.RawExtension `json:"runtimeStatus,omitempty"`
}

type PodSummary struct {
	Pending   int32 `json:"pending,omitempty"`
	Running   int32 `json:"running,omitempty"`
	Succeeded int32 `json:"succeeded,omitempty"`
	Failed    int32 `json:"failed,omitempty"`
	Unknown   int32 `json:"unknown,omitempty"`
}

type OSMOTaskGroup struct {
	metav1.TypeMeta   `json:",inline"`
	metav1.ObjectMeta `json:"metadata,omitempty"`

	Spec   OSMOTaskGroupSpec   `json:"spec,omitempty"`
	Status OSMOTaskGroupStatus `json:"status,omitempty"`
}

type OSMOTaskGroupList struct {
	metav1.TypeMeta `json:",inline"`
	metav1.ListMeta `json:"metadata,omitempty"`
	Items           []OSMOTaskGroup `json:"items"`
}

func (in *OSMOTaskGroup) DeepCopyObject() runtime.Object {
	if in == nil {
		return nil
	}
	out := new(OSMOTaskGroup)
	*out = *in
	out.ObjectMeta = *in.ObjectMeta.DeepCopy()
	out.Spec.RuntimeConfig = *in.Spec.RuntimeConfig.DeepCopy()
	out.Status.RuntimeStatus = *in.Status.RuntimeStatus.DeepCopy()
	out.Status.Conditions = append([]metav1.Condition(nil), in.Status.Conditions...)
	return out
}

func (in *OSMOTaskGroupList) DeepCopyObject() runtime.Object {
	if in == nil {
		return nil
	}
	out := new(OSMOTaskGroupList)
	*out = *in
	out.ListMeta = in.ListMeta
	out.Items = make([]OSMOTaskGroup, len(in.Items))
	for index := range in.Items {
		out.Items[index] = *in.Items[index].DeepCopyObject().(*OSMOTaskGroup)
	}
	return out
}

func (in *OSMOTaskGroup) EffectiveRuntimeType() RuntimeType {
	if in.Spec.RuntimeType == "" {
		return RuntimeTypeKAI
	}
	return in.Spec.RuntimeType
}

func (in *OSMOTaskGroup) EffectiveMode() RuntimeMode {
	if in.Spec.Mode != "" {
		return in.Spec.Mode
	}
	if in.Annotations[AnnotationMode] == ModeActive {
		return RuntimeModeActive
	}
	if in.Annotations[AnnotationMode] == ModeShadow || in.Annotations[AnnotationShadow] == "true" {
		return RuntimeModeShadow
	}
	return RuntimeModeShadow
}

func (in *OSMOTaskGroup) ActiveMode() bool {
	return in.EffectiveMode() == RuntimeModeActive
}

func (in *OSMOTaskGroup) ShadowMode() bool {
	return in.EffectiveMode() == RuntimeModeShadow
}

func (in *OSMOTaskGroup) Validate() error {
	if in.EffectiveRuntimeType() != RuntimeTypeKAI {
		return fmt.Errorf("unsupported runtimeType %q", in.EffectiveRuntimeType())
	}
	switch in.EffectiveMode() {
	case RuntimeModeActive, RuntimeModeShadow:
	default:
		return fmt.Errorf("unsupported mode %q", in.EffectiveMode())
	}
	if len(in.Spec.RuntimeConfig.Raw) == 0 {
		return fmt.Errorf("runtimeConfig is required")
	}
	return nil
}

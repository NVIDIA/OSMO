// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

package kai

import (
	"context"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"sigs.k8s.io/controller-runtime/pkg/client"

	v1alpha1 "github.com/nvidia/osmo/taskgroup/api/v1alpha1"
)

// StatusMapper rolls up Pod states into the normalized OSMOTaskGroupStatus.
//
// Phase semantics:
//   Pending    — at least one Pod has not yet run (Pending/ContainerCreating)
//   Running    — at least one Pod is Running and no terminal-failure observed
//   Succeeded  — the lead Pod reached Succeeded
//   Failed     — the lead Pod reached Failed OR any non-lead Pod hit ImagePullBackOff
//                / CrashLoopBackOff past the retry budget
type StatusMapper struct {
	client client.Client
}

// Map lists Pods owned (directly or transitively) by the OSMOTaskGroup and aggregates them.
func (m *StatusMapper) Map(ctx context.Context, otg *v1alpha1.OSMOTaskGroup) (v1alpha1.OSMOTaskGroupStatus, error) {
	var pods corev1.PodList
	if err := m.client.List(ctx, &pods, client.InNamespace(otg.Namespace), client.MatchingLabels{
		v1alpha1.LabelWorkflowID: otg.Spec.WorkflowID,
		v1alpha1.LabelGroupName:  otg.Spec.GroupName,
	}); err != nil {
		return v1alpha1.OSMOTaskGroupStatus{}, err
	}

	tasks := make([]v1alpha1.TaskState, 0, len(pods.Items))
	var leadState corev1.PodPhase
	leadSeen := false
	anyRunning := false
	anyFailed := false

	for i := range pods.Items {
		p := &pods.Items[i]
		ts := v1alpha1.TaskState{
			Name:    p.Labels["workflow.osmo.nvidia.com/task-name"],
			PodName: p.Name,
			State:   string(p.Status.Phase),
		}
		if p.Status.StartTime != nil {
			ts.StartTime = p.Status.StartTime
		}
		for j := range p.Status.ContainerStatuses {
			cs := p.Status.ContainerStatuses[j]
			if cs.Name == "user" {
				ts.Container = &p.Status.ContainerStatuses[j]
				if cs.State.Terminated != nil {
					code := cs.State.Terminated.ExitCode
					ts.ExitCode = &code
					et := cs.State.Terminated.FinishedAt
					ts.EndTime = &et
				}
				break
			}
		}
		tasks = append(tasks, ts)

		switch p.Status.Phase {
		case corev1.PodRunning:
			anyRunning = true
		case corev1.PodFailed:
			anyFailed = true
		}
		if p.Labels["workflow.osmo.nvidia.com/lead"] == "true" {
			leadSeen = true
			leadState = p.Status.Phase
		}
	}

	out := v1alpha1.OSMOTaskGroupStatus{Tasks: tasks}

	switch {
	case leadSeen && leadState == corev1.PodSucceeded:
		out.Phase = v1alpha1.PhaseSucceeded
	case leadSeen && leadState == corev1.PodFailed:
		out.Phase = v1alpha1.PhaseFailed
	case anyFailed:
		out.Phase = v1alpha1.PhaseFailed
	case anyRunning:
		out.Phase = v1alpha1.PhaseRunning
	default:
		out.Phase = v1alpha1.PhasePending
	}

	// Carry forward any existing conditions (preserves transition timestamps when the
	// status hasn't actually changed). The status mapper is called from the top-level
	// Reconciler which writes the returned Status wholesale, so we must include them
	// here ourselves rather than relying on a partial patch.
	out.Conditions = append(out.Conditions, otg.Status.Conditions...)
	meta.SetStatusCondition(&out.Conditions, readyCondition(out.Phase))
	return out, nil
}

func readyCondition(p v1alpha1.Phase) metav1.Condition {
	c := metav1.Condition{Type: v1alpha1.ConditionReady}
	switch p {
	case v1alpha1.PhaseSucceeded:
		c.Status = metav1.ConditionTrue
		c.Reason = "Succeeded"
	case v1alpha1.PhaseRunning:
		c.Status = metav1.ConditionTrue
		c.Reason = "Running"
	case v1alpha1.PhaseFailed:
		c.Status = metav1.ConditionFalse
		c.Reason = "Failed"
	default:
		c.Status = metav1.ConditionFalse
		c.Reason = "Pending"
	}
	// meta.SetStatusCondition fills LastTransitionTime only when the status field
	// actually changes, which is the behavior we want.
	return c
}

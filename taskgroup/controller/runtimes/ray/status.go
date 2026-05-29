// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

package ray

import (
	"context"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/types"
	"sigs.k8s.io/controller-runtime/pkg/client"

	v1alpha1 "github.com/nvidia/osmo/taskgroup/api/v1alpha1"
)

// StatusMapper reads RayJob.status and folds it into OSMOTaskGroupStatus.
//
// RayJob.status.jobStatus values we map (KubeRay v1):
//   PENDING / WAITING / RUNNING  → Phase derived from jobDeploymentStatus too
//   SUCCEEDED                    → PhaseSucceeded
//   FAILED / STOPPED             → PhaseFailed
//
// RayJob.status.jobDeploymentStatus is consulted for pre-job state (Initializing,
// Running, Failed) — useful when jobStatus is empty (cluster still spinning up).
type StatusMapper struct {
	client client.Client
}

// Map fetches the live RayJob and projects its state. Missing RayJob → Pending.
func (m *StatusMapper) Map(ctx context.Context, otg *v1alpha1.OSMOTaskGroup) (v1alpha1.OSMOTaskGroupStatus, error) {
	rj := &unstructured.Unstructured{}
	rj.SetGroupVersionKind(RayJobGVK)
	err := m.client.Get(ctx, types.NamespacedName{Name: otg.Name, Namespace: otg.Namespace}, rj)
	if err != nil {
		if apierrors.IsNotFound(err) {
			return pendingStatus(otg, "RayJob not yet created"), nil
		}
		return v1alpha1.OSMOTaskGroupStatus{}, err
	}

	jobStatus, _, _ := unstructured.NestedString(rj.Object, "status", "jobStatus")
	deployStatus, _, _ := unstructured.NestedString(rj.Object, "status", "jobDeploymentStatus")
	msg, _, _ := unstructured.NestedString(rj.Object, "status", "message")

	out := v1alpha1.OSMOTaskGroupStatus{}
	switch jobStatus {
	case "SUCCEEDED":
		out.Phase = v1alpha1.PhaseSucceeded
	case "FAILED", "STOPPED":
		out.Phase = v1alpha1.PhaseFailed
	case "RUNNING":
		out.Phase = v1alpha1.PhaseRunning
	default:
		// Fall back to deployment status when job status is empty/unset.
		switch deployStatus {
		case "Running":
			out.Phase = v1alpha1.PhaseRunning
		case "Complete":
			out.Phase = v1alpha1.PhaseSucceeded
		case "Failed":
			out.Phase = v1alpha1.PhaseFailed
		default:
			// Initializing, Suspending, Suspended, Waiting, ...
			out.Phase = v1alpha1.PhasePending
		}
	}
	out.Message = msg

	// Preserve any existing conditions to keep transition timestamps stable.
	out.Conditions = append(out.Conditions, otg.Status.Conditions...)
	meta.SetStatusCondition(&out.Conditions, readyCondition(out.Phase, msg))
	return out, nil
}

func pendingStatus(otg *v1alpha1.OSMOTaskGroup, msg string) v1alpha1.OSMOTaskGroupStatus {
	out := v1alpha1.OSMOTaskGroupStatus{
		Phase:   v1alpha1.PhasePending,
		Message: msg,
	}
	out.Conditions = append(out.Conditions, otg.Status.Conditions...)
	meta.SetStatusCondition(&out.Conditions, readyCondition(out.Phase, msg))
	return out
}

func readyCondition(p v1alpha1.Phase, msg string) metav1.Condition {
	c := metav1.Condition{Type: v1alpha1.ConditionReady, Message: msg}
	switch p {
	case v1alpha1.PhaseRunning:
		c.Status = metav1.ConditionTrue
		c.Reason = "Running"
	case v1alpha1.PhaseSucceeded:
		c.Status = metav1.ConditionTrue
		c.Reason = "Succeeded"
	case v1alpha1.PhaseFailed:
		c.Status = metav1.ConditionFalse
		c.Reason = "Failed"
	default:
		c.Status = metav1.ConditionFalse
		c.Reason = "Pending"
	}
	return c
}

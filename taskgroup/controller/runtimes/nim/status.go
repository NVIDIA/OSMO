// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

package nim

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

// StatusMapper reads NIMService.status and folds it into OSMOTaskGroupStatus.
//
// NIMService.status.state values we map (best-effort against NIM Operator's
// stable values):
//   Ready    → PhaseRunning (inference is serving)
//   Pending  → PhasePending
//   NotReady → PhaseFailed if persisted past readiness probe timeout; else Pending
//   Failed   → PhaseFailed
type StatusMapper struct {
	client client.Client
}

// Map fetches the live NIMService and projects its state. If the NIMService is
// missing (it hasn't been created yet on this reconcile pass), we return Pending
// rather than an error so the OTG reconciler can re-fire.
func (m *StatusMapper) Map(ctx context.Context, otg *v1alpha1.OSMOTaskGroup) (v1alpha1.OSMOTaskGroupStatus, error) {
	svc := &unstructured.Unstructured{}
	svc.SetGroupVersionKind(NIMServiceGVK)
	err := m.client.Get(ctx, types.NamespacedName{Name: otg.Name, Namespace: otg.Namespace}, svc)
	if err != nil {
		if apierrors.IsNotFound(err) {
			return pendingStatus(otg, "NIMService not yet created"), nil
		}
		return v1alpha1.OSMOTaskGroupStatus{}, err
	}

	state, _, _ := unstructured.NestedString(svc.Object, "status", "state")
	msg, _, _ := unstructured.NestedString(svc.Object, "status", "message")
	if msg == "" {
		// Fall back to the latest condition message when state.message is empty.
		conds, _, _ := unstructured.NestedSlice(svc.Object, "status", "conditions")
		if len(conds) > 0 {
			if last, ok := conds[len(conds)-1].(map[string]interface{}); ok {
				if m, ok := last["message"].(string); ok {
					msg = m
				}
			}
		}
	}

	out := v1alpha1.OSMOTaskGroupStatus{}
	switch state {
	case "Ready":
		out.Phase = v1alpha1.PhaseRunning
	case "Failed":
		out.Phase = v1alpha1.PhaseFailed
	case "":
		out.Phase = v1alpha1.PhasePending
	default:
		// Pending, NotReady, ContainerCreating, ... all map to Pending until they
		// resolve. The NIM Operator transitions through several intermediate
		// states during model load; treating them as Pending avoids
		// false-positive PhaseFailed during startup.
		out.Phase = v1alpha1.PhasePending
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

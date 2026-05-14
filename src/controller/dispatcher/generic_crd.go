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
	"fmt"

	workflowv1alpha1 "go.corp.nvidia.com/osmo/apis/workflow/v1alpha1"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/dynamic"
)

// GenericCRDReconciler is the shared skeleton for runtimes that target an
// existing third-party CRD: NIMService (Phase 3), DynamoGraphDeployment
// (Phase 5), RayCluster / RayJob (Phase 3), PodClique (Phase 5).
//
// PROJ-taskgroup-crd.md "Generic CRD reconciler" expects NIM/Ray/Dynamo/Grove
// to share ~80% of reconciler code through this skeleton; only the
// per-runtime Translate function (RuntimeConfig → target CRD spec) and the
// StatusMapper differ.
//
// Phase 1 ships the skeleton but no concrete implementations — the KAI
// reconciler is Pod+PodGroup native, not dynamic.
type GenericCRDReconciler struct {
	// TargetGVR identifies the third-party CRD this reconciler operates on
	// (e.g. {Group: "apps.nvidia.com", Version: "v1alpha1", Resource: "nimservices"}).
	TargetGVR schema.GroupVersionResource

	// Translate converts an OSMOTaskGroup's runtimeConfig into the target
	// CRD's .spec field. Plugins supply this per-runtime; the rest of the
	// reconcile loop is shared.
	Translate TranslateFunc

	// Client is the dynamic K8s client used to create / get / update / delete
	// the target CRD. Injected by the controller binary at startup.
	Client dynamic.Interface
}

// TranslateFunc transforms an OSMOTaskGroup's runtimeConfig into the
// runtime-native spec body. Returning an error surfaces as a permanent
// reconcile failure since the input shape is malformed.
type TranslateFunc func(otg *workflowv1alpha1.OSMOTaskGroup) (map[string]interface{}, error)

// Reconcile is a stub for Phase 1. Phase 3/5 fills this in with the
// create/update/owner-ref/delete loop using r.Client.
//
// The pseudocode (per PROJ-taskgroup-crd.md "Generic CRD reconciler"):
//  1. Translate runtimeConfig → target CRD spec
//  2. Set owner reference from OSMOTaskGroup to target CR for cascade delete
//  3. Apply (create or patch) the target CR in the same namespace
//  4. Return zero Result; reconciliation is event-driven from the target CR
func (r *GenericCRDReconciler) Reconcile(_ context.Context, otg *workflowv1alpha1.OSMOTaskGroup) (Result, error) {
	if r.Translate == nil {
		return Result{}, fmt.Errorf("generic CRD reconciler for %s has no Translate func", r.TargetGVR)
	}
	if r.Client == nil {
		return Result{}, fmt.Errorf("generic CRD reconciler for %s has no Client", r.TargetGVR)
	}
	// Phase 1 placeholder: prove the wiring compiles. Real implementation
	// arrives with Phase 3 (NIM, Ray) per the project's phase plan.
	_ = otg
	return Result{}, fmt.Errorf("generic CRD reconciler %s: not implemented in Phase 1", r.TargetGVR)
}

// OwnerReferenceFor returns a controller owner reference pointing at the
// OSMOTaskGroup, used so the target CRD is cascade-deleted when the
// OSMOTaskGroup is deleted.
func OwnerReferenceFor(otg *workflowv1alpha1.OSMOTaskGroup) metav1.OwnerReference {
	tru := true
	return metav1.OwnerReference{
		APIVersion:         workflowv1alpha1.GroupVersion.String(),
		Kind:               "OSMOTaskGroup",
		Name:               otg.Name,
		UID:                otg.UID,
		Controller:         &tru,
		BlockOwnerDeletion: &tru,
	}
}

// NamespacedName returns the canonical key for a CR.
func NamespacedName(otg *workflowv1alpha1.OSMOTaskGroup) types.NamespacedName {
	return types.NamespacedName{Namespace: otg.Namespace, Name: otg.Name}
}

// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

package workflow

import (
	"context"
	"testing"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"sigs.k8s.io/yaml"

	v1alpha1 "github.com/nvidia/osmo/taskgroup/api/v1alpha1"
	"github.com/nvidia/osmo/taskgroup/operator"
	operatorpb "github.com/nvidia/osmo/taskgroup/operator/proto"
)

func TestRemoteDispatcher_CreateProducesCreateOTGEnvelope(t *testing.T) {
	reg := operator.NewSessionRegistry()
	sess := reg.Register("backend-a", 4)
	bus := &operator.CommandBus{Sessions: reg}
	d := &RemoteDispatcher{
		ClusterID: "backend-a",
		Namespace: "osmo-workflows",
		Bus:       bus,
	}

	wf := &v1alpha1.OSMOWorkflow{
		ObjectMeta: metav1.ObjectMeta{Name: "wf-1"},
		Spec:       v1alpha1.OSMOWorkflowSpec{},
	}
	group := v1alpha1.WorkflowGroup{
		Name:        "group-a",
		Cluster:     "backend-a",
		RuntimeType: v1alpha1.RuntimeKAI,
		RuntimeConfig: runtime.RawExtension{
			Raw: []byte(`{"replicas":2}`),
		},
	}

	ref, err := d.Create(context.Background(), wf, group)
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if ref.Cluster != "backend-a" || ref.Namespace != "osmo-workflows" || ref.Name == "" {
		t.Errorf("unexpected ref: %+v", ref)
	}

	select {
	case env := <-sess.Drain():
		create := env.GetCreate()
		if create == nil {
			t.Fatalf("expected CreateOTG envelope, got %T", env.Body)
		}
		var otg v1alpha1.OSMOTaskGroup
		if err := yaml.Unmarshal(create.OtgYaml, &otg); err != nil {
			t.Fatalf("unmarshal OTG: %v", err)
		}
		if otg.Spec.WorkflowID != "wf-1" {
			t.Errorf("WorkflowID = %q, want wf-1", otg.Spec.WorkflowID)
		}
		if otg.Spec.GroupName != "group-a" {
			t.Errorf("GroupName = %q, want group-a", otg.Spec.GroupName)
		}
		if otg.Namespace != "osmo-workflows" {
			t.Errorf("Namespace = %q, want osmo-workflows", otg.Namespace)
		}
		if otg.Labels[v1alpha1.LabelWorkflowID] != "wf-1" {
			t.Errorf("missing or wrong workflow-id label: %v", otg.Labels)
		}
		if otg.Labels[v1alpha1.LabelClusterID] != "backend-a" {
			t.Errorf("missing or wrong cluster-id label: %v", otg.Labels)
		}
		if otg.Labels[v1alpha1.LabelGroupName] != "group-a" {
			t.Errorf("missing or wrong group-name label: %v", otg.Labels)
		}
		if otg.Labels[v1alpha1.LabelRuntimeType] != string(v1alpha1.RuntimeKAI) {
			t.Errorf("missing or wrong runtime-type label: %v", otg.Labels)
		}
		// Status must be stripped.
		if otg.Status.Phase != "" {
			t.Errorf("expected empty Status on outgoing CreateOTG, got phase %q", otg.Status.Phase)
		}
	case <-time.After(time.Second):
		t.Fatal("no envelope arrived on session drain")
	}
}

func TestRemoteDispatcher_CreateNoSession(t *testing.T) {
	reg := operator.NewSessionRegistry() // no registered cluster
	bus := &operator.CommandBus{Sessions: reg}
	d := &RemoteDispatcher{
		ClusterID: "ghost",
		Namespace: "osmo-workflows",
		Bus:       bus,
	}
	wf := &v1alpha1.OSMOWorkflow{ObjectMeta: metav1.ObjectMeta{Name: "wf-1"}}
	group := v1alpha1.WorkflowGroup{Name: "g", Cluster: "ghost", RuntimeType: v1alpha1.RuntimeKAI}

	if _, err := d.Create(context.Background(), wf, group); err == nil {
		t.Fatal("expected error when target cluster has no session")
	}
}

func TestRemoteDispatcher_DeleteIsBestEffortWhenDisconnected(t *testing.T) {
	reg := operator.NewSessionRegistry()
	bus := &operator.CommandBus{Sessions: reg}
	d := &RemoteDispatcher{
		ClusterID: "ghost",
		Namespace: "osmo-workflows",
		Bus:       bus,
	}
	ref := v1alpha1.TaskGroupRef{Cluster: "ghost", Namespace: "osmo-workflows", Name: "otg-1"}
	if err := d.Delete(context.Background(), ref); err != nil {
		t.Errorf("expected nil (best-effort) when cluster not connected, got %v", err)
	}
}

func TestRemoteDispatcher_DeleteProducesEnvelope(t *testing.T) {
	reg := operator.NewSessionRegistry()
	sess := reg.Register("backend-a", 4)
	bus := &operator.CommandBus{Sessions: reg}
	d := &RemoteDispatcher{
		ClusterID: "backend-a",
		Namespace: "osmo-workflows",
		Bus:       bus,
	}
	ref := v1alpha1.TaskGroupRef{Cluster: "backend-a", Namespace: "osmo-workflows", Name: "otg-1"}
	if err := d.Delete(context.Background(), ref); err != nil {
		t.Errorf("unexpected error: %v", err)
	}
	select {
	case env := <-sess.Drain():
		del := env.GetDelete()
		if del == nil {
			t.Fatalf("expected DeleteOTG envelope, got %T", env.Body)
		}
		if del.Name != "otg-1" || del.Namespace != "osmo-workflows" {
			t.Errorf("unexpected delete payload: %+v", del)
		}
	case <-time.After(time.Second):
		t.Fatal("no envelope arrived on session drain")
	}
}

// Smoke: make sure the operatorpb import isn't unused if we trim assertions later.
var _ = operatorpb.OperatorEnvelope{}

// TestRemoteDispatcher_RuntimeConfigRoundTrips ensures the runtime.RawExtension payload
// survives the dispatch encode/decode round-trip. This is the wire contract — both ends
// must use a K8s-aware YAML codec (sigs.k8s.io/yaml), not a plain YAML library, because
// runtime.RawExtension is opaque to non-JSON-aware codecs.
func TestRemoteDispatcher_RuntimeConfigRoundTrips(t *testing.T) {
	reg := operator.NewSessionRegistry()
	sess := reg.Register("backend-a", 4)
	bus := &operator.CommandBus{Sessions: reg}
	d := &RemoteDispatcher{
		ClusterID: "backend-a",
		Namespace: "osmo-workflows",
		Bus:       bus,
	}

	wf := &v1alpha1.OSMOWorkflow{ObjectMeta: metav1.ObjectMeta{Name: "wf-1"}}
	group := v1alpha1.WorkflowGroup{
		Name:        "g",
		Cluster:     "backend-a",
		RuntimeType: v1alpha1.RuntimeKAI,
		RuntimeConfig: runtime.RawExtension{
			Raw: []byte(`{"replicas":3,"resources":{"cpu":"4","memory":"16Gi"}}`),
		},
	}
	if _, err := d.Create(context.Background(), wf, group); err != nil {
		t.Fatalf("Create: %v", err)
	}

	env := <-sess.Drain()
	create := env.GetCreate()
	if create == nil {
		t.Fatalf("expected CreateOTG envelope")
	}

	// Receiver-side: decode with the same codec the session client uses.
	var decoded v1alpha1.OSMOTaskGroup
	if err := yaml.Unmarshal(create.OtgYaml, &decoded); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(decoded.Spec.RuntimeConfig.Raw) == 0 {
		t.Fatal("RuntimeConfig.Raw was lost in the round-trip")
	}
	// The codec normalizes whitespace; compare the parsed JSON shape, not the byte string.
	var got map[string]any
	if err := yaml.Unmarshal(decoded.Spec.RuntimeConfig.Raw, &got); err != nil {
		t.Fatalf("decode inner JSON: %v", err)
	}
	if rep, _ := got["replicas"].(float64); rep != 3 {
		t.Errorf("replicas = %v, want 3", got["replicas"])
	}
}

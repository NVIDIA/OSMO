// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

package kai

import (
	"testing"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	v1alpha1 "github.com/nvidia/osmo/taskgroup/api/v1alpha1"
)

func TestRenderPod_BasicShape(t *testing.T) {
	otg := &v1alpha1.OSMOTaskGroup{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "hello",
			Namespace: "default",
		},
		Spec: v1alpha1.OSMOTaskGroupSpec{
			WorkflowID:  "hello",
			GroupName:   "g",
			RuntimeType: v1alpha1.RuntimeKAI,
		},
	}
	cfg := &v1alpha1.KAIRuntimeConfig{
		Tasks: []v1alpha1.TaskTemplate{{
			Name:    "worker-0",
			Lead:    true,
			Image:   "nvcr.io/test:1.0",
			Command: []string{"sleep", "10"},
			Resources: v1alpha1.TaskResources{
				CPU:    resource.MustParse("1"),
				Memory: resource.MustParse("1Gi"),
			},
		}},
	}

	pod := renderPod(otg, cfg, cfg.Tasks[0])

	if pod.Name != "hello-worker-0" {
		t.Errorf("name mismatch: got %s", pod.Name)
	}
	if pod.Namespace != "default" {
		t.Errorf("namespace mismatch: got %s", pod.Namespace)
	}
	if pod.Spec.SchedulerName != "kai-scheduler" {
		t.Errorf("expected default kai-scheduler, got %s", pod.Spec.SchedulerName)
	}
	if pod.Spec.RestartPolicy != corev1.RestartPolicyNever {
		t.Errorf("expected RestartPolicyNever, got %s", pod.Spec.RestartPolicy)
	}
	if len(pod.Spec.Containers) != 1 {
		t.Fatalf("expected 1 container, got %d", len(pod.Spec.Containers))
	}
	c := pod.Spec.Containers[0]
	if c.Name != "user" {
		t.Errorf("expected container name 'user', got %s", c.Name)
	}
	if c.Image != "nvcr.io/test:1.0" {
		t.Errorf("image mismatch: got %s", c.Image)
	}
	if c.Resources.Limits.Cpu().String() != "1" {
		t.Errorf("cpu limit: got %s", c.Resources.Limits.Cpu().String())
	}
	if c.Resources.Requests.Memory().String() != "1Gi" {
		t.Errorf("memory request: got %s", c.Resources.Requests.Memory().String())
	}
	if pod.Labels["workflow.osmo.nvidia.com/lead"] != "true" {
		t.Error("lead label not set on lead task")
	}
	if pod.Labels["workflow.osmo.nvidia.com/workflow-id"] != "hello" {
		t.Errorf("workflow-id label: got %v", pod.Labels)
	}
}

func TestRenderPod_NonLeadOmitsLeadLabel(t *testing.T) {
	otg := &v1alpha1.OSMOTaskGroup{
		ObjectMeta: metav1.ObjectMeta{Name: "hello", Namespace: "default"},
		Spec:       v1alpha1.OSMOTaskGroupSpec{WorkflowID: "hello", GroupName: "g"},
	}
	cfg := &v1alpha1.KAIRuntimeConfig{}
	pod := renderPod(otg, cfg, v1alpha1.TaskTemplate{Name: "worker-1", Image: "x"})
	if _, ok := pod.Labels["workflow.osmo.nvidia.com/lead"]; ok {
		t.Error("non-lead task should not have lead label")
	}
}

func TestRenderPod_GPUResource(t *testing.T) {
	otg := &v1alpha1.OSMOTaskGroup{
		ObjectMeta: metav1.ObjectMeta{Name: "h", Namespace: "default"},
	}
	pod := renderPod(otg, &v1alpha1.KAIRuntimeConfig{}, v1alpha1.TaskTemplate{
		Name:  "w",
		Image: "x",
		Resources: v1alpha1.TaskResources{
			GPU: resource.MustParse("2"),
		},
	})
	got := pod.Spec.Containers[0].Resources.Limits[corev1.ResourceName("nvidia.com/gpu")]
	if got.String() != "2" {
		t.Errorf("gpu limit: got %s, want 2", got.String())
	}
}

func TestRenderPod_CredentialAsEnv(t *testing.T) {
	pod := renderPod(
		&v1alpha1.OSMOTaskGroup{ObjectMeta: metav1.ObjectMeta{Name: "h", Namespace: "default"}},
		&v1alpha1.KAIRuntimeConfig{},
		v1alpha1.TaskTemplate{
			Name:  "w",
			Image: "x",
			Credentials: []v1alpha1.CredentialRef{{
				SecretName: "hf-token-secret",
				KeyMap:     map[string]string{"HF_TOKEN": "token"},
			}},
		},
	)
	var hfTokenEnv *corev1.EnvVar
	for i := range pod.Spec.Containers[0].Env {
		if pod.Spec.Containers[0].Env[i].Name == "HF_TOKEN" {
			hfTokenEnv = &pod.Spec.Containers[0].Env[i]
			break
		}
	}
	if hfTokenEnv == nil {
		t.Fatal("HF_TOKEN env var missing")
	}
	if hfTokenEnv.ValueFrom == nil || hfTokenEnv.ValueFrom.SecretKeyRef == nil {
		t.Fatal("HF_TOKEN should be SecretKeyRef-sourced")
	}
	if hfTokenEnv.ValueFrom.SecretKeyRef.Name != "hf-token-secret" {
		t.Errorf("secret name: %s", hfTokenEnv.ValueFrom.SecretKeyRef.Name)
	}
	if hfTokenEnv.ValueFrom.SecretKeyRef.Key != "token" {
		t.Errorf("secret key: %s", hfTokenEnv.ValueFrom.SecretKeyRef.Key)
	}
}

func TestRenderPodGroup_MinMemberDefaultsToTaskCount(t *testing.T) {
	otg := &v1alpha1.OSMOTaskGroup{
		ObjectMeta: metav1.ObjectMeta{Name: "h", Namespace: "default"},
	}
	cfg := &v1alpha1.KAIRuntimeConfig{
		Tasks: []v1alpha1.TaskTemplate{{Name: "a"}, {Name: "b"}, {Name: "c"}},
	}
	pg := renderPodGroup(otg, cfg)
	spec, _ := pg.Object["spec"].(map[string]any)
	min, _ := spec["minMember"].(int32)
	if min != 3 {
		t.Errorf("minMember should default to task count (3), got %d", min)
	}
}

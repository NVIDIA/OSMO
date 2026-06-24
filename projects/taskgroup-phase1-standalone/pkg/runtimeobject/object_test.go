package runtimeobject

import (
	"testing"

	taskgroupv1alpha1 "example.com/taskgroup-phase1-standalone/api/taskgroup/v1alpha1"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
)

func TestSpecHashNormalizesTypedNumbers(t *testing.T) {
	object := &unstructured.Unstructured{Object: map[string]any{
		"apiVersion": "ray.io/v1",
		"kind":       "RayJob",
		"metadata": map[string]any{
			"name":      "ray-smoke",
			"namespace": "default",
		},
		"spec": map[string]any{
			"rayClusterSpec": map[string]any{
				"workerGroupSpecs": []any{
					map[string]any{"replicas": int32(1)},
				},
			},
		},
	}}

	if _, err := SpecHash(object); err != nil {
		t.Fatalf("SpecHash() error = %v", err)
	}
}

func TestPropagateControllerOwner(t *testing.T) {
	otg := &taskgroupv1alpha1.OSMOTaskGroup{
		ObjectMeta: metav1.ObjectMeta{
			Labels: map[string]string{
				taskgroupv1alpha1.ControllerOwnerLabel: taskgroupv1alpha1.ControllerOwnerPhase1A,
			},
		},
	}
	object := &unstructured.Unstructured{}

	PropagateControllerOwner(otg, object)

	if got := object.GetLabels()[taskgroupv1alpha1.ControllerOwnerLabel]; got != taskgroupv1alpha1.ControllerOwnerPhase1A {
		t.Fatalf("controller owner label = %q, want %q", got, taskgroupv1alpha1.ControllerOwnerPhase1A)
	}
}

package ray

import (
	"strings"
	"testing"

	taskgroupv1alpha1 "example.com/taskgroup-phase1-standalone/api/taskgroup/v1alpha1"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func TestRenderRayJobEmbedsClusterSpec(t *testing.T) {
	otg := &taskgroupv1alpha1.OSMOTaskGroup{
		ObjectMeta: metav1.ObjectMeta{Name: "wf-ray", Namespace: "osmo-vpan"},
		Spec: taskgroupv1alpha1.OSMOTaskGroupSpec{
			GroupName: "ray",
			WorkflowRef: taskgroupv1alpha1.WorkflowReference{
				Name: "wf",
			},
		},
	}
	objects := Render(otg, validRayConfig(modeJob))
	if len(objects) != 2 {
		t.Fatalf("rendered objects = %d, want 2", len(objects))
	}
	if objects[0].GetKind() != "PodGroup" {
		t.Fatalf("first kind = %q, want PodGroup", objects[0].GetKind())
	}
	podGroupSpec := objects[0].Object["spec"].(map[string]any)
	if podGroupSpec["minMember"] != int64(2) {
		t.Fatalf("podGroup minMember = %v, want 2", podGroupSpec["minMember"])
	}
	if objects[1].GetKind() != "RayJob" {
		t.Fatalf("second kind = %q, want RayJob", objects[1].GetKind())
	}
	spec := objects[1].Object["spec"].(map[string]any)
	if spec["entrypoint"] != "python train.py" {
		t.Fatalf("entrypoint = %q, want python train.py", spec["entrypoint"])
	}
	clusterSpec := spec["rayClusterSpec"].(map[string]any)
	if clusterSpec["rayVersion"] != "2.9.0" {
		t.Fatalf("rayVersion = %q, want 2.9.0", clusterSpec["rayVersion"])
	}
	headTemplate := clusterSpec["headGroupSpec"].(map[string]any)["template"].(map[string]any)
	annotations := headTemplate["metadata"].(map[string]any)["annotations"].(map[string]any)
	if annotations["pod-group-name"] != "wf-ray" {
		t.Fatalf("head pod-group-name annotation = %v, want wf-ray", annotations["pod-group-name"])
	}
	runtimeEnvYAML, ok := spec["runtimeEnvYAML"].(string)
	if !ok {
		t.Fatalf("runtimeEnvYAML missing from RayJob spec")
	}
	for _, want := range []string{"working_dir: s3://bucket/code.zip", "NCCL_DEBUG: INFO"} {
		if !strings.Contains(runtimeEnvYAML, want) {
			t.Fatalf("runtimeEnvYAML = %q, want substring %q", runtimeEnvYAML, want)
		}
	}
}

func TestRenderRayClusterForClusterMode(t *testing.T) {
	otg := &taskgroupv1alpha1.OSMOTaskGroup{
		ObjectMeta: metav1.ObjectMeta{Name: "wf-ray", Namespace: "osmo-vpan"},
	}
	config := validRayConfig(modeCluster)
	config.Scheduler = taskgroupv1alpha1.SchedulerConfig{}
	objects := Render(otg, config)
	if len(objects) != 1 {
		t.Fatalf("rendered objects = %d, want 1", len(objects))
	}
	if objects[0].GetKind() != "RayCluster" {
		t.Fatalf("kind = %q, want RayCluster", objects[0].GetKind())
	}
}

func validRayConfig(mode string) taskgroupv1alpha1.RayConfig {
	return taskgroupv1alpha1.RayConfig{
		Mode:       mode,
		RayVersion: "2.9.0",
		Scheduler: taskgroupv1alpha1.SchedulerConfig{
			Queue:         "queue-a",
			SchedulerName: "kai-scheduler",
		},
		Head: taskgroupv1alpha1.RayNodeGroup{
			Image: "rayproject/ray:2.9.0",
			Resources: taskgroupv1alpha1.RayResources{
				CPU:    "1",
				Memory: "2Gi",
			},
		},
		Workers: []taskgroupv1alpha1.RayWorkerGroup{{
			Name:     "workers",
			Replicas: 1,
			RayNodeGroup: taskgroupv1alpha1.RayNodeGroup{
				Image: "rayproject/ray:2.9.0",
			},
		}},
		Job: &taskgroupv1alpha1.RayJobConfig{
			Entrypoint: "python train.py",
			WorkingDir: "s3://bucket/code.zip",
			Env: map[string]string{
				"NCCL_DEBUG": "INFO",
			},
		},
	}
}

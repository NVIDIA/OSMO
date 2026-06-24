package kai

import (
	"testing"

	taskgroupv1alpha1 "example.com/taskgroup-phase1-standalone/api/taskgroup/v1alpha1"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func TestRenderIncludesKAIQueueLabelsAndPodGroup(t *testing.T) {
	objects, err := Render(&taskgroupv1alpha1.OSMOTaskGroup{
		ObjectMeta: metav1.ObjectMeta{Name: "otg-smoke", Namespace: "osmo-vpan"},
		Spec: taskgroupv1alpha1.OSMOTaskGroupSpec{
			RuntimeConfig: taskgroupv1alpha1.NewKAIConfig(taskgroupv1alpha1.KAIConfig{
				Queue:             "queue-a",
				PriorityClassName: "high",
				MinMember:         1,
				SchedulerName:     "kai-scheduler",
				PodTemplate: taskgroupv1alpha1.KAIPodTemplate{
					Containers: []taskgroupv1alpha1.KAIContainer{{Name: "user", Image: "busybox"}},
				},
			}),
		},
	})
	if err != nil {
		t.Fatalf("Render() error = %v", err)
	}
	if len(objects) != 2 {
		t.Fatalf("rendered objects = %d, want 2", len(objects))
	}
	if objects[0].GetKind() != "PodGroup" {
		t.Fatalf("first object kind = %q, want PodGroup", objects[0].GetKind())
	}
	if objects[1].GetKind() != "Pod" {
		t.Fatalf("second object kind = %q, want Pod", objects[1].GetKind())
	}
	if objects[1].GetLabels()["kai.scheduler/queue"] != "queue-a" {
		t.Fatalf("pod kai queue label = %q, want queue-a", objects[1].GetLabels()["kai.scheduler/queue"])
	}
	if objects[1].GetLabels()["runai/queue"] != "queue-a" {
		t.Fatalf("pod legacy queue label = %q, want queue-a", objects[1].GetLabels()["runai/queue"])
	}
	if objects[1].GetAnnotations()["pod-group-name"] != "otg-smoke" {
		t.Fatalf("pod-group-name annotation = %q, want otg-smoke", objects[1].GetAnnotations()["pod-group-name"])
	}
}

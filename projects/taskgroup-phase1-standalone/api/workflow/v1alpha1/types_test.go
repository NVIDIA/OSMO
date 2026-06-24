package v1alpha1

import (
	"strings"
	"testing"

	taskgroupv1alpha1 "example.com/taskgroup-phase1-standalone/api/taskgroup/v1alpha1"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func TestValidateRejectsDependencyCycle(t *testing.T) {
	workflow := &Workflow{
		ObjectMeta: metav1.ObjectMeta{Name: "cycle", Namespace: "control"},
		Spec: WorkflowSpec{
			ClusterID: "compute-a",
			Namespace: "osmo-vpan",
			Mode:      taskgroupv1alpha1.ModeActive,
			TaskGroups: []WorkflowTaskGroup{
				{Name: "a", DependsOn: []string{"b"}},
				{Name: "b", DependsOn: []string{"c"}},
				{Name: "c", DependsOn: []string{"a"}},
			},
		},
	}
	err := workflow.Validate()
	if err == nil || !strings.Contains(err.Error(), "dependency cycle") {
		t.Fatalf("Validate() error = %v, want dependency cycle", err)
	}
}

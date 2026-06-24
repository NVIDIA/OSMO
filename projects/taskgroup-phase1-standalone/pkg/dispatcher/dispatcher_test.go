package dispatcher

import (
	"context"
	"testing"

	taskgroupv1alpha1 "example.com/taskgroup-phase1-standalone/api/taskgroup/v1alpha1"
	workflowv1alpha1 "example.com/taskgroup-phase1-standalone/api/workflow/v1alpha1"
	"example.com/taskgroup-phase1-standalone/pkg/agent"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"
	"sigs.k8s.io/controller-runtime/pkg/reconcile"
)

func TestWorkflowReconcilerDispatchesWorkflowGroupsAsComputeOTGs(t *testing.T) {
	ctx := context.Background()
	controlScheme := newWorkflowScheme(t)
	computeScheme := newTaskGroupScheme(t)
	workflow := validWorkflow()
	controlClient := fake.NewClientBuilder().
		WithScheme(controlScheme).
		WithStatusSubresource(&workflowv1alpha1.Workflow{}).
		WithObjects(workflow).
		Build()
	computeClient := fake.NewClientBuilder().
		WithScheme(computeScheme).
		WithStatusSubresource(&taskgroupv1alpha1.OSMOTaskGroup{}).
		Build()
	reconciler := NewWorkflowReconciler(
		controlClient,
		agent.NewLocalComputeAgent("compute-a", computeClient),
		DefaultPlanners(),
	)

	if err := reconcileWorkflowTwice(ctx, reconciler, workflow); err != nil {
		t.Fatalf("Reconcile() error = %v", err)
	}

	otg := &taskgroupv1alpha1.OSMOTaskGroup{}
	if err := computeClient.Get(ctx, client.ObjectKey{Namespace: "osmo-vpan", Name: "kai-smoke-smoke"}, otg); err != nil {
		t.Fatalf("compute OTG was not created: %v", err)
	}
	if otg.Spec.RuntimeType != taskgroupv1alpha1.RuntimeTypeKAI {
		t.Fatalf("otg runtimeType = %q, want kai", otg.Spec.RuntimeType)
	}
	if got := otg.Labels[taskgroupv1alpha1.ControllerOwnerLabel]; got != taskgroupv1alpha1.ControllerOwnerPhase1A {
		t.Fatalf("otg controller owner label = %q, want %q", got, taskgroupv1alpha1.ControllerOwnerPhase1A)
	}
	kaiConfig, err := otg.Spec.RuntimeConfig.KAIConfig()
	if err != nil {
		t.Fatalf("KAIConfig() error = %v", err)
	}
	if kaiConfig.Queue != "queue-a" {
		t.Fatalf("otg KAI queue = %q, want queue-a", kaiConfig.Queue)
	}
	updatedWorkflow := &workflowv1alpha1.Workflow{}
	if err := controlClient.Get(ctx, client.ObjectKeyFromObject(workflow), updatedWorkflow); err != nil {
		t.Fatalf("Get workflow error = %v", err)
	}
	if updatedWorkflow.Status.Phase != workflowv1alpha1.WorkflowPhasePending {
		t.Fatalf("workflow phase = %q, want Pending", updatedWorkflow.Status.Phase)
	}
}

func TestWorkflowReconcilerAggregatesComputeOTGStatus(t *testing.T) {
	ctx := context.Background()
	controlScheme := newWorkflowScheme(t)
	computeScheme := newTaskGroupScheme(t)
	workflow := validWorkflow()
	otg, err := NewKAIPlanner().BuildOTG(ctx, workflow, workflow.Spec.TaskGroups[0])
	if err != nil {
		t.Fatalf("BuildOTG() error = %v", err)
	}
	otg.Status.Phase = workflowv1alpha1.WorkflowPhaseRunning
	controlClient := fake.NewClientBuilder().
		WithScheme(controlScheme).
		WithStatusSubresource(&workflowv1alpha1.Workflow{}).
		WithObjects(workflow).
		Build()
	computeClient := fake.NewClientBuilder().
		WithScheme(computeScheme).
		WithStatusSubresource(&taskgroupv1alpha1.OSMOTaskGroup{}).
		WithObjects(otg).
		Build()
	reconciler := NewWorkflowReconciler(
		controlClient,
		agent.NewLocalComputeAgent("compute-a", computeClient),
		DefaultPlanners(),
	)

	if err := reconcileWorkflowTwice(ctx, reconciler, workflow); err != nil {
		t.Fatalf("Reconcile() error = %v", err)
	}

	updatedWorkflow := &workflowv1alpha1.Workflow{}
	if err := controlClient.Get(ctx, client.ObjectKeyFromObject(workflow), updatedWorkflow); err != nil {
		t.Fatalf("Get workflow error = %v", err)
	}
	if updatedWorkflow.Status.Phase != workflowv1alpha1.WorkflowPhaseRunning {
		t.Fatalf("workflow phase = %q, want Running", updatedWorkflow.Status.Phase)
	}
}

func TestWorkflowReconcilerDispatchesDependencyOnlyAfterUpstreamSucceeded(t *testing.T) {
	ctx := context.Background()
	controlScheme := newWorkflowScheme(t)
	computeScheme := newTaskGroupScheme(t)
	workflow := validWorkflowWithDependency()
	controlClient := fake.NewClientBuilder().
		WithScheme(controlScheme).
		WithStatusSubresource(&workflowv1alpha1.Workflow{}).
		WithObjects(workflow).
		Build()
	computeClient := fake.NewClientBuilder().
		WithScheme(computeScheme).
		WithStatusSubresource(&taskgroupv1alpha1.OSMOTaskGroup{}).
		Build()
	reconciler := NewWorkflowReconciler(
		controlClient,
		agent.NewLocalComputeAgent("compute-a", computeClient),
		DefaultPlanners(),
	)

	if err := reconcileWorkflowTwice(ctx, reconciler, workflow); err != nil {
		t.Fatalf("first reconcile error = %v", err)
	}
	if err := computeClient.Get(ctx, client.ObjectKey{Namespace: "osmo-vpan", Name: "dag-smoke-prep"}, &taskgroupv1alpha1.OSMOTaskGroup{}); err != nil {
		t.Fatalf("upstream OTG was not created: %v", err)
	}
	if err := computeClient.Get(ctx, client.ObjectKey{Namespace: "osmo-vpan", Name: "dag-smoke-train"}, &taskgroupv1alpha1.OSMOTaskGroup{}); err == nil {
		t.Fatalf("dependent OTG was created before upstream succeeded")
	}

	prep := &taskgroupv1alpha1.OSMOTaskGroup{}
	if err := computeClient.Get(ctx, client.ObjectKey{Namespace: "osmo-vpan", Name: "dag-smoke-prep"}, prep); err != nil {
		t.Fatalf("Get upstream OTG error = %v", err)
	}
	prep.Status.Phase = workflowv1alpha1.WorkflowPhaseSucceeded
	if err := computeClient.Status().Update(ctx, prep); err != nil {
		t.Fatalf("update upstream status error = %v", err)
	}
	if _, err := reconciler.Reconcile(ctx, reconcile.Request{NamespacedName: client.ObjectKeyFromObject(workflow)}); err != nil {
		t.Fatalf("second reconcile error = %v", err)
	}
	if err := computeClient.Get(ctx, client.ObjectKey{Namespace: "osmo-vpan", Name: "dag-smoke-train"}, &taskgroupv1alpha1.OSMOTaskGroup{}); err != nil {
		t.Fatalf("dependent OTG was not created after upstream succeeded: %v", err)
	}
}

func reconcileWorkflowTwice(ctx context.Context, reconciler *WorkflowReconciler, workflow *workflowv1alpha1.Workflow) error {
	request := reconcile.Request{NamespacedName: client.ObjectKeyFromObject(workflow)}
	if _, err := reconciler.Reconcile(ctx, request); err != nil {
		return err
	}
	_, err := reconciler.Reconcile(ctx, request)
	return err
}

func validWorkflowWithDependency() *workflowv1alpha1.Workflow {
	workflow := validWorkflow()
	workflow.ObjectMeta.Name = "dag-smoke"
	workflow.Spec.TaskGroups = append(workflow.Spec.TaskGroups, workflowv1alpha1.WorkflowTaskGroup{
		Name:      "train",
		DependsOn: []string{"prep"},
		RuntimeConfig: taskgroupv1alpha1.NewKAIConfig(taskgroupv1alpha1.KAIConfig{
			Queue:         "queue-a",
			SchedulerName: "kai-scheduler",
			MinMember:     1,
			PodTemplate: taskgroupv1alpha1.KAIPodTemplate{
				Containers: []taskgroupv1alpha1.KAIContainer{
					{Name: "user", Image: "busybox", Command: []string{"sleep", "60"}},
				},
			},
		}),
	})
	workflow.Spec.TaskGroups[0].Name = "prep"
	return workflow
}

func validWorkflow() *workflowv1alpha1.Workflow {
	return &workflowv1alpha1.Workflow{
		TypeMeta: metav1.TypeMeta{
			APIVersion: workflowv1alpha1.GroupVersion.String(),
			Kind:       "Workflow",
		},
		ObjectMeta: metav1.ObjectMeta{Name: "kai-smoke", Namespace: "control", UID: "workflow-uid"},
		Spec: workflowv1alpha1.WorkflowSpec{
			ClusterID: "compute-a",
			Namespace: "osmo-vpan",
			Mode:      taskgroupv1alpha1.ModeActive,
			TaskGroups: []workflowv1alpha1.WorkflowTaskGroup{
				{
					Name: "smoke",
					RuntimeConfig: taskgroupv1alpha1.NewKAIConfig(taskgroupv1alpha1.KAIConfig{
						Queue:         "queue-a",
						SchedulerName: "kai-scheduler",
						MinMember:     1,
						PodTemplate: taskgroupv1alpha1.KAIPodTemplate{
							Labels: map[string]string{"app": "osmo"},
							Containers: []taskgroupv1alpha1.KAIContainer{
								{Name: "user", Image: "busybox", Command: []string{"sleep", "60"}},
							},
						},
					}),
				},
			},
		},
	}
}

func newWorkflowScheme(t *testing.T) *runtime.Scheme {
	t.Helper()
	scheme := runtime.NewScheme()
	if err := workflowv1alpha1.AddToScheme(scheme); err != nil {
		t.Fatalf("AddToScheme workflow error = %v", err)
	}
	return scheme
}

func newTaskGroupScheme(t *testing.T) *runtime.Scheme {
	t.Helper()
	scheme := runtime.NewScheme()
	if err := taskgroupv1alpha1.AddToScheme(scheme); err != nil {
		t.Fatalf("AddToScheme taskgroup error = %v", err)
	}
	if err := corev1.AddToScheme(scheme); err != nil {
		t.Fatalf("AddToScheme core error = %v", err)
	}
	return scheme
}

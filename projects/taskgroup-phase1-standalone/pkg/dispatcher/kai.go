package dispatcher

import (
	"context"
	"fmt"

	taskgroupv1alpha1 "example.com/taskgroup-phase1-standalone/api/taskgroup/v1alpha1"
	workflowv1alpha1 "example.com/taskgroup-phase1-standalone/api/workflow/v1alpha1"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

type KAIPlanner struct{}

func NewKAIPlanner() *KAIPlanner {
	return &KAIPlanner{}
}

func (p *KAIPlanner) Validate(_ context.Context, workflow *workflowv1alpha1.Workflow, group workflowv1alpha1.WorkflowTaskGroup) error {
	config, err := group.RuntimeConfig.KAIConfig()
	if err != nil {
		return fmt.Errorf("task group %q: %w", group.Name, err)
	}
	if len(config.PodTemplate.Containers) == 0 {
		return fmt.Errorf("task group %q runtimeConfig.kai.podTemplate.containers is required", group.Name)
	}
	for _, container := range config.PodTemplate.Containers {
		if container.Name == "" || container.Image == "" {
			return fmt.Errorf("task group %q each KAI container requires name and image", group.Name)
		}
	}
	if workflow.EffectiveRuntimeType(group) != taskgroupv1alpha1.RuntimeTypeKAI {
		return fmt.Errorf("KAI planner cannot handle runtimeType %q", workflow.EffectiveRuntimeType(group))
	}
	return nil
}

func (p *KAIPlanner) BuildOTG(_ context.Context, workflow *workflowv1alpha1.Workflow, group workflowv1alpha1.WorkflowTaskGroup) (*taskgroupv1alpha1.OSMOTaskGroup, error) {
	otgName := OTGName(workflow.Name, group.Name)
	return &taskgroupv1alpha1.OSMOTaskGroup{
		TypeMeta: metav1.TypeMeta{
			APIVersion: taskgroupv1alpha1.GroupVersion.String(),
			Kind:       "OSMOTaskGroup",
		},
		ObjectMeta: metav1.ObjectMeta{
			Name:      otgName,
			Namespace: workflow.EffectiveNamespace(),
			Labels: map[string]string{
				taskgroupv1alpha1.ControllerOwnerLabel:   taskgroupv1alpha1.ControllerOwnerPhase1A,
				"workflow.osmo.nvidia.com/workflow-name": workflow.EffectiveWorkflowName(),
				"workflow.osmo.nvidia.com/group-name":    group.Name,
			},
		},
		Spec: taskgroupv1alpha1.OSMOTaskGroupSpec{
			WorkflowRef: taskgroupv1alpha1.WorkflowReference{
				ID:   workflow.EffectiveWorkflowID(),
				Name: workflow.EffectiveWorkflowName(),
			},
			GroupName:     group.Name,
			Mode:          workflow.EffectiveMode(),
			RuntimeType:   taskgroupv1alpha1.RuntimeTypeKAI,
			RuntimeConfig: group.RuntimeConfig,
		},
	}, nil
}

func DefaultPlanners() map[string]RuntimePlanner {
	return map[string]RuntimePlanner{
		taskgroupv1alpha1.RuntimeTypeKAI:                NewKAIPlanner(),
		taskgroupv1alpha1.RuntimeTypeOSMOContainerGroup: NewPassthroughPlanner(taskgroupv1alpha1.RuntimeTypeOSMOContainerGroup),
		taskgroupv1alpha1.RuntimeTypeRay:                NewPassthroughPlanner(taskgroupv1alpha1.RuntimeTypeRay),
	}
}

type PassthroughPlanner struct {
	runtimeType string
}

func NewPassthroughPlanner(runtimeType string) *PassthroughPlanner {
	return &PassthroughPlanner{runtimeType: runtimeType}
}

func (p *PassthroughPlanner) Validate(_ context.Context, workflow *workflowv1alpha1.Workflow, group workflowv1alpha1.WorkflowTaskGroup) error {
	if workflow.EffectiveRuntimeType(group) != p.runtimeType {
		return fmt.Errorf("%s planner cannot handle runtimeType %q", p.runtimeType, workflow.EffectiveRuntimeType(group))
	}
	switch p.runtimeType {
	case taskgroupv1alpha1.RuntimeTypeOSMOContainerGroup:
		if _, err := group.RuntimeConfig.OSMOContainerGroupConfig(); err != nil {
			return fmt.Errorf("task group %q: %w", group.Name, err)
		}
	case taskgroupv1alpha1.RuntimeTypeRay:
		if _, err := group.RuntimeConfig.RayConfig(); err != nil {
			return fmt.Errorf("task group %q: %w", group.Name, err)
		}
	default:
		return fmt.Errorf("unsupported passthrough runtimeType %q", p.runtimeType)
	}
	return nil
}

func (p *PassthroughPlanner) BuildOTG(_ context.Context, workflow *workflowv1alpha1.Workflow, group workflowv1alpha1.WorkflowTaskGroup) (*taskgroupv1alpha1.OSMOTaskGroup, error) {
	otgName := OTGName(workflow.Name, group.Name)
	return &taskgroupv1alpha1.OSMOTaskGroup{
		TypeMeta: metav1.TypeMeta{
			APIVersion: taskgroupv1alpha1.GroupVersion.String(),
			Kind:       "OSMOTaskGroup",
		},
		ObjectMeta: metav1.ObjectMeta{
			Name:      otgName,
			Namespace: workflow.EffectiveNamespace(),
			Labels: map[string]string{
				taskgroupv1alpha1.ControllerOwnerLabel:   taskgroupv1alpha1.ControllerOwnerPhase1A,
				"workflow.osmo.nvidia.com/workflow-name": workflow.EffectiveWorkflowName(),
				"workflow.osmo.nvidia.com/group-name":    group.Name,
				"workflow.osmo.nvidia.com/runtime-type":  p.runtimeType,
			},
		},
		Spec: taskgroupv1alpha1.OSMOTaskGroupSpec{
			WorkflowRef: taskgroupv1alpha1.WorkflowReference{
				ID:   workflow.EffectiveWorkflowID(),
				Name: workflow.EffectiveWorkflowName(),
			},
			GroupName:     group.Name,
			Mode:          workflow.EffectiveMode(),
			RuntimeType:   p.runtimeType,
			RuntimeConfig: group.RuntimeConfig,
		},
	}, nil
}

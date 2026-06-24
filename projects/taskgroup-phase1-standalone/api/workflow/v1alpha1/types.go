package v1alpha1

import (
	"fmt"

	taskgroupv1alpha1 "example.com/taskgroup-phase1-standalone/api/taskgroup/v1alpha1"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
)

const (
	WorkflowPhasePending   = "Pending"
	WorkflowPhaseRunning   = "Running"
	WorkflowPhaseSucceeded = "Succeeded"
	WorkflowPhaseFailed    = "Failed"
)

type WorkflowSpec struct {
	ClusterID    string              `json:"clusterID,omitempty" yaml:"clusterID,omitempty"`
	Namespace    string              `json:"namespace,omitempty" yaml:"namespace,omitempty"`
	Mode         string              `json:"mode,omitempty" yaml:"mode,omitempty"`
	Owner        string              `json:"owner,omitempty" yaml:"owner,omitempty"`
	Pool         string              `json:"pool,omitempty" yaml:"pool,omitempty"`
	Priority     string              `json:"priority,omitempty" yaml:"priority,omitempty"`
	Source       WorkflowSource      `json:"source,omitempty" yaml:"source,omitempty"`
	RuntimeType  string              `json:"runtimeType,omitempty" yaml:"runtimeType,omitempty"`
	TaskGroups   []WorkflowTaskGroup `json:"taskGroups,omitempty" yaml:"taskGroups,omitempty"`
	WorkflowID   string              `json:"workflowID,omitempty" yaml:"workflowID,omitempty"`
	WorkflowName string              `json:"workflowName,omitempty" yaml:"workflowName,omitempty"`
}

type WorkflowSource struct {
	Format          string `json:"format,omitempty" yaml:"format,omitempty"`
	RenderedSpecRef string `json:"renderedSpecRef,omitempty" yaml:"renderedSpecRef,omitempty"`
}

type WorkflowTaskGroup struct {
	Name          string                          `json:"name,omitempty" yaml:"name,omitempty"`
	DependsOn     []string                        `json:"dependsOn,omitempty" yaml:"dependsOn,omitempty"`
	RuntimeType   string                          `json:"runtimeType,omitempty" yaml:"runtimeType,omitempty"`
	RuntimeConfig taskgroupv1alpha1.RuntimeConfig `json:"runtimeConfig,omitempty" yaml:"runtimeConfig,omitempty"`
}

type WorkflowStatus struct {
	Phase              string                `json:"phase,omitempty" yaml:"phase,omitempty"`
	Message            string                `json:"message,omitempty" yaml:"message,omitempty"`
	ObservedGeneration int64                 `json:"observedGeneration,omitempty" yaml:"observedGeneration,omitempty"`
	Groups             []WorkflowGroupStatus `json:"groups,omitempty" yaml:"groups,omitempty"`
	Conditions         []metav1.Condition    `json:"conditions,omitempty" yaml:"conditions,omitempty"`
}

type WorkflowGroupStatus struct {
	Name           string      `json:"name,omitempty" yaml:"name,omitempty"`
	OTGName        string      `json:"otgName,omitempty" yaml:"otgName,omitempty"`
	ClusterID      string      `json:"clusterID,omitempty" yaml:"clusterID,omitempty"`
	Namespace      string      `json:"namespace,omitempty" yaml:"namespace,omitempty"`
	Phase          string      `json:"phase,omitempty" yaml:"phase,omitempty"`
	Message        string      `json:"message,omitempty" yaml:"message,omitempty"`
	LastReportTime metav1.Time `json:"lastReportTime,omitempty" yaml:"lastReportTime,omitempty"`
}

type Workflow struct {
	metav1.TypeMeta   `json:",inline" yaml:",inline"`
	metav1.ObjectMeta `json:"metadata,omitempty" yaml:"metadata,omitempty"`
	Spec              WorkflowSpec   `json:"spec,omitempty" yaml:"spec,omitempty"`
	Status            WorkflowStatus `json:"status,omitempty" yaml:"status,omitempty"`
}

type WorkflowList struct {
	metav1.TypeMeta `json:",inline" yaml:",inline"`
	metav1.ListMeta `json:"metadata,omitempty" yaml:"metadata,omitempty"`
	Items           []Workflow `json:"items" yaml:"items"`
}

func (in *Workflow) DeepCopyObject() runtime.Object {
	if in == nil {
		return nil
	}
	out := *in
	out.ObjectMeta = *in.ObjectMeta.DeepCopy()
	out.Spec.TaskGroups = make([]WorkflowTaskGroup, len(in.Spec.TaskGroups))
	for i := range in.Spec.TaskGroups {
		out.Spec.TaskGroups[i] = copyTaskGroup(in.Spec.TaskGroups[i])
	}
	out.Status.Groups = append([]WorkflowGroupStatus(nil), in.Status.Groups...)
	out.Status.Conditions = append([]metav1.Condition(nil), in.Status.Conditions...)
	return &out
}

func (in *WorkflowList) DeepCopyObject() runtime.Object {
	if in == nil {
		return nil
	}
	out := *in
	out.ListMeta = in.ListMeta
	out.Items = make([]Workflow, len(in.Items))
	for i := range in.Items {
		out.Items[i] = *in.Items[i].DeepCopyObject().(*Workflow)
	}
	return &out
}

func (in *Workflow) EffectiveNamespace() string {
	if in.Spec.Namespace != "" {
		return in.Spec.Namespace
	}
	return in.Namespace
}

func (in *Workflow) EffectiveMode() string {
	if in.Spec.Mode != "" {
		return in.Spec.Mode
	}
	return taskgroupv1alpha1.ModeShadow
}

func (in *Workflow) EffectiveRuntimeType(group WorkflowTaskGroup) string {
	if group.RuntimeType != "" {
		return group.RuntimeType
	}
	if in.Spec.RuntimeType != "" {
		return in.Spec.RuntimeType
	}
	return taskgroupv1alpha1.RuntimeTypeKAI
}

func (in *Workflow) EffectiveWorkflowID() string {
	if in.Spec.WorkflowID != "" {
		return in.Spec.WorkflowID
	}
	return string(in.UID)
}

func (in *Workflow) EffectiveWorkflowName() string {
	if in.Spec.WorkflowName != "" {
		return in.Spec.WorkflowName
	}
	return in.Name
}

func (in *Workflow) Validate() error {
	if in.Spec.ClusterID == "" {
		return fmt.Errorf("spec.clusterID is required")
	}
	if in.EffectiveNamespace() == "" {
		return fmt.Errorf("spec.namespace is required when workflow metadata.namespace is empty")
	}
	switch in.EffectiveMode() {
	case taskgroupv1alpha1.ModeActive, taskgroupv1alpha1.ModeShadow:
	default:
		return fmt.Errorf("unsupported mode %q", in.EffectiveMode())
	}
	if len(in.Spec.TaskGroups) == 0 {
		return fmt.Errorf("spec.taskGroups requires at least one task group")
	}
	seen := map[string]struct{}{}
	for _, group := range in.Spec.TaskGroups {
		if group.Name == "" {
			return fmt.Errorf("each task group requires name")
		}
		if _, ok := seen[group.Name]; ok {
			return fmt.Errorf("duplicate task group name %q", group.Name)
		}
		seen[group.Name] = struct{}{}
	}
	for _, group := range in.Spec.TaskGroups {
		for _, dependency := range group.DependsOn {
			if dependency == group.Name {
				return fmt.Errorf("task group %q cannot depend on itself", group.Name)
			}
			if _, ok := seen[dependency]; !ok {
				return fmt.Errorf("task group %q depends on unknown group %q", group.Name, dependency)
			}
		}
	}
	if err := validateAcyclic(in.Spec.TaskGroups); err != nil {
		return err
	}
	return nil
}

func validateAcyclic(groups []WorkflowTaskGroup) error {
	dependencies := map[string][]string{}
	for _, group := range groups {
		dependencies[group.Name] = append([]string(nil), group.DependsOn...)
	}
	visiting := map[string]bool{}
	visited := map[string]bool{}
	var visit func(string) error
	visit = func(name string) error {
		if visiting[name] {
			return fmt.Errorf("task group dependency cycle includes %q", name)
		}
		if visited[name] {
			return nil
		}
		visiting[name] = true
		for _, dependency := range dependencies[name] {
			if err := visit(dependency); err != nil {
				return err
			}
		}
		visiting[name] = false
		visited[name] = true
		return nil
	}
	for _, group := range groups {
		if err := visit(group.Name); err != nil {
			return err
		}
	}
	return nil
}

func copyTaskGroup(in WorkflowTaskGroup) WorkflowTaskGroup {
	out := in
	out.DependsOn = append([]string(nil), in.DependsOn...)
	out.RuntimeConfig = in.RuntimeConfig.DeepCopy()
	return out
}

func copyStringMap(in map[string]string) map[string]string {
	if len(in) == 0 {
		return nil
	}
	out := make(map[string]string, len(in))
	for k, v := range in {
		out[k] = v
	}
	return out
}

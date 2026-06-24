package v1alpha1

import (
	"encoding/json"
	"fmt"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
)

const (
	RuntimeTypeKAI                = "kai"
	RuntimeTypeOSMOContainerGroup = "osmo-container-group"
	RuntimeTypeRay                = "ray"
	ModeShadow                    = "shadow"
	ModeActive                    = "active"

	FinalizerLogCollection = "workflow.osmo.nvidia.com/log-collection"

	ControllerOwnerLabel   = "workflow.osmo.nvidia.com/controller"
	ControllerOwnerPhase1A = "phase1a"
)

type OSMOTaskGroupSpec struct {
	WorkflowRef   WorkflowReference `json:"workflowRef,omitempty" yaml:"workflowRef,omitempty"`
	GroupName     string            `json:"groupName,omitempty" yaml:"groupName,omitempty"`
	Mode          string            `json:"mode,omitempty" yaml:"mode,omitempty"`
	RuntimeType   string            `json:"runtimeType,omitempty" yaml:"runtimeType,omitempty"`
	RuntimeConfig RuntimeConfig     `json:"runtimeConfig,omitempty" yaml:"runtimeConfig,omitempty"`
}

type WorkflowReference struct {
	ID   string `json:"id,omitempty" yaml:"id,omitempty"`
	Name string `json:"name,omitempty" yaml:"name,omitempty"`
}

type RuntimeConfig map[string]json.RawMessage

type PoolSnapshot struct {
	Name            string `json:"name,omitempty" yaml:"name,omitempty"`
	Backend         string `json:"backend,omitempty" yaml:"backend,omitempty"`
	Platform        string `json:"platform,omitempty" yaml:"platform,omitempty"`
	Generation      string `json:"generation,omitempty" yaml:"generation,omitempty"`
	PodTemplateHash string `json:"podTemplateHash,omitempty" yaml:"podTemplateHash,omitempty"`
}

type SchedulerConfig struct {
	Type              string `json:"type,omitempty" yaml:"type,omitempty"`
	Queue             string `json:"queue,omitempty" yaml:"queue,omitempty"`
	PriorityClassName string `json:"priorityClassName,omitempty" yaml:"priorityClassName,omitempty"`
	SchedulerName     string `json:"schedulerName,omitempty" yaml:"schedulerName,omitempty"`
	MinMember         int32  `json:"minMember,omitempty" yaml:"minMember,omitempty"`
}

type KAIConfig struct {
	Queue             string                `json:"queue,omitempty" yaml:"queue,omitempty"`
	PriorityClassName string                `json:"priorityClassName,omitempty" yaml:"priorityClassName,omitempty"`
	MinMember         int32                 `json:"minMember,omitempty" yaml:"minMember,omitempty"`
	SchedulerName     string                `json:"schedulerName,omitempty" yaml:"schedulerName,omitempty"`
	PodTemplate       KAIPodTemplate        `json:"podTemplate,omitempty" yaml:"podTemplate,omitempty"`
	SubGroups         []KAITopologySubGroup `json:"subGroups,omitempty" yaml:"subGroups,omitempty"`
}

type KAIPodTemplate struct {
	Labels      map[string]string `json:"labels,omitempty" yaml:"labels,omitempty"`
	Annotations map[string]string `json:"annotations,omitempty" yaml:"annotations,omitempty"`
	Containers  []KAIContainer    `json:"containers,omitempty" yaml:"containers,omitempty"`
}

type KAIContainer struct {
	Name    string   `json:"name,omitempty" yaml:"name,omitempty"`
	Image   string   `json:"image,omitempty" yaml:"image,omitempty"`
	Command []string `json:"command,omitempty" yaml:"command,omitempty"`
	Args    []string `json:"args,omitempty" yaml:"args,omitempty"`
}

type KAITopologySubGroup struct {
	Name      string `json:"name,omitempty" yaml:"name,omitempty"`
	MinMember int32  `json:"minMember,omitempty" yaml:"minMember,omitempty"`
}

type OSMOContainerGroupConfig struct {
	Pool            PoolSnapshot           `json:"pool,omitempty" yaml:"pool,omitempty"`
	Scheduler       SchedulerConfig        `json:"scheduler,omitempty" yaml:"scheduler,omitempty"`
	RenderedObjects []runtime.RawExtension `json:"renderedObjects,omitempty" yaml:"renderedObjects,omitempty"`
	Tasks           []OSMOContainerTask    `json:"tasks,omitempty" yaml:"tasks,omitempty"`
	Barrier         bool                   `json:"barrier,omitempty" yaml:"barrier,omitempty"`
	IgnoreNonLead   bool                   `json:"ignoreNonleadStatus,omitempty" yaml:"ignoreNonleadStatus,omitempty"`
}

type OSMOContainerTask struct {
	Name    string `json:"name,omitempty" yaml:"name,omitempty"`
	PodName string `json:"podName,omitempty" yaml:"podName,omitempty"`
	Lead    bool   `json:"lead,omitempty" yaml:"lead,omitempty"`
}

type RayConfig struct {
	Mode             string           `json:"mode,omitempty" yaml:"mode,omitempty"`
	RayVersion       string           `json:"rayVersion,omitempty" yaml:"rayVersion,omitempty"`
	Scheduler        SchedulerConfig  `json:"scheduler,omitempty" yaml:"scheduler,omitempty"`
	Pool             PoolSnapshot     `json:"pool,omitempty" yaml:"pool,omitempty"`
	Head             RayNodeGroup     `json:"head,omitempty" yaml:"head,omitempty"`
	Workers          []RayWorkerGroup `json:"workers,omitempty" yaml:"workers,omitempty"`
	Job              *RayJobConfig    `json:"job,omitempty" yaml:"job,omitempty"`
	ShutdownAfterJob bool             `json:"shutdownAfterJob,omitempty" yaml:"shutdownAfterJob,omitempty"`
}

type RayNodeGroup struct {
	Image     string            `json:"image,omitempty" yaml:"image,omitempty"`
	Replicas  int32             `json:"replicas,omitempty" yaml:"replicas,omitempty"`
	Resources RayResources      `json:"resources,omitempty" yaml:"resources,omitempty"`
	Env       map[string]string `json:"env,omitempty" yaml:"env,omitempty"`
}

type RayWorkerGroup struct {
	Name         string `json:"name,omitempty" yaml:"name,omitempty"`
	Replicas     int32  `json:"replicas,omitempty" yaml:"replicas,omitempty"`
	MinReplicas  int32  `json:"minReplicas,omitempty" yaml:"minReplicas,omitempty"`
	MaxReplicas  int32  `json:"maxReplicas,omitempty" yaml:"maxReplicas,omitempty"`
	RayNodeGroup `json:",inline" yaml:",inline"`
}

type RayResources struct {
	CPU     string `json:"cpu,omitempty" yaml:"cpu,omitempty"`
	Memory  string `json:"memory,omitempty" yaml:"memory,omitempty"`
	GPU     string `json:"gpu,omitempty" yaml:"gpu,omitempty"`
	Storage string `json:"storage,omitempty" yaml:"storage,omitempty"`
}

type RayJobConfig struct {
	Entrypoint string            `json:"entrypoint,omitempty" yaml:"entrypoint,omitempty"`
	WorkingDir string            `json:"workingDir,omitempty" yaml:"workingDir,omitempty"`
	Env        map[string]string `json:"env,omitempty" yaml:"env,omitempty"`
}

type OSMOTaskGroupStatus struct {
	Phase              string                   `json:"phase,omitempty" yaml:"phase,omitempty"`
	Message            string                   `json:"message,omitempty" yaml:"message,omitempty"`
	ObservedGeneration int64                    `json:"observedGeneration,omitempty" yaml:"observedGeneration,omitempty"`
	LastReportTime     metav1.Time              `json:"lastReportTime,omitempty" yaml:"lastReportTime,omitempty"`
	PodSummary         PodSummary               `json:"podSummary,omitempty" yaml:"podSummary,omitempty"`
	Tasks              []TaskState              `json:"tasks,omitempty" yaml:"tasks,omitempty"`
	Barriers           map[string]BarrierStatus `json:"barriers,omitempty" yaml:"barriers,omitempty"`
	Conditions         []metav1.Condition       `json:"conditions,omitempty" yaml:"conditions,omitempty"`
	RuntimeStatus      RuntimeStatus            `json:"runtimeStatus,omitempty" yaml:"runtimeStatus,omitempty"`
}

type PodSummary struct {
	Pending   int32 `json:"pending,omitempty" yaml:"pending,omitempty"`
	Running   int32 `json:"running,omitempty" yaml:"running,omitempty"`
	Succeeded int32 `json:"succeeded,omitempty" yaml:"succeeded,omitempty"`
	Failed    int32 `json:"failed,omitempty" yaml:"failed,omitempty"`
	Unknown   int32 `json:"unknown,omitempty" yaml:"unknown,omitempty"`
}

type RuntimeStatus struct {
	PodNames []string          `json:"podNames,omitempty" yaml:"podNames,omitempty"`
	Ray      *RayRuntimeStatus `json:"ray,omitempty" yaml:"ray,omitempty"`
}

type TaskState struct {
	Name    string `json:"name,omitempty" yaml:"name,omitempty"`
	PodName string `json:"podName,omitempty" yaml:"podName,omitempty"`
	Phase   string `json:"phase,omitempty" yaml:"phase,omitempty"`
	Message string `json:"message,omitempty" yaml:"message,omitempty"`
	RetryID int32  `json:"retryID,omitempty" yaml:"retryID,omitempty"`
}

type BarrierStatus struct {
	Expected int32    `json:"expected,omitempty" yaml:"expected,omitempty"`
	Arrived  []string `json:"arrived,omitempty" yaml:"arrived,omitempty"`
	Released bool     `json:"released,omitempty" yaml:"released,omitempty"`
}

type RayRuntimeStatus struct {
	RayClusterName   string `json:"rayClusterName,omitempty" yaml:"rayClusterName,omitempty"`
	RayJobName       string `json:"rayJobName,omitempty" yaml:"rayJobName,omitempty"`
	JobStatus        string `json:"jobStatus,omitempty" yaml:"jobStatus,omitempty"`
	HeadReady        bool   `json:"headReady,omitempty" yaml:"headReady,omitempty"`
	WorkersDesired   int32  `json:"workersDesired,omitempty" yaml:"workersDesired,omitempty"`
	WorkersReady     int32  `json:"workersReady,omitempty" yaml:"workersReady,omitempty"`
	DashboardService string `json:"dashboardService,omitempty" yaml:"dashboardService,omitempty"`
	DashboardPort    int32  `json:"dashboardPort,omitempty" yaml:"dashboardPort,omitempty"`
}

type OSMOTaskGroup struct {
	metav1.TypeMeta   `json:",inline" yaml:",inline"`
	metav1.ObjectMeta `json:"metadata,omitempty" yaml:"metadata,omitempty"`
	Spec              OSMOTaskGroupSpec   `json:"spec,omitempty" yaml:"spec,omitempty"`
	Status            OSMOTaskGroupStatus `json:"status,omitempty" yaml:"status,omitempty"`
}

type OSMOTaskGroupList struct {
	metav1.TypeMeta `json:",inline" yaml:",inline"`
	metav1.ListMeta `json:"metadata,omitempty" yaml:"metadata,omitempty"`
	Items           []OSMOTaskGroup `json:"items" yaml:"items"`
}

func (in *OSMOTaskGroup) DeepCopyObject() runtime.Object {
	if in == nil {
		return nil
	}
	out := *in
	out.ObjectMeta = *in.ObjectMeta.DeepCopy()
	out.Spec.RuntimeConfig = in.Spec.RuntimeConfig.DeepCopy()
	out.Status.Conditions = append([]metav1.Condition(nil), in.Status.Conditions...)
	out.Status.RuntimeStatus.PodNames = append([]string(nil), in.Status.RuntimeStatus.PodNames...)
	out.Status.Tasks = append([]TaskState(nil), in.Status.Tasks...)
	if len(in.Status.Barriers) > 0 {
		out.Status.Barriers = make(map[string]BarrierStatus, len(in.Status.Barriers))
		for key, value := range in.Status.Barriers {
			value.Arrived = append([]string(nil), value.Arrived...)
			out.Status.Barriers[key] = value
		}
	}
	if in.Status.RuntimeStatus.Ray != nil {
		rayStatus := *in.Status.RuntimeStatus.Ray
		out.Status.RuntimeStatus.Ray = &rayStatus
	}
	return &out
}

func (in *OSMOTaskGroupList) DeepCopyObject() runtime.Object {
	if in == nil {
		return nil
	}
	out := *in
	out.ListMeta = in.ListMeta
	out.Items = make([]OSMOTaskGroup, len(in.Items))
	for i := range in.Items {
		out.Items[i] = *in.Items[i].DeepCopyObject().(*OSMOTaskGroup)
	}
	return &out
}

func (in *OSMOTaskGroup) EffectiveMode() string {
	if in.Spec.Mode == "" {
		return ModeShadow
	}
	return in.Spec.Mode
}

func (in *OSMOTaskGroup) EffectiveRuntimeType() string {
	if in.Spec.RuntimeType == "" {
		return RuntimeTypeKAI
	}
	return in.Spec.RuntimeType
}

func (in *OSMOTaskGroup) Validate() error {
	switch in.EffectiveMode() {
	case ModeActive, ModeShadow:
	default:
		return fmt.Errorf("unsupported mode %q", in.EffectiveMode())
	}
	if in.EffectiveRuntimeType() == "" {
		return fmt.Errorf("runtimeType is required")
	}
	return nil
}

func NewKAIConfig(config KAIConfig) RuntimeConfig {
	data, err := json.Marshal(config)
	if err != nil {
		panic(err)
	}
	return RuntimeConfig{RuntimeTypeKAI: data}
}

func NewOSMOContainerGroupConfig(config OSMOContainerGroupConfig) RuntimeConfig {
	data, err := json.Marshal(config)
	if err != nil {
		panic(err)
	}
	return RuntimeConfig{RuntimeTypeOSMOContainerGroup: data}
}

func NewRayConfig(config RayConfig) RuntimeConfig {
	data, err := json.Marshal(config)
	if err != nil {
		panic(err)
	}
	return RuntimeConfig{RuntimeTypeRay: data}
}

func (in RuntimeConfig) KAIConfig() (KAIConfig, error) {
	raw, ok := in[RuntimeTypeKAI]
	if !ok || len(raw) == 0 {
		return KAIConfig{}, fmt.Errorf("runtimeConfig.kai is required")
	}
	var config KAIConfig
	if err := json.Unmarshal(raw, &config); err != nil {
		return KAIConfig{}, fmt.Errorf("runtimeConfig.kai is invalid: %w", err)
	}
	return config, nil
}

func (in RuntimeConfig) OSMOContainerGroupConfig() (OSMOContainerGroupConfig, error) {
	raw, ok := in[RuntimeTypeOSMOContainerGroup]
	if !ok || len(raw) == 0 {
		return OSMOContainerGroupConfig{}, fmt.Errorf("runtimeConfig.%s is required", RuntimeTypeOSMOContainerGroup)
	}
	var config OSMOContainerGroupConfig
	if err := json.Unmarshal(raw, &config); err != nil {
		return OSMOContainerGroupConfig{}, fmt.Errorf("runtimeConfig.%s is invalid: %w", RuntimeTypeOSMOContainerGroup, err)
	}
	return config, nil
}

func (in RuntimeConfig) RayConfig() (RayConfig, error) {
	raw, ok := in[RuntimeTypeRay]
	if !ok || len(raw) == 0 {
		return RayConfig{}, fmt.Errorf("runtimeConfig.ray is required")
	}
	var config RayConfig
	if err := json.Unmarshal(raw, &config); err != nil {
		return RayConfig{}, fmt.Errorf("runtimeConfig.ray is invalid: %w", err)
	}
	return config, nil
}

func (in RuntimeConfig) DeepCopy() RuntimeConfig {
	if len(in) == 0 {
		return nil
	}
	out := make(RuntimeConfig, len(in))
	for key, value := range in {
		out[key] = append(json.RawMessage(nil), value...)
	}
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

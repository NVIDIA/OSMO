package proto

type OTG struct {
	Name         string    `json:"name" yaml:"name"`
	WorkflowID   string    `json:"workflow_id" yaml:"workflow_id"`
	WorkflowName string    `json:"workflow_name" yaml:"workflow_name"`
	GroupName    string    `json:"group_name" yaml:"group_name"`
	Mode         string    `json:"mode" yaml:"mode"`
	RuntimeType  string    `json:"runtime_type" yaml:"runtime_type"`
	KAI          KAIConfig `json:"kai" yaml:"kai"`
}

type KAIConfig struct {
	Queue             string                `json:"queue" yaml:"queue"`
	PriorityClassName string                `json:"priority_class_name" yaml:"priority_class_name"`
	MinMember         int32                 `json:"min_member" yaml:"min_member"`
	SchedulerName     string                `json:"scheduler_name" yaml:"scheduler_name"`
	Containers        []Container           `json:"containers" yaml:"containers"`
	SubGroups         []KAITopologySubGroup `json:"sub_groups" yaml:"sub_groups"`
	PodLabels         map[string]string     `json:"pod_labels" yaml:"pod_labels"`
	PodAnnotations    map[string]string     `json:"pod_annotations" yaml:"pod_annotations"`
}

type Container struct {
	Name    string   `json:"name" yaml:"name"`
	Image   string   `json:"image" yaml:"image"`
	Command []string `json:"command" yaml:"command"`
	Args    []string `json:"args" yaml:"args"`
}

type KAITopologySubGroup struct {
	Name      string `json:"name" yaml:"name"`
	MinMember int32  `json:"min_member" yaml:"min_member"`
}

type CreateOTGRequest struct {
	ClusterID string `json:"cluster_id" yaml:"cluster_id"`
	Namespace string `json:"namespace" yaml:"namespace"`
	OTG       OTG    `json:"otg" yaml:"otg"`
}

type DeleteOTGRequest struct {
	ClusterID string `json:"cluster_id" yaml:"cluster_id"`
	Namespace string `json:"namespace" yaml:"namespace"`
	Name      string `json:"name" yaml:"name"`
}

type GetOTGStatusRequest struct {
	ClusterID string `json:"cluster_id" yaml:"cluster_id"`
	Namespace string `json:"namespace" yaml:"namespace"`
	Name      string `json:"name" yaml:"name"`
}

type OTGStatus struct {
	ClusterID  string `json:"cluster_id" yaml:"cluster_id"`
	Namespace  string `json:"namespace" yaml:"namespace"`
	Name       string `json:"name" yaml:"name"`
	WorkflowID string `json:"workflow_id" yaml:"workflow_id"`
	GroupName  string `json:"group_name" yaml:"group_name"`
	Phase      string `json:"phase" yaml:"phase"`
	Message    string `json:"message" yaml:"message"`
}

type CommandResponse struct {
	CommandID string `json:"command_id" yaml:"command_id"`
	OK        bool   `json:"ok" yaml:"ok"`
	Error     string `json:"error,omitempty" yaml:"error,omitempty"`
}

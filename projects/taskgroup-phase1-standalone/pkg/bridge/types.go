package bridge

import taskgroupv1alpha1 "example.com/taskgroup-phase1-standalone/api/taskgroup/v1alpha1"

const (
	ActionCreateOTG = "create_otg"
	ActionDeleteOTG = "delete_otg"
)

type Command struct {
	ID        string                           `json:"id"`
	Action    string                           `json:"action"`
	ClusterID string                           `json:"clusterID"`
	Namespace string                           `json:"namespace"`
	Name      string                           `json:"name"`
	OTG       *taskgroupv1alpha1.OSMOTaskGroup `json:"otg,omitempty"`
}

type CommandResult struct {
	ID        string `json:"id"`
	ClusterID string `json:"clusterID"`
	OK        bool   `json:"ok"`
	Error     string `json:"error,omitempty"`
}

type StatusReport struct {
	ClusterID string                                `json:"clusterID"`
	Namespace string                                `json:"namespace"`
	Name      string                                `json:"name"`
	Deleted   bool                                  `json:"deleted,omitempty"`
	Status    taskgroupv1alpha1.OSMOTaskGroupStatus `json:"status"`
}

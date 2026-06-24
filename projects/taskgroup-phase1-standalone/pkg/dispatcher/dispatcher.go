package dispatcher

import (
	"context"
	"fmt"
	"reflect"
	"strings"
	"time"

	taskgroupv1alpha1 "example.com/taskgroup-phase1-standalone/api/taskgroup/v1alpha1"
	workflowv1alpha1 "example.com/taskgroup-phase1-standalone/api/workflow/v1alpha1"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"sigs.k8s.io/controller-runtime/pkg/builder"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/controller/controllerutil"
	"sigs.k8s.io/controller-runtime/pkg/manager"
	"sigs.k8s.io/controller-runtime/pkg/reconcile"
)

const WorkflowFinalizer = "workflow.osmo.nvidia.com/dispatch"
const workflowStatusRefreshInterval = 15 * time.Second
const otgStatusStaleAfter = 90 * time.Second

type OTGClient interface {
	CreateOTG(ctx context.Context, clusterID string, otg *taskgroupv1alpha1.OSMOTaskGroup) error
	DeleteOTG(ctx context.Context, clusterID string, namespace string, name string) error
	GetOTGStatus(ctx context.Context, clusterID string, namespace string, name string) (taskgroupv1alpha1.OSMOTaskGroupStatus, error)
}

type RuntimePlanner interface {
	Validate(ctx context.Context, workflow *workflowv1alpha1.Workflow, group workflowv1alpha1.WorkflowTaskGroup) error
	BuildOTG(ctx context.Context, workflow *workflowv1alpha1.Workflow, group workflowv1alpha1.WorkflowTaskGroup) (*taskgroupv1alpha1.OSMOTaskGroup, error)
}

type WorkflowReconciler struct {
	client.Client
	OTGs     OTGClient
	Planners map[string]RuntimePlanner
}

func NewWorkflowReconciler(kubeClient client.Client, otgClient OTGClient, planners map[string]RuntimePlanner) *WorkflowReconciler {
	return &WorkflowReconciler{Client: kubeClient, OTGs: otgClient, Planners: planners}
}

func (r *WorkflowReconciler) SetupWithManager(mgr manager.Manager) error {
	return builder.ControllerManagedBy(mgr).
		For(&workflowv1alpha1.Workflow{}).
		Complete(r)
}

func (r *WorkflowReconciler) Reconcile(ctx context.Context, request reconcile.Request) (reconcile.Result, error) {
	workflow := &workflowv1alpha1.Workflow{}
	if err := r.Get(ctx, request.NamespacedName, workflow); err != nil {
		return reconcile.Result{}, client.IgnoreNotFound(err)
	}
	if !workflow.DeletionTimestamp.IsZero() {
		return r.reconcileDelete(ctx, workflow)
	}
	if !controllerutil.ContainsFinalizer(workflow, WorkflowFinalizer) {
		controllerutil.AddFinalizer(workflow, WorkflowFinalizer)
		return reconcile.Result{}, r.Update(ctx, workflow)
	}
	if err := workflow.Validate(); err != nil {
		return reconcile.Result{RequeueAfter: workflowStatusRefreshInterval}, r.updateStatus(ctx, workflow, failureStatus(workflow, err.Error(), nil))
	}
	for _, group := range workflow.Spec.TaskGroups {
		planner, ok := r.Planners[workflow.EffectiveRuntimeType(group)]
		if !ok {
			message := fmt.Sprintf("unsupported runtimeType %q", workflow.EffectiveRuntimeType(group))
			return reconcile.Result{RequeueAfter: workflowStatusRefreshInterval}, r.updateStatus(ctx, workflow, failureStatus(workflow, message, nil))
		}
		if err := planner.Validate(ctx, workflow, group); err != nil {
			return reconcile.Result{RequeueAfter: workflowStatusRefreshInterval}, r.updateStatus(ctx, workflow, failureStatus(workflow, err.Error(), nil))
		}
	}
	status := workflowv1alpha1.WorkflowStatus{
		Phase:              workflowv1alpha1.WorkflowPhasePending,
		ObservedGeneration: workflow.Generation,
		Groups:             make([]workflowv1alpha1.WorkflowGroupStatus, 0, len(workflow.Spec.TaskGroups)),
	}
	groupStatuses := map[string]workflowv1alpha1.WorkflowGroupStatus{}
	builtOTGs := map[string]*taskgroupv1alpha1.OSMOTaskGroup{}
	for _, group := range workflow.Spec.TaskGroups {
		planner := r.Planners[workflow.EffectiveRuntimeType(group)]
		otg, err := planner.BuildOTG(ctx, workflow, group)
		if err != nil {
			return reconcile.Result{RequeueAfter: workflowStatusRefreshInterval}, r.updateStatus(ctx, workflow, failureStatus(workflow, err.Error(), status.Groups))
		}
		builtOTGs[group.Name] = otg
		otgStatus, err := r.OTGs.GetOTGStatus(ctx, workflow.Spec.ClusterID, otg.Namespace, otg.Name)
		if err != nil && !apierrors.IsNotFound(err) {
			return reconcile.Result{RequeueAfter: workflowStatusRefreshInterval}, err
		}
		groupStatus := workflowv1alpha1.WorkflowGroupStatus{
			Name:      group.Name,
			OTGName:   otg.Name,
			ClusterID: workflow.Spec.ClusterID,
			Namespace: otg.Namespace,
			Phase:     normalizeGroupPhase(otgStatus.Phase),
			Message:   otgStatus.Message,
		}
		if !otgStatus.LastReportTime.IsZero() {
			groupStatus.LastReportTime = otgStatus.LastReportTime
			if !isTerminalGroupPhase(groupStatus.Phase) && time.Since(otgStatus.LastReportTime.Time) > otgStatusStaleAfter {
				groupStatus.Message = fmt.Sprintf("OTG status report is stale; last report at %s", otgStatus.LastReportTime.Time.Format(time.RFC3339))
			}
		}
		if apierrors.IsNotFound(err) {
			groupStatus.Phase = workflowv1alpha1.WorkflowPhasePending
			groupStatus.Message = "OTG has been dispatched but no status is available yet"
		}
		groupStatuses[group.Name] = groupStatus
	}
	for _, group := range workflow.Spec.TaskGroups {
		groupStatus := groupStatuses[group.Name]
		if groupStatus.Phase != workflowv1alpha1.WorkflowPhasePending {
			continue
		}
		if dependencyFailed(group.DependsOn, groupStatuses) {
			groupStatus.Phase = workflowv1alpha1.WorkflowPhaseFailed
			groupStatus.Message = "Upstream dependency failed"
			groupStatuses[group.Name] = groupStatus
			continue
		}
		if !dependenciesSucceeded(group.DependsOn, groupStatuses) {
			groupStatus.Message = "Waiting for dependencies"
			groupStatuses[group.Name] = groupStatus
			continue
		}
		if err := r.OTGs.CreateOTG(ctx, workflow.Spec.ClusterID, builtOTGs[group.Name]); err != nil {
			groupStatus.Message = fmt.Sprintf("Dispatch pending: %v", err)
			groupStatuses[group.Name] = groupStatus
			continue
		}
		groupStatuses[group.Name] = groupStatus
	}
	for _, group := range workflow.Spec.TaskGroups {
		status.Groups = append(status.Groups, groupStatuses[group.Name])
	}
	status.Phase = aggregatePhase(status.Groups)
	status.Conditions = []metav1.Condition{{
		Type:               "Dispatched",
		Status:             metav1.ConditionTrue,
		ObservedGeneration: workflow.Generation,
		Reason:             "OTGDispatched",
		Message:            "Workflow task groups dispatched to compute cluster OTGs",
	}}
	return reconcile.Result{RequeueAfter: workflowStatusRefreshInterval}, r.updateStatus(ctx, workflow, status)
}

func (r *WorkflowReconciler) reconcileDelete(ctx context.Context, workflow *workflowv1alpha1.Workflow) (reconcile.Result, error) {
	allDeleted := true
	for _, group := range workflow.Spec.TaskGroups {
		planner, ok := r.Planners[workflow.EffectiveRuntimeType(group)]
		if !ok {
			continue
		}
		otg, err := planner.BuildOTG(ctx, workflow, group)
		if err != nil {
			continue
		}
		if err := r.OTGs.DeleteOTG(ctx, workflow.Spec.ClusterID, otg.Namespace, otg.Name); err != nil && !apierrors.IsNotFound(err) {
			return reconcile.Result{RequeueAfter: workflowStatusRefreshInterval}, err
		}
		if _, err := r.OTGs.GetOTGStatus(ctx, workflow.Spec.ClusterID, otg.Namespace, otg.Name); err == nil {
			allDeleted = false
		} else if !apierrors.IsNotFound(err) {
			return reconcile.Result{RequeueAfter: workflowStatusRefreshInterval}, err
		}
	}
	if !allDeleted {
		return reconcile.Result{RequeueAfter: workflowStatusRefreshInterval}, nil
	}
	if controllerutil.ContainsFinalizer(workflow, WorkflowFinalizer) {
		controllerutil.RemoveFinalizer(workflow, WorkflowFinalizer)
		return reconcile.Result{}, r.Update(ctx, workflow)
	}
	return reconcile.Result{}, nil
}

func dependenciesSucceeded(dependsOn []string, statuses map[string]workflowv1alpha1.WorkflowGroupStatus) bool {
	for _, dependency := range dependsOn {
		status, ok := statuses[dependency]
		if !ok || status.Phase != workflowv1alpha1.WorkflowPhaseSucceeded {
			return false
		}
	}
	return true
}

func dependencyFailed(dependsOn []string, statuses map[string]workflowv1alpha1.WorkflowGroupStatus) bool {
	for _, dependency := range dependsOn {
		if statuses[dependency].Phase == workflowv1alpha1.WorkflowPhaseFailed {
			return true
		}
	}
	return false
}

func (r *WorkflowReconciler) updateStatus(ctx context.Context, workflow *workflowv1alpha1.Workflow, status workflowv1alpha1.WorkflowStatus) error {
	if workflowStatusEqual(workflow.Status, status) {
		return nil
	}
	workflow.Status = status
	return r.Status().Update(ctx, workflow)
}

func failureStatus(workflow *workflowv1alpha1.Workflow, message string, groups []workflowv1alpha1.WorkflowGroupStatus) workflowv1alpha1.WorkflowStatus {
	return workflowv1alpha1.WorkflowStatus{
		Phase:              workflowv1alpha1.WorkflowPhaseFailed,
		Message:            message,
		ObservedGeneration: workflow.Generation,
		Groups:             groups,
		Conditions: []metav1.Condition{{
			Type:               "Dispatched",
			Status:             metav1.ConditionFalse,
			ObservedGeneration: workflow.Generation,
			Reason:             "DispatchFailed",
			Message:            message,
		}},
	}
}

func workflowStatusEqual(left, right workflowv1alpha1.WorkflowStatus) bool {
	left.Conditions = normalizeWorkflowConditions(left.Conditions)
	right.Conditions = normalizeWorkflowConditions(right.Conditions)
	return reflect.DeepEqual(left, right)
}

func normalizeWorkflowConditions(in []metav1.Condition) []metav1.Condition {
	out := append([]metav1.Condition(nil), in...)
	for i := range out {
		out[i].LastTransitionTime = metav1.Time{}
	}
	return out
}

func normalizeGroupPhase(phase string) string {
	switch phase {
	case workflowv1alpha1.WorkflowPhaseRunning, workflowv1alpha1.WorkflowPhaseSucceeded, workflowv1alpha1.WorkflowPhaseFailed:
		return phase
	case "":
		return workflowv1alpha1.WorkflowPhasePending
	default:
		return phase
	}
}

func aggregatePhase(groups []workflowv1alpha1.WorkflowGroupStatus) string {
	if len(groups) == 0 {
		return workflowv1alpha1.WorkflowPhasePending
	}
	allSucceeded := true
	anyRunning := false
	for _, group := range groups {
		switch group.Phase {
		case workflowv1alpha1.WorkflowPhaseFailed:
			return workflowv1alpha1.WorkflowPhaseFailed
		case workflowv1alpha1.WorkflowPhaseSucceeded:
		case workflowv1alpha1.WorkflowPhaseRunning:
			allSucceeded = false
			anyRunning = true
		default:
			allSucceeded = false
		}
	}
	if allSucceeded {
		return workflowv1alpha1.WorkflowPhaseSucceeded
	}
	if anyRunning {
		return workflowv1alpha1.WorkflowPhaseRunning
	}
	return workflowv1alpha1.WorkflowPhasePending
}

func isTerminalGroupPhase(phase string) bool {
	return phase == workflowv1alpha1.WorkflowPhaseSucceeded || phase == workflowv1alpha1.WorkflowPhaseFailed
}

func OTGName(workflowName, groupName string) string {
	name := strings.ToLower(workflowName + "-" + groupName)
	name = strings.ReplaceAll(name, "_", "-")
	name = strings.ReplaceAll(name, ".", "-")
	return name
}

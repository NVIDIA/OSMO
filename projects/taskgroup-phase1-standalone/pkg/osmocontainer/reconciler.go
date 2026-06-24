package osmocontainer

import (
	"context"
	"encoding/json"
	"fmt"

	taskgroupv1alpha1 "example.com/taskgroup-phase1-standalone/api/taskgroup/v1alpha1"
	"example.com/taskgroup-phase1-standalone/pkg/runtimeobject"

	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
)

type Reconciler struct {
	client client.Client
}

func NewReconciler(kubeClient client.Client) *Reconciler {
	return &Reconciler{client: kubeClient}
}

func (r *Reconciler) Validate(_ context.Context, otg *taskgroupv1alpha1.OSMOTaskGroup) error {
	config, err := otg.Spec.RuntimeConfig.OSMOContainerGroupConfig()
	if err != nil {
		return err
	}
	if len(config.RenderedObjects) == 0 {
		return fmt.Errorf("runtimeConfig.%s.renderedObjects requires at least one object", taskgroupv1alpha1.RuntimeTypeOSMOContainerGroup)
	}
	if len(config.Tasks) == 0 {
		return fmt.Errorf("runtimeConfig.%s.tasks requires at least one task", taskgroupv1alpha1.RuntimeTypeOSMOContainerGroup)
	}
	return nil
}

func (r *Reconciler) ReconcileRuntime(ctx context.Context, otg *taskgroupv1alpha1.OSMOTaskGroup) error {
	config, err := otg.Spec.RuntimeConfig.OSMOContainerGroupConfig()
	if err != nil {
		return err
	}
	objects, err := decodeObjects(config.RenderedObjects)
	if err != nil {
		return err
	}
	if otg.EffectiveMode() == taskgroupv1alpha1.ModeShadow {
		return nil
	}
	for i := range objects {
		object := objects[i]
		if err := runtimeobject.Reconcile(ctx, r.client, otg, &object); err != nil {
			return err
		}
	}
	return nil
}

func (r *Reconciler) MapStatus(ctx context.Context, otg *taskgroupv1alpha1.OSMOTaskGroup) (taskgroupv1alpha1.OSMOTaskGroupStatus, error) {
	config, err := otg.Spec.RuntimeConfig.OSMOContainerGroupConfig()
	if err != nil {
		return taskgroupv1alpha1.OSMOTaskGroupStatus{}, err
	}
	summary := taskgroupv1alpha1.PodSummary{}
	tasks := make([]taskgroupv1alpha1.TaskState, 0, len(config.Tasks))
	podNames := make([]string, 0, len(config.Tasks))
	phase := "Pending"
	allSucceeded := len(config.Tasks) > 0
	anyRunning := false
	anyFailed := false
	for _, task := range config.Tasks {
		podName := task.PodName
		if podName == "" {
			podName = fmt.Sprintf("%s-%s", otg.Name, task.Name)
		}
		podNames = append(podNames, podName)
		taskPhase, message, err := r.podPhase(ctx, otg.Namespace, podName)
		if err != nil {
			return taskgroupv1alpha1.OSMOTaskGroupStatus{}, err
		}
		switch taskPhase {
		case "Running":
			summary.Running++
			anyRunning = true
			allSucceeded = false
		case "Succeeded":
			summary.Succeeded++
		case "Failed":
			summary.Failed++
			anyFailed = true
			allSucceeded = false
		case "Unknown":
			summary.Unknown++
			allSucceeded = false
		default:
			summary.Pending++
			allSucceeded = false
		}
		tasks = append(tasks, taskgroupv1alpha1.TaskState{
			Name:    task.Name,
			PodName: podName,
			Phase:   taskPhase,
			Message: message,
		})
	}
	switch {
	case anyFailed:
		phase = "Failed"
	case allSucceeded:
		phase = "Succeeded"
	case anyRunning:
		phase = "Running"
	}
	return taskgroupv1alpha1.OSMOTaskGroupStatus{
		Phase:      phase,
		PodSummary: summary,
		Tasks:      tasks,
		RuntimeStatus: taskgroupv1alpha1.RuntimeStatus{
			PodNames: podNames,
		},
		Conditions: []metav1.Condition{{
			Type:               "Reconciled",
			Status:             metav1.ConditionTrue,
			ObservedGeneration: otg.Generation,
			Reason:             "OSMOContainerGroupStatusMapped",
			Message:            "OSMO container group status mapped from rendered Pods",
		}},
	}, nil
}

func (r *Reconciler) podPhase(ctx context.Context, namespace string, podName string) (string, string, error) {
	pod := &corev1.Pod{}
	err := r.client.Get(ctx, client.ObjectKey{Namespace: namespace, Name: podName}, pod)
	if apierrors.IsNotFound(err) {
		return "Pending", "Pod has not been created yet", nil
	}
	if err != nil {
		return "", "", err
	}
	switch pod.Status.Phase {
	case corev1.PodRunning:
		return "Running", "", nil
	case corev1.PodSucceeded:
		return "Succeeded", "", nil
	case corev1.PodFailed:
		return "Failed", pod.Status.Message, nil
	case corev1.PodPending:
		return "Pending", pod.Status.Message, nil
	default:
		return "Unknown", pod.Status.Message, nil
	}
}

func decodeObjects(rawObjects []runtime.RawExtension) ([]unstructured.Unstructured, error) {
	objects := make([]unstructured.Unstructured, 0, len(rawObjects))
	for i, rawObject := range rawObjects {
		data := rawObject.Raw
		if len(data) == 0 && rawObject.Object != nil {
			var err error
			data, err = json.Marshal(rawObject.Object)
			if err != nil {
				return nil, fmt.Errorf("renderedObjects[%d] marshal object: %w", i, err)
			}
		}
		if len(data) == 0 {
			return nil, fmt.Errorf("renderedObjects[%d] is empty", i)
		}
		var object map[string]any
		if err := json.Unmarshal(data, &object); err != nil {
			return nil, fmt.Errorf("renderedObjects[%d] decode: %w", i, err)
		}
		objects = append(objects, unstructured.Unstructured{Object: object})
	}
	return objects, nil
}

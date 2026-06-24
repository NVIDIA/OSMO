package kai

import (
	"context"
	"fmt"

	taskgroupv1alpha1 "example.com/taskgroup-phase1-standalone/api/taskgroup/v1alpha1"
	"example.com/taskgroup-phase1-standalone/pkg/runtimeobject"

	corev1 "k8s.io/api/core/v1"
	schedulingv1 "k8s.io/api/scheduling/v1"
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
	config, err := otg.Spec.RuntimeConfig.KAIConfig()
	if err != nil {
		return err
	}
	if len(config.PodTemplate.Containers) == 0 {
		return fmt.Errorf("runtimeConfig.kai.podTemplate.containers is required")
	}
	for _, container := range config.PodTemplate.Containers {
		if container.Name == "" || container.Image == "" {
			return fmt.Errorf("each KAI container requires name and image")
		}
	}
	return nil
}

func (r *Reconciler) ReconcileRuntime(ctx context.Context, otg *taskgroupv1alpha1.OSMOTaskGroup) error {
	if otg.EffectiveMode() == taskgroupv1alpha1.ModeShadow {
		_, err := Render(otg)
		return err
	}
	objects, err := Render(otg)
	if err != nil {
		return err
	}
	config, err := otg.Spec.RuntimeConfig.KAIConfig()
	if err != nil {
		return err
	}
	if config.PriorityClassName != "" {
		priorityClass := &schedulingv1.PriorityClass{}
		if err := r.client.Get(ctx, client.ObjectKey{Name: config.PriorityClassName}, priorityClass); err != nil {
			if apierrors.IsNotFound(err) {
				return fmt.Errorf("PriorityClass %q must already exist in the compute cluster", config.PriorityClassName)
			}
			return err
		}
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
	pod := &corev1.Pod{}
	podName := PodName(otg)
	err := r.client.Get(ctx, client.ObjectKey{Namespace: otg.Namespace, Name: podName}, pod)
	if err != nil && !apierrors.IsNotFound(err) {
		return taskgroupv1alpha1.OSMOTaskGroupStatus{}, err
	}
	summary := taskgroupv1alpha1.PodSummary{}
	phase := "Pending"
	podNames := []string{podName}
	if apierrors.IsNotFound(err) {
		summary.Pending = 1
	} else {
		switch pod.Status.Phase {
		case corev1.PodRunning:
			summary.Running = 1
			phase = "Running"
		case corev1.PodSucceeded:
			summary.Succeeded = 1
			phase = "Succeeded"
		case corev1.PodFailed:
			summary.Failed = 1
			phase = "Failed"
		case corev1.PodPending:
			summary.Pending = 1
		default:
			summary.Unknown = 1
			phase = "Unknown"
		}
	}
	return taskgroupv1alpha1.OSMOTaskGroupStatus{
		Phase:      phase,
		PodSummary: summary,
		RuntimeStatus: taskgroupv1alpha1.RuntimeStatus{
			PodNames: podNames,
		},
		Conditions: []metav1.Condition{
			{
				Type:               "Reconciled",
				Status:             metav1.ConditionTrue,
				ObservedGeneration: otg.Generation,
				Reason:             "KAIStatusMapped",
				Message:            "KAI runtime status mapped from Pods",
			},
		},
	}, nil
}

func toUnstructured(obj runtime.Object) (unstructured.Unstructured, error) {
	data, err := runtime.DefaultUnstructuredConverter.ToUnstructured(obj)
	if err != nil {
		return unstructured.Unstructured{}, err
	}
	return unstructured.Unstructured{Object: data}, nil
}

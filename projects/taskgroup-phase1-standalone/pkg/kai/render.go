package kai

import (
	"fmt"

	taskgroupv1alpha1 "example.com/taskgroup-phase1-standalone/api/taskgroup/v1alpha1"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
)

func Render(otg *taskgroupv1alpha1.OSMOTaskGroup) ([]unstructured.Unstructured, error) {
	config, err := otg.Spec.RuntimeConfig.KAIConfig()
	if err != nil {
		return nil, err
	}
	if len(config.PodTemplate.Containers) == 0 {
		return nil, fmt.Errorf("runtimeConfig.kai.podTemplate.containers is required")
	}
	podGroup, err := renderPodGroup(otg)
	if err != nil {
		return nil, err
	}
	pod, err := renderPod(otg)
	if err != nil {
		return nil, err
	}
	return []unstructured.Unstructured{podGroup, pod}, nil
}

func PodName(otg *taskgroupv1alpha1.OSMOTaskGroup) string {
	return otg.Name + "-pod"
}

func renderPodGroup(otg *taskgroupv1alpha1.OSMOTaskGroup) (unstructured.Unstructured, error) {
	config, err := otg.Spec.RuntimeConfig.KAIConfig()
	if err != nil {
		return unstructured.Unstructured{}, err
	}
	minMember := int64(config.MinMember)
	if minMember == 0 {
		minMember = 1
	}
	object := map[string]any{
		"apiVersion": "scheduling.run.ai/v2alpha2",
		"kind":       "PodGroup",
		"metadata": map[string]any{
			"name":      otg.Name,
			"namespace": otg.Namespace,
			"labels": map[string]any{
				"kai.scheduler/queue": config.Queue,
				"runai/queue":         config.Queue,
			},
		},
		"spec": map[string]any{
			"queue":     config.Queue,
			"minMember": minMember,
		},
	}
	spec := object["spec"].(map[string]any)
	if config.PriorityClassName != "" {
		spec["priorityClassName"] = config.PriorityClassName
	}
	if len(config.SubGroups) > 0 {
		subGroups := make([]any, 0, len(config.SubGroups))
		for _, subgroup := range config.SubGroups {
			subGroups = append(subGroups, map[string]any{
				"name":      subgroup.Name,
				"minMember": subgroup.MinMember,
			})
		}
		spec["subGroups"] = subGroups
	}
	return unstructured.Unstructured{Object: object}, nil
}

func renderPod(otg *taskgroupv1alpha1.OSMOTaskGroup) (unstructured.Unstructured, error) {
	config, err := otg.Spec.RuntimeConfig.KAIConfig()
	if err != nil {
		return unstructured.Unstructured{}, err
	}
	containers := make([]corev1.Container, 0, len(config.PodTemplate.Containers))
	for _, container := range config.PodTemplate.Containers {
		containers = append(containers, corev1.Container{
			Name:    container.Name,
			Image:   container.Image,
			Command: container.Command,
			Args:    container.Args,
		})
	}
	labels := copyMap(config.PodTemplate.Labels)
	labels["kai.scheduler/queue"] = config.Queue
	labels["runai/queue"] = config.Queue
	annotations := copyMap(config.PodTemplate.Annotations)
	annotations["pod-group-name"] = otg.Name
	pod := &corev1.Pod{
		TypeMeta: metav1.TypeMeta{APIVersion: "v1", Kind: "Pod"},
		ObjectMeta: metav1.ObjectMeta{
			Name:        PodName(otg),
			Namespace:   otg.Namespace,
			Labels:      labels,
			Annotations: annotations,
		},
		Spec: corev1.PodSpec{
			SchedulerName: config.SchedulerName,
			RestartPolicy: corev1.RestartPolicyNever,
			Containers:    containers,
		},
	}
	if config.PriorityClassName != "" {
		pod.Spec.PriorityClassName = config.PriorityClassName
	}
	return toUnstructured(pod)
}

func copyMap(input map[string]string) map[string]string {
	output := map[string]string{}
	for key, value := range input {
		output[key] = value
	}
	return output
}

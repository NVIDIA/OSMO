// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// SPDX-License-Identifier: Apache-2.0

package taskgroup

import (
	"encoding/json"
	"fmt"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"

	taskgroupv1alpha1 "go.corp.nvidia.com/osmo/apis/taskgroup/v1alpha1"
)

type RuntimeConfig struct {
	KAI               KAIConfig        `json:"kai,omitempty"`
	Resources         []map[string]any `json:"resources,omitempty"`
	ExpectedResources []map[string]any `json:"expectedResources,omitempty"`
}

type KAIConfig struct {
	Resources     []map[string]any   `json:"resources,omitempty"`
	Group         KAIGroupConfig     `json:"group,omitempty"`
	PodTemplates  []KAIPodTemplate   `json:"podTemplates,omitempty"`
	PodGroup      map[string]any     `json:"podGroup,omitempty"`
	Pods          []map[string]any   `json:"pods,omitempty"`
	ResourceOrder []KAIResourceOrder `json:"resourceOrder,omitempty"`
}

type KAIGroupConfig struct {
	Name              string           `json:"name,omitempty"`
	Labels            map[string]any   `json:"labels,omitempty"`
	Annotations       map[string]any   `json:"annotations,omitempty"`
	Queue             string           `json:"queue,omitempty"`
	MinMember         int64            `json:"minMember,omitempty"`
	PriorityClassName string           `json:"priorityClassName,omitempty"`
	SubGroups         []map[string]any `json:"subGroups,omitempty"`
}

type KAIPodTemplate struct {
	Name        string         `json:"name,omitempty"`
	Labels      map[string]any `json:"labels,omitempty"`
	Annotations map[string]any `json:"annotations,omitempty"`
	Spec        map[string]any `json:"spec,omitempty"`
}

type KAIResourceOrder struct {
	APIVersion string `json:"apiVersion"`
	Kind       string `json:"kind"`
	Name       string `json:"name"`
	Scope      string `json:"scope,omitempty"`
	Source     string `json:"source"`
}

const (
	ResourceScopeNamespaced = "Namespaced"
	ResourceScopeCluster    = "Cluster"
)

var allowedKAIResourceScopes = map[string]string{
	resourceKey("v1", "ConfigMap", ""):                        ResourceScopeNamespaced,
	resourceKey("v1", "Secret", ""):                           ResourceScopeNamespaced,
	resourceKey("v1", "Service", ""):                          ResourceScopeNamespaced,
	resourceKey("v1", "Pod", ""):                              ResourceScopeNamespaced,
	resourceKey("scheduling.run.ai/v2alpha2", "PodGroup", ""): ResourceScopeNamespaced,
	resourceKey("scheduling.k8s.io/v1", "PriorityClass", ""):  ResourceScopeCluster,
}

func DecodeRuntimeConfig(otg *taskgroupv1alpha1.OSMOTaskGroup) ([]unstructured.Unstructured, error) {
	config, err := decodeRuntimeConfig(otg)
	if err != nil {
		return nil, err
	}
	return renderKAIObjects(config)
}

func decodeRuntimeConfig(otg *taskgroupv1alpha1.OSMOTaskGroup) (RuntimeConfig, error) {
	if len(otg.Spec.RuntimeConfig.Raw) == 0 {
		return RuntimeConfig{}, fmt.Errorf("runtimeConfig is empty")
	}
	config := RuntimeConfig{}
	if err := json.Unmarshal(otg.Spec.RuntimeConfig.Raw, &config); err != nil {
		return RuntimeConfig{}, fmt.Errorf("decode runtimeConfig: %w", err)
	}
	return config, nil
}

func renderKAIObjects(config RuntimeConfig) ([]unstructured.Unstructured, error) {
	if len(config.KAI.Resources) == 0 && len(config.KAI.PodTemplates) == 0 &&
		config.KAI.Group.Name == "" && len(config.KAI.Pods) == 0 && len(config.KAI.PodGroup) == 0 {
		if len(config.Resources) > 0 {
			return nil, fmt.Errorf("top-level runtimeConfig.resources is not supported for KAI")
		}
		return []unstructured.Unstructured{}, nil
	}

	objectsByKey := map[string]unstructured.Unstructured{}
	addObject := func(resource map[string]any) error {
		objects, err := runtimeObjects([]map[string]any{resource})
		if err != nil {
			return err
		}
		objectsByKey[objectKey(objects[0])] = objects[0]
		return nil
	}

	for _, resource := range config.KAI.Resources {
		if err := addObject(resource); err != nil {
			return nil, err
		}
	}
	if config.KAI.Group.Name != "" {
		if err := addObject(renderKAIGroup(config.KAI.Group)); err != nil {
			return nil, err
		}
	} else if len(config.KAI.PodGroup) > 0 {
		if err := addObject(renderKAIPodGroup(config.KAI.PodGroup)); err != nil {
			return nil, err
		}
	}
	queue := ""
	groupName := ""
	if config.KAI.Group.Name != "" {
		groupName = config.KAI.Group.Name
		queue = config.KAI.Group.Queue
	} else if len(config.KAI.PodGroup) > 0 {
		podGroup := unstructured.Unstructured{Object: renderKAIPodGroup(config.KAI.PodGroup)}
		groupName = podGroup.GetName()
		queue, _, _ = unstructured.NestedString(podGroup.Object, "spec", "queue")
	}
	for _, podTemplate := range config.KAI.PodTemplates {
		if err := addObject(renderKAIPodTemplate(podTemplate, groupName, queue)); err != nil {
			return nil, err
		}
	}
	for _, pod := range config.KAI.Pods {
		if err := addObject(renderKAIPod(pod, groupName, queue)); err != nil {
			return nil, err
		}
	}

	if len(config.KAI.ResourceOrder) == 0 {
		objects := make([]unstructured.Unstructured, 0, len(objectsByKey))
		for _, object := range objectsByKey {
			if _, err := kaiResourceScope(config, object); err != nil {
				return nil, err
			}
			objects = append(objects, object)
		}
		return objects, nil
	}

	objects := make([]unstructured.Unstructured, 0, len(config.KAI.ResourceOrder))
	for _, entry := range config.KAI.ResourceOrder {
		object, ok := objectsByKey[resourceKey(entry.APIVersion, entry.Kind, entry.Name)]
		if !ok {
			return nil, fmt.Errorf("rendered KAI resource missing from order: %s/%s %s",
				entry.APIVersion, entry.Kind, entry.Name)
		}
		if _, err := kaiResourceScope(config, object); err != nil {
			return nil, err
		}
		objects = append(objects, object)
	}
	return objects, nil
}

func renderKAIGroup(group KAIGroupConfig) map[string]any {
	metadata := map[string]any{
		"name":        group.Name,
		"labels":      copyMap(group.Labels),
		"annotations": copyMap(group.Annotations),
	}
	labels := nestedMap(metadata, "labels")
	if group.Queue != "" {
		labels["kai.scheduler/queue"] = group.Queue
		labels["runai/queue"] = group.Queue
	}
	spec := map[string]any{}
	if group.Queue != "" {
		spec["queue"] = group.Queue
	}
	if group.MinMember > 0 {
		spec["minMember"] = group.MinMember
	}
	if group.PriorityClassName != "" {
		spec["priorityClassName"] = group.PriorityClassName
	}
	if len(group.SubGroups) > 0 {
		spec["subGroups"] = copyList(group.SubGroups)
	}
	return map[string]any{
		"apiVersion": "scheduling.run.ai/v2alpha2",
		"kind":       "PodGroup",
		"metadata":   metadata,
		"spec":       spec,
	}
}

func renderKAIPodGroup(podGroup map[string]any) map[string]any {
	rendered := copyMap(podGroup)
	rendered["apiVersion"] = "scheduling.run.ai/v2alpha2"
	rendered["kind"] = "PodGroup"
	if _, ok := rendered["metadata"]; !ok {
		rendered["metadata"] = map[string]any{}
	}
	if _, ok := rendered["spec"]; !ok {
		rendered["spec"] = map[string]any{}
	}
	return rendered
}

func renderKAIPodTemplate(podTemplate KAIPodTemplate, groupName string, queue string) map[string]any {
	rendered := map[string]any{
		"apiVersion": "v1",
		"kind":       "Pod",
		"metadata": map[string]any{
			"name":        podTemplate.Name,
			"labels":      copyMap(podTemplate.Labels),
			"annotations": copyMap(podTemplate.Annotations),
		},
		"spec": copyMap(podTemplate.Spec),
	}
	return renderKAIPod(rendered, groupName, queue)
}

func renderKAIPod(pod map[string]any, groupName string, queue string) map[string]any {
	rendered := copyMap(pod)
	rendered["apiVersion"] = "v1"
	rendered["kind"] = "Pod"
	metadata := nestedMap(rendered, "metadata")
	annotations := nestedMap(metadata, "annotations")
	if groupName != "" {
		annotations["pod-group-name"] = groupName
	}
	labels := nestedMap(metadata, "labels")
	if queue != "" {
		labels["kai.scheduler/queue"] = queue
		labels["runai/queue"] = queue
	}
	if _, ok := rendered["spec"]; !ok {
		rendered["spec"] = map[string]any{}
	}
	return rendered
}

func copyList(input []map[string]any) []map[string]any {
	data, err := json.Marshal(input)
	if err != nil {
		return []map[string]any{}
	}
	output := []map[string]any{}
	if err := json.Unmarshal(data, &output); err != nil {
		return []map[string]any{}
	}
	return output
}

func nestedMap(parent map[string]any, key string) map[string]any {
	value, ok := parent[key]
	if !ok {
		result := map[string]any{}
		parent[key] = result
		return result
	}
	if result, ok := value.(map[string]any); ok && result != nil {
		return result
	}
	result := map[string]any{}
	parent[key] = result
	return result
}

func copyMap(input map[string]any) map[string]any {
	data, err := json.Marshal(input)
	if err != nil {
		return map[string]any{}
	}
	output := map[string]any{}
	if err := json.Unmarshal(data, &output); err != nil {
		return map[string]any{}
	}
	return output
}

func objectKey(object unstructured.Unstructured) string {
	return resourceKey(object.GetAPIVersion(), object.GetKind(), object.GetName())
}

func resourceKey(apiVersion string, kind string, name string) string {
	return apiVersion + "|" + kind + "|" + name
}

func kaiResourceScope(config RuntimeConfig, object unstructured.Unstructured) (string, error) {
	key := resourceKey(object.GetAPIVersion(), object.GetKind(), "")
	allowedScope, ok := allowedKAIResourceScopes[key]
	if !ok {
		return "", fmt.Errorf("unsupported KAI resource %s/%s",
			object.GetAPIVersion(), object.GetKind())
	}
	configScope := ""
	for _, entry := range config.KAI.ResourceOrder {
		if entry.APIVersion == object.GetAPIVersion() &&
			entry.Kind == object.GetKind() &&
			entry.Name == object.GetName() {
			configScope = entry.Scope
			break
		}
	}
	if configScope == "" {
		return allowedScope, nil
	}
	if configScope != ResourceScopeNamespaced && configScope != ResourceScopeCluster {
		return "", fmt.Errorf("unsupported KAI resource scope %q for %s/%s %s",
			configScope, object.GetAPIVersion(), object.GetKind(), object.GetName())
	}
	if configScope != allowedScope {
		return "", fmt.Errorf("KAI resource scope %q does not match allowed scope %q for %s/%s %s",
			configScope, allowedScope, object.GetAPIVersion(), object.GetKind(), object.GetName())
	}
	return configScope, nil
}

func runtimeObjects(resources []map[string]any) ([]unstructured.Unstructured, error) {
	objects := make([]unstructured.Unstructured, 0, len(resources))
	for _, resource := range resources {
		object := unstructured.Unstructured{Object: resource}
		if object.GetKind() == "" || object.GetAPIVersion() == "" {
			return nil, fmt.Errorf("resource must include apiVersion and kind")
		}
		if object.GetName() == "" {
			return nil, fmt.Errorf("%s/%s resource must include metadata.name",
				object.GetAPIVersion(), object.GetKind())
		}
		objects = append(objects, object)
	}
	return objects, nil
}

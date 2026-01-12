/*
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

SPDX-License-Identifier: Apache-2.0
*/

package utils

import (
	"context"
	"fmt"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
)

// Task status strings
const (
	StatusScheduling      = "SCHEDULING"
	StatusInitializing    = "INITIALIZING"
	StatusRunning         = "RUNNING"
	StatusCompleted       = "COMPLETED"
	StatusFailed          = "FAILED"
	StatusFailedPreempted = "FAILED_PREEMPTED"
)

// Exit codes
const (
	ExitCodeNotSet          = -1   // No exit code available
	ExitCodeFailedPreempted = 3006 // StatusFailedPreempted
)

// checkPreemptionByScheduler checks if the pod was preempted by the scheduler
func checkPreemptionByScheduler(pod *corev1.Pod) (bool, string) {
	for _, cond := range pod.Status.Conditions {
		if cond.Status == corev1.ConditionTrue && cond.Reason == "PreemptionByScheduler" {
			return true, fmt.Sprintf("Pod was preempted at %s. ", cond.LastTransitionTime.String())
		}
	}
	return false, ""
}

// PodStatusResult contains the comprehensive status information
type PodStatusResult struct {
	Status   string
	Message  string
	ExitCode int32
}

// CalculatePodStatus calculates the comprehensive pod status
func CalculatePodStatus(pod *corev1.Pod) PodStatusResult {
	// Check for preemption
	isPreempted, message := checkPreemptionByScheduler(pod)
	if isPreempted {
		return PodStatusResult{
			Status:   StatusFailedPreempted,
			Message:  message,
			ExitCode: ExitCodeFailedPreempted,
		}
	}

	// Base status mapping from Kubernetes pod phases to task status
	statusMap := map[corev1.PodPhase]string{
		corev1.PodPending:   StatusScheduling,
		corev1.PodRunning:   StatusRunning,
		corev1.PodSucceeded: StatusCompleted,
		corev1.PodFailed:    StatusFailed,
	}

	status := statusMap[pod.Status.Phase] // status can be ""

	return PodStatusResult{
		Status:   status,
		Message:  pod.Status.Message,
		ExitCode: int32(ExitCodeNotSet),
	}
}

// CreateKubernetesClient creates a Kubernetes clientset using
// in-cluster or kubeconfig
func CreateKubernetesClient() (*kubernetes.Clientset, error) {
	// Try in-cluster config first
	config, err := rest.InClusterConfig()
	if err != nil {
		// Fall back to kubeconfig
		loadingRules := clientcmd.NewDefaultClientConfigLoadingRules()
		configOverrides := &clientcmd.ConfigOverrides{}
		kubeConfig := clientcmd.NewNonInteractiveDeferredLoadingClientConfig(
			loadingRules, configOverrides,
		)
		config, err = kubeConfig.ClientConfig()
		if err != nil {
			return nil, fmt.Errorf(
				"failed to load kubernetes config: %w",
				err,
			)
		}
	}

	clientset, err := kubernetes.NewForConfig(config)
	if err != nil {
		return nil, fmt.Errorf(
			"failed to create kubernetes clientset: %w",
			err,
		)
	}

	return clientset, nil
}

// GetKubeSystemUID retrieves the UID of the kube-system namespace
func GetKubeSystemUID() (string, error) {
	clientset, err := CreateKubernetesClient()
	if err != nil {
		return "", fmt.Errorf("failed to create kubernetes client: %w", err)
	}

	namespace, err := clientset.CoreV1().Namespaces().Get(
		context.Background(),
		"kube-system",
		metav1.GetOptions{},
	)
	if err != nil {
		return "", fmt.Errorf("failed to get kube-system namespace: %w", err)
	}

	return string(namespace.UID), nil
}

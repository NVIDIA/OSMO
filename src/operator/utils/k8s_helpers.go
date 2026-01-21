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

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
)

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

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

package operator

import (
	"context"
	"encoding/json"
	"fmt"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/yaml"

	taskgroupv1alpha1 "go.corp.nvidia.com/osmo/apis/taskgroup/v1alpha1"
	pb "go.corp.nvidia.com/osmo/proto/operator"
)

type Server struct {
	pb.UnimplementedOperatorServiceServer
	client client.Client
}

func NewServer(client client.Client) *Server {
	return &Server{client: client}
}

func NewKubernetesClient(kubeconfig string, scheme *runtime.Scheme) (client.Client, error) {
	config, err := BuildKubernetesConfig(kubeconfig)
	if err != nil {
		return nil, err
	}
	return client.New(config, client.Options{Scheme: scheme})
}

func BuildKubernetesConfig(kubeconfig string) (*rest.Config, error) {
	if kubeconfig != "" {
		return clientcmd.BuildConfigFromFlags("", kubeconfig)
	}
	return rest.InClusterConfig()
}

func (s *Server) CreateOTG(
	ctx context.Context,
	request *CreateOTGRequest,
) (*CreateOTGResponse, error) {
	otg, err := parseOTGYAML(request)
	if err != nil {
		return nil, err
	}
	if err := s.client.Create(ctx, otg); err != nil {
		if apierrors.IsAlreadyExists(err) {
			return &CreateOTGResponse{Created: false}, nil
		}
		return nil, err
	}
	return &CreateOTGResponse{Created: true}, nil
}

func (s *Server) DeleteOTG(
	ctx context.Context,
	request *DeleteOTGRequest,
) (*DeleteOTGResponse, error) {
	otg := &taskgroupv1alpha1.OSMOTaskGroup{}
	otg.Namespace = request.GetNamespace()
	otg.Name = request.GetName()
	if err := s.client.Delete(ctx, otg); err != nil {
		if apierrors.IsNotFound(err) {
			return &DeleteOTGResponse{Deleted: false}, nil
		}
		return nil, err
	}
	return &DeleteOTGResponse{Deleted: true}, nil
}

func (s *Server) GetOTGStatus(
	ctx context.Context,
	request *GetOTGStatusRequest,
) (*GetOTGStatusResponse, error) {
	otg := &taskgroupv1alpha1.OSMOTaskGroup{}
	if err := s.client.Get(ctx, types.NamespacedName{
		Namespace: request.GetNamespace(),
		Name:      request.GetName(),
	}, otg); err != nil {
		return nil, err
	}
	statusBytes, err := json.Marshal(otg.Status)
	if err != nil {
		return nil, err
	}
	return &GetOTGStatusResponse{
		Phase:      string(otg.Status.Phase),
		StatusJson: string(statusBytes),
	}, nil
}

func parseOTGYAML(request *CreateOTGRequest) (*taskgroupv1alpha1.OSMOTaskGroup, error) {
	if request.GetName() == "" {
		return nil, fmt.Errorf("name is required")
	}
	if request.GetNamespace() == "" {
		return nil, fmt.Errorf("namespace is required")
	}
	if request.GetOtgYaml() == "" {
		return nil, fmt.Errorf("otg_yaml is required")
	}
	otg := &taskgroupv1alpha1.OSMOTaskGroup{}
	if err := yaml.Unmarshal([]byte(request.GetOtgYaml()), otg); err != nil {
		return nil, fmt.Errorf("decode otg yaml: %w", err)
	}
	otg.APIVersion = taskgroupv1alpha1.GroupVersion.String()
	otg.Kind = "OSMOTaskGroup"
	otg.Namespace = request.GetNamespace()
	otg.Name = request.GetName()
	return otg, nil
}

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
	"context"
	"io"
	"log/slog"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/client-go/kubernetes"

	taskgroupv1alpha1 "go.corp.nvidia.com/osmo/apis/taskgroup/v1alpha1"
)

const defaultLogTailLines = int64(10000)

type KubernetesLogCollector struct {
	clientset kubernetes.Interface
	tailLines int64
}

func NewKubernetesLogCollector(clientset kubernetes.Interface) *KubernetesLogCollector {
	return &KubernetesLogCollector{
		clientset: clientset,
		tailLines: defaultLogTailLines,
	}
}

func (c *KubernetesLogCollector) CollectPodLogs(
	ctx context.Context,
	otg *taskgroupv1alpha1.OSMOTaskGroup,
	pods []corev1.Pod,
) error {
	for _, pod := range pods {
		request := c.clientset.CoreV1().Pods(pod.Namespace).GetLogs(
			pod.Name,
			&corev1.PodLogOptions{TailLines: &c.tailLines},
		)
		stream, err := request.Stream(ctx)
		if err != nil {
			slog.WarnContext(ctx, "failed to collect pod logs",
				slog.String("otg", otg.Name),
				slog.String("pod", pod.Name),
				slog.String("error", err.Error()))
			continue
		}
		logBytes, readErr := io.ReadAll(stream)
		closeErr := stream.Close()
		if readErr != nil {
			slog.WarnContext(ctx, "failed to read pod logs",
				slog.String("otg", otg.Name),
				slog.String("pod", pod.Name),
				slog.String("error", readErr.Error()))
			continue
		}
		if closeErr != nil {
			slog.WarnContext(ctx, "failed to close pod log stream",
				slog.String("otg", otg.Name),
				slog.String("pod", pod.Name),
				slog.String("error", closeErr.Error()))
		}
		slog.InfoContext(ctx, "collected pod logs",
			slog.String("otg", otg.Name),
			slog.String("pod", pod.Name),
			slog.String("logs", string(logBytes)))
	}
	return nil
}

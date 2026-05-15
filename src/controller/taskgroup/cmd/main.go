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

package main

import (
	"flag"
	"log/slog"
	"os"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/runtime"
	utilruntime "k8s.io/apimachinery/pkg/util/runtime"
	"k8s.io/client-go/kubernetes"
	clientgoscheme "k8s.io/client-go/kubernetes/scheme"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/healthz"
	metricsserver "sigs.k8s.io/controller-runtime/pkg/metrics/server"

	taskgroupv1alpha1 "go.corp.nvidia.com/osmo/apis/taskgroup/v1alpha1"
	taskgroupcontroller "go.corp.nvidia.com/osmo/controller/taskgroup"
)

var (
	metricsAddr          = flag.String("metrics-bind-address", ":8080", "metrics bind address")
	probeAddr            = flag.String("health-probe-bind-address", ":8081", "health probe bind address")
	enableLeaderElection = flag.Bool("leader-elect", false, "enable leader election")
)

func main() {
	flag.Parse()
	scheme := runtime.NewScheme()
	utilruntime.Must(clientgoscheme.AddToScheme(scheme))
	utilruntime.Must(corev1.AddToScheme(scheme))
	utilruntime.Must(taskgroupv1alpha1.AddToScheme(scheme))

	config := ctrl.GetConfigOrDie()
	manager, err := ctrl.NewManager(config, ctrl.Options{
		Scheme:                 scheme,
		Metrics:                metricsserver.Options{BindAddress: *metricsAddr},
		HealthProbeBindAddress: *probeAddr,
		LeaderElection:         *enableLeaderElection,
		LeaderElectionID:       "taskgroup-controller.workflow.osmo.nvidia.com",
	})
	if err != nil {
		slog.Error("failed to create manager", slog.String("error", err.Error()))
		os.Exit(1)
	}

	clientset, err := kubernetes.NewForConfig(config)
	if err != nil {
		slog.Error("failed to create kubernetes clientset", slog.String("error", err.Error()))
		os.Exit(1)
	}
	reconciler := taskgroupcontroller.NewTaskGroupReconciler(manager.GetClient(), manager.GetScheme())
	reconciler.LogCollector = taskgroupcontroller.NewKubernetesLogCollector(clientset)
	if err := ctrl.NewControllerManagedBy(manager).
		For(&taskgroupv1alpha1.OSMOTaskGroup{}).
		Complete(reconciler); err != nil {
		slog.Error("failed to create controller", slog.String("error", err.Error()))
		os.Exit(1)
	}
	if err := manager.AddHealthzCheck("healthz", healthz.Ping); err != nil {
		slog.Error("failed to add health check", slog.String("error", err.Error()))
		os.Exit(1)
	}
	if err := manager.AddReadyzCheck("readyz", healthz.Ping); err != nil {
		slog.Error("failed to add ready check", slog.String("error", err.Error()))
		os.Exit(1)
	}
	if err := manager.Start(ctrl.SetupSignalHandler()); err != nil {
		slog.Error("controller stopped", slog.String("error", err.Error()))
		os.Exit(1)
	}
}

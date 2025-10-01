/*
SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

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

package metrics

import (
	"encoding/json"
	"time"

	"go.corp.nvidia.com/osmo/pkg/osmo_errors"
)

type IOType string

const (
	Metrics IOType = "METRICS"
)

type GroupMetrics struct {
	RetryId    string `json:"retry_id"`
	StartTime  string `json:"start_time"`
	EndTime    string `json:"end_time"`
	MetricType string `json:"type_of_metrics"`
}

type TaskIOMetrics struct {
	RetryId       string `json:"retry_id"`
	GroupName     string `json:"group_name"`
	TaskName      string `json:"task_name"`
	URL           string `json:"url"`
	Type          string `json:"type"`
	StartTime     string `json:"start_time"`
	EndTime       string `json:"end_time"`
	SizeInBytes   int64  `json:"size_in_bytes"`
	NumberOfFiles int    `json:"number_of_files"`
	OperationType string `json:"operation_type"`
	DownloadType  string `json:"download_type"`
}

type Metric interface {
	getMetricType() string
}

func (f GroupMetrics) getMetricType() string  { return "group_metrics" }
func (f TaskIOMetrics) getMetricType() string { return "task_io_metrics" }

type MetricsRequest struct {
	Source     string
	Time       time.Time
	Metric     Metric
	IOType     IOType
	MetricType string
}

func CreateMetrics(source string, metric Metric, ioType IOType) string {
	currTime := time.Now().UTC()
	metricsRequest := MetricsRequest{source, currTime, metric, ioType, metric.getMetricType()}
	metricsJson, err := json.Marshal(metricsRequest)
	if err != nil {
		osmo_errors.SetExitCode(osmo_errors.METRICS_FAILED_CODE)
		panic(err)
	}
	return string(metricsJson)
}

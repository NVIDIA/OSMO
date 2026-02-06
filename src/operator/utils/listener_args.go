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
	"flag"

	sharedutils "go.corp.nvidia.com/osmo/utils"
	"go.corp.nvidia.com/osmo/utils/metrics"
)

// ListenerArgs holds configuration for all listeners
type ListenerArgs struct {
	ServiceURL            string
	Backend               string
	Namespace             string
	PodUpdateChanSize     int
	NodeUpdateChanSize    int // Buffer size for node update channel (ResourceListener)
	UsageChanSize         int // Buffer size for usage update channel (ResourceListener)
	EventChanSize         int // Buffer size for event channel (EventListener)
	ResyncPeriodSec       int
	StateCacheTTLMin      int
	EventCacheTTLMin      int // TTL in minutes for event deduplication (EventListener)
	MaxUnackedMessages    int
	NodeConditionPrefix   string
	ProgressDir           string
	ProgressFrequencySec  int
	UsageFlushIntervalSec int // Interval for flushing resource usage updates (ResourceListener)

	// OpenTelemetry metrics configuration
	Metrics metrics.MetricsConfig
}

// ListenerParse parses command line arguments and environment variables
func ListenerParse() ListenerArgs {
	serviceURL := flag.String("serviceURL",
		sharedutils.GetEnv("OSMO_SERVICE_URL", "http://127.0.0.1:8001"),
		"The osmo service url to connect to.")
	backend := flag.String("backend",
		sharedutils.GetEnv("BACKEND", "default"),
		"The backend to connect to.")
	namespace := flag.String("namespace",
		sharedutils.GetEnv("OSMO_NAMESPACE", "osmo"),
		"Kubernetes namespace to watch")
	podUpdateChanSize := flag.Int("podUpdateChanSize",
		sharedutils.GetEnvInt("POD_UPDATE_CHAN_SIZE", 500),
		"Buffer size for pod update channel (WorkflowListener)")
	nodeUpdateChanSize := flag.Int("nodeUpdateChanSize",
		sharedutils.GetEnvInt("NODE_UPDATE_CHAN_SIZE", 500),
		"Buffer size for node update channel (ResourceListener)")
	usageChanSize := flag.Int("usageChanSize",
		sharedutils.GetEnvInt("USAGE_CHAN_SIZE", 500),
		"Buffer size for usage update channel (ResourceListener)")
	eventChanSize := flag.Int("eventChanSize",
		sharedutils.GetEnvInt("EVENT_CHAN_SIZE", 500),
		"Buffer size for event channel (EventListener)")
	resyncPeriodSec := flag.Int("resyncPeriodSec",
		sharedutils.GetEnvInt("RESYNC_PERIOD_SEC", 300),
		"Resync period in seconds for Kubernetes informer")
	stateCacheTTLMin := flag.Int("stateCacheTTLMin",
		sharedutils.GetEnvInt("STATE_CACHE_TTL_MIN", 15),
		"TTL in minutes for state cache entries (WorkflowListener)")
	eventCacheTTLMin := flag.Int("eventCacheTTLMin",
		sharedutils.GetEnvInt("EVENT_CACHE_TTL_MIN", 15),
		"TTL in minutes for event deduplication (EventListener)")
	maxUnackedMessages := flag.Int("maxUnackedMessages",
		sharedutils.GetEnvInt("MAX_UNACKED_MESSAGES", 100),
		"Maximum number of unacked messages allowed")
	nodeConditionPrefix := flag.String("nodeConditionPrefix",
		sharedutils.GetEnv("NODE_CONDITION_PREFIX", "osmo.nvidia.com/"),
		"Prefix for node conditions")
	progressDir := flag.String("progressDir",
		sharedutils.GetEnv("OSMO_PROGRESS_DIR", "/tmp/osmo/operator/"),
		"The directory to write progress timestamps to (For liveness/startup probes)")
	progressFrequencySec := flag.Int("progressFrequencySec",
		sharedutils.GetEnvInt("OSMO_PROGRESS_FREQUENCY_SEC", 15),
		"Progress frequency in seconds (for periodic progress reporting when idle)")
	usageFlushIntervalSec := flag.Int("usageFlushIntervalSec",
		sharedutils.GetEnvInt("USAGE_FLUSH_INTERVAL_SEC", 60),
		"Interval for flushing resource usage updates (ResourceListener)")

	// OpenTelemetry metrics configuration
	metricsFlagPtrs := metrics.RegisterMetricsFlags("osmo-operator")

	flag.Parse()

	return ListenerArgs{
		ServiceURL:            *serviceURL,
		Backend:               *backend,
		Namespace:             *namespace,
		PodUpdateChanSize:     *podUpdateChanSize,
		NodeUpdateChanSize:    *nodeUpdateChanSize,
		UsageChanSize:         *usageChanSize,
		EventChanSize:         *eventChanSize,
		ResyncPeriodSec:       *resyncPeriodSec,
		StateCacheTTLMin:      *stateCacheTTLMin,
		EventCacheTTLMin:      *eventCacheTTLMin,
		MaxUnackedMessages:    *maxUnackedMessages,
		NodeConditionPrefix:   *nodeConditionPrefix,
		ProgressDir:           *progressDir,
		ProgressFrequencySec:  *progressFrequencySec,
		UsageFlushIntervalSec: *usageFlushIntervalSec,
		Metrics:               metricsFlagPtrs.ToMetricsConfig(),
	}
}

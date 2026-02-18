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
	"os"
	"strconv"
)

// ListenerArgs holds configuration for all listeners
type ListenerArgs struct {
	ServiceURL            string
	Backend               string
	Namespace             string
	PodUpdateChanSize     int
	NodeUpdateChanSize    int // Buffer size for node update channel
	UsageChanSize         int // Buffer size for usage update channel
	EventChanSize         int // Buffer size for event channel
	ResyncPeriodSec       int
	StateCacheTTLMin      int
	EventCacheTTLMin      int // TTL in minutes for event deduplication
	MaxUnackedMessages    int
	NodeConditionPrefix   string
	EnableNodeLabelUpdate bool // Enable updating node verified label based on availability
	LabelUpdateChanSize   int  // Buffer size for label update channel
	ProgressDir           string
	ProgressFrequencySec  int
	UsageFlushIntervalSec int // Interval for flushing resource usage updates (NodeUsageListener)
}

// ListenerParse parses command line arguments and environment variables
func ListenerParse() ListenerArgs {
	serviceURL := flag.String("serviceURL",
		getEnv("OSMO_SERVICE_URL", "http://127.0.0.1:8001"),
		"The osmo service url to connect to.")
	backend := flag.String("backend",
		getEnv("BACKEND", "default"),
		"The backend to connect to.")
	namespace := flag.String("namespace",
		getEnv("OSMO_NAMESPACE", "osmo"),
		"Kubernetes namespace to watch")
	podUpdateChanSize := flag.Int("podUpdateChanSize",
		getEnvInt("POD_UPDATE_CHAN_SIZE", 500),
		"Buffer size for pod update channel")
	nodeUpdateChanSize := flag.Int("nodeUpdateChanSize",
		getEnvInt("NODE_UPDATE_CHAN_SIZE", 500),
		"Buffer size for node update channel")
	usageChanSize := flag.Int("usageChanSize",
		getEnvInt("USAGE_CHAN_SIZE", 500),
		"Buffer size for usage update channel")
	eventChanSize := flag.Int("eventChanSize",
		getEnvInt("EVENT_CHAN_SIZE", 500),
		"Buffer size for event channel (EventListener)")
	resyncPeriodSec := flag.Int("resyncPeriodSec",
		getEnvInt("RESYNC_PERIOD_SEC", 300),
		"Resync period in seconds for Kubernetes informer")
	stateCacheTTLMin := flag.Int("stateCacheTTLMin",
		getEnvInt("STATE_CACHE_TTL_MIN", 15),
		"TTL in minutes for state cache entries (WorkflowListener)")
	eventCacheTTLMin := flag.Int("eventCacheTTLMin",
		getEnvInt("EVENT_CACHE_TTL_MIN", 15),
		"TTL in minutes for event deduplication (EventListener)")
	maxUnackedMessages := flag.Int("maxUnackedMessages",
		getEnvInt("MAX_UNACKED_MESSAGES", 100),
		"Maximum number of unacked messages allowed")
	nodeConditionPrefix := flag.String("nodeConditionPrefix",
		getEnv("NODE_CONDITION_PREFIX", "osmo.nvidia.com/"),
		"Prefix for node conditions")
	enableNodeLabelUpdate := flag.Bool("enableNodeLabelUpdate",
		getEnvBool("ENABLE_NODE_LABEL_UPDATE", false),
		"Enable updating the node_condition_prefix/verified node label based on node availability")
	labelUpdateChanSize := flag.Int("labelUpdateChanSize",
		getEnvInt("LABEL_UPDATE_CHAN_SIZE", 200),
		"Buffer size for label update channel")
	progressDir := flag.String("progressDir",
		getEnv("OSMO_PROGRESS_DIR", "/tmp/osmo/operator/"),
		"The directory to write progress timestamps to (For liveness/startup probes)")
	progressFrequencySec := flag.Int("progressFrequencySec",
		getEnvInt("OSMO_PROGRESS_FREQUENCY_SEC", 15),
		"Progress frequency in seconds (for periodic progress reporting when idle)")
	usageFlushIntervalSec := flag.Int("usageFlushIntervalSec",
		getEnvInt("USAGE_FLUSH_INTERVAL_SEC", 60),
		"Interval for flushing resource usage updates (NodeUsageListener)")

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
		EnableNodeLabelUpdate: *enableNodeLabelUpdate,
		LabelUpdateChanSize:   *labelUpdateChanSize,
		ProgressDir:           *progressDir,
		ProgressFrequencySec:  *progressFrequencySec,
		UsageFlushIntervalSec: *usageFlushIntervalSec,
	}
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func getEnvInt(key string, defaultValue int) int {
	if value := os.Getenv(key); value != "" {
		if intValue, err := strconv.Atoi(value); err == nil {
			return intValue
		}
	}
	return defaultValue
}

func getEnvBool(key string, defaultValue bool) bool {
	if value := os.Getenv(key); value != "" {
		if boolValue, err := strconv.ParseBool(value); err == nil {
			return boolValue
		}
	}
	return defaultValue
}

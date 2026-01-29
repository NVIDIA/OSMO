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

// ListenerArgs holds configuration for the workflow listener
type ListenerArgs struct {
	ServiceURL           string
	Backend              string
	Namespace            string
	PodUpdateChanSize    int
	ResyncPeriodSec      int
	StateCacheTTLMin     int
	MaxUnackedMessages   int
	NodeConditionPrefix  string
	ProgressDir          string
	ProgressFrequencySec int
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
	resyncPeriodSec := flag.Int("resyncPeriodSec",
		getEnvInt("RESYNC_PERIOD_SEC", 300),
		"Resync period in seconds for Kubernetes informer")
	stateCacheTTLMin := flag.Int("stateCacheTTLMin",
		getEnvInt("STATE_CACHE_TTL_MIN", 15),
		"TTL in minutes for state cache entries")
	maxUnackedMessages := flag.Int("maxUnackedMessages",
		getEnvInt("MAX_UNACKED_MESSAGES", 100),
		"Maximum number of unacked messages allowed")
	nodeConditionPrefix := flag.String("nodeConditionPrefix",
		getEnv("NODE_CONDITION_PREFIX", "osmo.nvidia.com/"),
		"Prefix for node conditions")
	progressDir := flag.String("progressDir",
		getEnv("OSMO_PROGRESS_DIR", "/tmp/osmo/compute_connector/"),
		"The directory to write progress timestamps to (For liveness/startup probes)")
	progressFrequencySec := flag.Int("progressFrequencySec",
		getEnvInt("OSMO_PROGRESS_FREQUENCY_SEC", 15),
		"Progress frequency in seconds (for periodic progress reporting when idle)")

	flag.Parse()

	return ListenerArgs{
		ServiceURL:           *serviceURL,
		Backend:              *backend,
		Namespace:            *namespace,
		PodUpdateChanSize:    *podUpdateChanSize,
		ResyncPeriodSec:      *resyncPeriodSec,
		StateCacheTTLMin:     *stateCacheTTLMin,
		MaxUnackedMessages:   *maxUnackedMessages,
		NodeConditionPrefix:  *nodeConditionPrefix,
		ProgressDir:          *progressDir,
		ProgressFrequencySec: *progressFrequencySec,
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

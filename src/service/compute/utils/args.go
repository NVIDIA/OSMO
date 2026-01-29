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

	"go.corp.nvidia.com/osmo/utils/postgres"
	"go.corp.nvidia.com/osmo/utils/redis"
)

// Args holds configuration for the service
type Args struct {
	// Service configuration
	Host                 string
	ServiceHostname      string
	LogLevel             string
	ProgressDir          string
	ProgressFrequencySec int

	Redis    redis.RedisConfig
	Postgres postgres.PostgresConfig
}

// Parse parses command line arguments and environment variables
func Parse() Args {
	// Service configuration
	host := flag.String("host",
		"http://0.0.0.0:8001",
		"Host for the service")
	serviceHostname := flag.String("service-hostname",
		"",
		"The public hostname for the OSMO service (used for URL generation)")
	logLevel := flag.String("log-level",
		"INFO",
		"Logging level (DEBUG, INFO, WARN, ERROR)")
	progressDir := flag.String("progress-dir",
		"/tmp/osmo/service/compute/",
		"The directory to write progress timestamps to (For liveness/startup probes)")
	progressFrequencySec := flag.Int("progress-frequency-sec",
		15,
		"Progress frequency in seconds (for periodic progress reporting when idle)")

	// Redis configuration
	redisFlagPtrs := redis.RegisterRedisFlags()

	// PostgreSQL configuration
	postgresFlagPtrs := postgres.RegisterPostgresFlags()

	flag.Parse()

	return Args{
		Host:                 *host,
		ServiceHostname:      *serviceHostname,
		LogLevel:             *logLevel,
		ProgressDir:          *progressDir,
		ProgressFrequencySec: *progressFrequencySec,
		Redis:                redisFlagPtrs.ToRedisConfig(),
		Postgres:             postgresFlagPtrs.ToPostgresConfig(),
	}
}

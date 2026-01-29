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

// OperatorArgs holds configuration for the operator service
type OperatorArgs struct {
	// Service configuration
	Host                         string
	ServiceHostname              string
	LogLevel                     string
	OperatorProgressDir          string
	OperatorProgressFrequencySec int

	Redis    redis.RedisConfig
	Postgres postgres.PostgresConfig
}

// OperatorParse parses command line arguments and environment variables
func OperatorParse() OperatorArgs {
	// Service configuration
	host := flag.String("host",
		"http://0.0.0.0:8001",
		"Host for the operator service")
	serviceHostname := flag.String("service-hostname",
		"",
		"The public hostname for the OSMO service (used for URL generation)")
	logLevel := flag.String("log-level",
		"INFO",
		"Logging level (DEBUG, INFO, WARN, ERROR)")
	operatorProgressDir := flag.String("operator-progress-dir",
		"/tmp/osmo/service/operator/",
		"The directory to write progress timestamps to (For liveness/startup probes)")
	operatorProgressFrequencySec := flag.Int("operator-progress-frequency-sec",
		15,
		"Progress frequency in seconds (for periodic progress reporting when idle)")

	// Redis configuration
	redisFlagPtrs := redis.RegisterRedisFlags()

	// PostgreSQL configuration
	postgresFlagPtrs := postgres.RegisterPostgresFlags()

	flag.Parse()

	return OperatorArgs{
		Host:                         *host,
		ServiceHostname:              *serviceHostname,
		LogLevel:                     *logLevel,
		OperatorProgressDir:          *operatorProgressDir,
		OperatorProgressFrequencySec: *operatorProgressFrequencySec,
		Redis:                        redisFlagPtrs.ToRedisConfig(),
		Postgres:                     postgresFlagPtrs.ToPostgresConfig(),
	}
}

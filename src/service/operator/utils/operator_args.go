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

	"go.corp.nvidia.com/osmo/utils/postgres"
)

// OperatorArgs holds configuration for the operator service
type OperatorArgs struct {
	// Service configuration
	Host                         string
	ServiceHostname              string
	LogLevel                     string
	OperatorProgressDir          string
	OperatorProgressFrequencySec int

	// Redis configuration
	RedisHost       string
	RedisPort       int
	RedisPassword   string
	RedisDB         int
	RedisTLSEnabled bool

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
		getEnv("OSMO_OPERATOR_PROGRESS_DIR", "/tmp/osmo/service/operator/"),
		"The directory to write progress timestamps to (For liveness/startup probes)")
	operatorProgressFrequencySec := flag.Int("operator-progress-frequency-sec",
		getEnvInt("OSMO_OPERATOR_PROGRESS_FREQUENCY_SEC", 15),
		"Progress frequency in seconds (for periodic progress reporting when idle)")

	// Redis configuration
	redisHost := flag.String("redis-host",
		getEnv("OSMO_REDIS_HOST", "localhost"),
		"Redis host")
	redisPort := flag.Int("redis-port",
		getEnvInt("OSMO_REDIS_PORT", 6379),
		"Redis port")
	redisPassword := flag.String("redis-password",
		getEnv("OSMO_REDIS_PASSWORD", ""),
		"Redis password")
	redisDB := flag.Int("redis-db-number",
		getEnvInt("OSMO_REDIS_DB_NUMBER", 0),
		"Redis database number to connect to. Default value is 0")
	redisTLSEnabled := flag.Bool("redis-tls-enable",
		getEnvBool("OSMO_REDIS_TLS_ENABLE", false),
		"Enable TLS for Redis connection")

	// PostgreSQL configuration
	postgresFlagPtrs := postgres.RegisterPostgresFlags()

	flag.Parse()

	return OperatorArgs{
		Host:                         *host,
		ServiceHostname:              *serviceHostname,
		LogLevel:                     *logLevel,
		OperatorProgressDir:          *operatorProgressDir,
		OperatorProgressFrequencySec: *operatorProgressFrequencySec,
		RedisHost:                    *redisHost,
		RedisPort:                    *redisPort,
		RedisPassword:                *redisPassword,
		RedisDB:                      *redisDB,
		RedisTLSEnabled:              *redisTLSEnabled,
		Postgres:                     postgresFlagPtrs.ToPostgresConfig(),
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

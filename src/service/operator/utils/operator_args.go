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

// OperatorArgs holds configuration for the operator service
type OperatorArgs struct {
	// Service configuration
	Host            string
	ServiceHostname string
	LogLevel        string

	// Redis configuration
	RedisHost     string
	RedisPort     int
	RedisPassword string
	RedisDB       int

	// PostgreSQL configuration
	PostgresHost   string
	PostgresPort   int
	PostgresUser   string
	PostgresPass   string
	PostgresDBName string
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

	// PostgreSQL configuration
	postgresHost := flag.String("postgres-host",
		getEnv("OSMO_POSTGRES_HOST", "localhost"),
		"PostgreSQL host")
	postgresPort := flag.Int("postgres-port",
		getEnvInt("OSMO_POSTGRES_PORT", 5432),
		"PostgreSQL port")
	postgresUser := flag.String("postgres-user",
		getEnv("OSMO_POSTGRES_USER", "postgres"),
		"PostgreSQL user")
	postgresPass := flag.String("postgres-password",
		getEnv("OSMO_POSTGRES_PASSWORD", ""),
		"PostgreSQL password")
	postgresDBName := flag.String("postgres-database",
		getEnv("OSMO_POSTGRES_DATABASE_NAME", "osmo_db"),
		"PostgreSQL database name")

	flag.Parse()

	return OperatorArgs{
		Host:            *host,
		ServiceHostname: *serviceHostname,
		LogLevel:        *logLevel,
		RedisHost:       *redisHost,
		RedisPort:       *redisPort,
		RedisPassword:   *redisPassword,
		RedisDB:         *redisDB,
		PostgresHost:    *postgresHost,
		PostgresPort:    *postgresPort,
		PostgresUser:    *postgresUser,
		PostgresPass:    *postgresPass,
		PostgresDBName:  *postgresDBName,
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

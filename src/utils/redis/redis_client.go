/*
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

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

package redis

import (
	"context"
	"crypto/tls"
	"flag"
	"fmt"
	"log/slog"
	"time"

	"github.com/redis/go-redis/v9"
	"go.corp.nvidia.com/osmo/utils"
)

// RedisConfig holds Redis connection configuration
type RedisConfig struct {
	Host       string
	Port       int
	Password   string
	DB         int
	TLSEnabled bool
}

// RedisClient handles Redis operations
type RedisClient struct {
	client *redis.Client
	logger *slog.Logger
}

// NewRedisClient creates a new Redis client
func NewRedisClient(ctx context.Context, config RedisConfig, logger *slog.Logger) (*RedisClient, error) {
	redisOptions := &redis.Options{
		Addr:     fmt.Sprintf("%s:%d", config.Host, config.Port),
		Password: config.Password,
		DB:       config.DB,
	}

	// Enable TLS if configured
	if config.TLSEnabled {
		redisOptions.TLSConfig = &tls.Config{
			MinVersion: tls.VersionTLS12,
		}
	}

	client := redis.NewClient(redisOptions)

	// Ping to verify connection
	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	if err := client.Ping(pingCtx).Err(); err != nil {
		client.Close()
		return nil, fmt.Errorf("failed to ping Redis: %w", err)
	}

	logger.Info("Redis client connected successfully",
		slog.String("address", fmt.Sprintf("%s:%d", config.Host, config.Port)),
		slog.Int("db", config.DB),
		slog.Bool("tls", config.TLSEnabled),
	)

	return &RedisClient{
		client: client,
		logger: logger,
	}, nil
}

// Close closes the Redis connection
func (c *RedisClient) Close() error {
	c.logger.Info("closing redis client")
	return c.client.Close()
}

// Client returns the underlying redis.Client for direct access
func (c *RedisClient) Client() *redis.Client {
	return c.client
}

// Ping verifies the Redis connection is still alive
func (c *RedisClient) Ping(ctx context.Context) error {
	return c.client.Ping(ctx).Err()
}

// CreateClient creates a Redis client from RedisConfig
func (config *RedisConfig) CreateClient(logger *slog.Logger) (*RedisClient, error) {
	return NewRedisClient(context.Background(), *config, logger)
}

// RedisFlagPointers holds pointers to flag values for Redis configuration
type RedisFlagPointers struct {
	host       *string
	port       *int
	password   *string
	db         *int
	tlsEnabled *bool
}

// RegisterRedisFlags registers Redis-related command-line flags
// Returns a RedisFlagPointers that should be converted to RedisConfig
// after flag.Parse() is called
func RegisterRedisFlags() *RedisFlagPointers {
	return &RedisFlagPointers{
		host: flag.String("redis-host",
			utils.GetEnv("OSMO_REDIS_HOST", "localhost"),
			"Redis host"),
		port: flag.Int("redis-port",
			utils.GetEnvInt("OSMO_REDIS_PORT", 6379),
			"Redis port"),
		password: flag.String("redis-password",
			utils.GetEnvOrConfig("OSMO_REDIS_PASSWORD", "redis_password", ""),
			"Redis password"),
		db: flag.Int("redis-db-number",
			utils.GetEnvInt("OSMO_REDIS_DB_NUMBER", 0),
			"Redis database number to connect to. Default value is 0"),
		tlsEnabled: flag.Bool("redis-tls-enable",
			utils.GetEnvBool("OSMO_REDIS_TLS_ENABLE", false),
			"Enable TLS for Redis connection"),
	}
}

// ToRedisConfig converts flag pointers to RedisConfig
// This should be called after flag.Parse()
func (r *RedisFlagPointers) ToRedisConfig() RedisConfig {
	return RedisConfig{
		Host:       *r.host,
		Port:       *r.port,
		Password:   *r.password,
		DB:         *r.db,
		TLSEnabled: *r.tlsEnabled,
	}
}

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

package postgres

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// PostgresConfig holds PostgreSQL connection configuration
type PostgresConfig struct {
	Host            string
	Port            int
	Database        string
	User            string
	Password        string
	MaxConns        int32
	MinConns        int32
	MaxConnLifetime time.Duration
	SSLMode         string
}

// PostgresClient handles PostgreSQL database operations
type PostgresClient struct {
	pool   *pgxpool.Pool
	logger *slog.Logger
}

// NewPostgresClientFromParams creates a new PostgreSQL client with the given connection parameters.
// This is a convenience function that constructs a PostgresConfig and calls NewPostgresClient.
func CreatePostgresClient(
	ctx context.Context,
	logger *slog.Logger,
	host string,
	port int,
	database string,
	user string,
	password string,
	maxConns int32,
	minConns int32,
	maxConnLifetime time.Duration,
	sslMode string,
) (*PostgresClient, error) {
	config := PostgresConfig{
		Host:            host,
		Port:            port,
		Database:        database,
		User:            user,
		Password:        password,
		MaxConns:        maxConns,
		MinConns:        minConns,
		MaxConnLifetime: maxConnLifetime,
		SSLMode:         sslMode,
	}

	client, err := NewPostgresClient(ctx, config, logger)
	if err != nil {
		return nil, err
	}

	logger.Info("postgres client initialized",
		slog.String("host", host),
		slog.Int("port", port),
		slog.String("database", database),
	)

	return client, nil
}

// NewPostgresClient creates a new PostgreSQL client with connection pooling
func NewPostgresClient(ctx context.Context, config PostgresConfig, logger *slog.Logger) (*PostgresClient, error) {
	// Build connection URL
	connURL := fmt.Sprintf(
		"postgres://%s:%s@%s:%d/%s?sslmode=%s",
		config.User,
		config.Password,
		config.Host,
		config.Port,
		config.Database,
		config.SSLMode,
	)

	// Parse config to get a pgxpool.Config
	poolConfig, err := pgxpool.ParseConfig(connURL)
	if err != nil {
		return nil, fmt.Errorf("failed to parse connection config: %w", err)
	}

	// Configure connection pool settings
	poolConfig.MaxConns = config.MaxConns
	poolConfig.MinConns = config.MinConns
	poolConfig.MaxConnLifetime = config.MaxConnLifetime

	// Create connection pool
	pool, err := pgxpool.NewWithConfig(ctx, poolConfig)
	if err != nil {
		return nil, fmt.Errorf("failed to create connection pool: %w", err)
	}

	// Ping to verify connection
	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	if err := pool.Ping(pingCtx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}

	logger.Info("postgres client connected successfully")

	return &PostgresClient{
		pool:   pool,
		logger: logger,
	}, nil
}

// Close closes the database connection pool
func (c *PostgresClient) Close() {
	c.logger.Info("closing postgres client")
	c.pool.Close()
}

// Pool returns the underlying pgxpool.Pool for direct database access
func (c *PostgresClient) Pool() *pgxpool.Pool {
	return c.pool
}

// Ping verifies the database connection is still alive
func (c *PostgresClient) Ping(ctx context.Context) error {
	return c.pool.Ping(ctx)
}

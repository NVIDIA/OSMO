/*
SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION. All rights reserved.

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

// Package postgres provides PostgreSQL connection management using pgxpool.
package postgres

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Config holds database connection configuration.
type Config struct {
	Host            string
	Port            int
	User            string
	Password        string
	Database        string
	SSLMode         string
	MaxConns        int32
	MinConns        int32
	MaxConnLifetime time.Duration
	MaxConnIdleTime time.Duration
}

// DefaultConfig returns a Config with sensible defaults.
func DefaultConfig() Config {
	return Config{
		Host:            "localhost",
		Port:            5432,
		User:            "osmo",
		Database:        "osmo",
		SSLMode:         "disable",
		MaxConns:        10,
		MinConns:        2,
		MaxConnLifetime: time.Hour,
		MaxConnIdleTime: 30 * time.Minute,
	}
}

// ConnectionString builds a PostgreSQL connection string from the config.
func (c Config) ConnectionString() string {
	return fmt.Sprintf(
		"postgres://%s:%s@%s:%d/%s?sslmode=%s",
		c.User, c.Password,
		c.Host, c.Port,
		c.Database, c.SSLMode,
	)
}

// Client wraps pgxpool.Pool with logging and health checks.
type Client struct {
	pool   *pgxpool.Pool
	logger *slog.Logger
}

// NewClient creates a new PostgreSQL client with connection pooling.
// It validates the connection by pinging the database.
func NewClient(ctx context.Context, config Config, logger *slog.Logger) (*Client, error) {
	if logger == nil {
		logger = slog.Default()
	}

	poolConfig, err := pgxpool.ParseConfig(config.ConnectionString())
	if err != nil {
		return nil, fmt.Errorf("failed to parse connection string: %w", err)
	}

	poolConfig.MaxConns = config.MaxConns
	poolConfig.MinConns = config.MinConns
	poolConfig.MaxConnLifetime = config.MaxConnLifetime
	poolConfig.MaxConnIdleTime = config.MaxConnIdleTime

	pool, err := pgxpool.NewWithConfig(ctx, poolConfig)
	if err != nil {
		return nil, fmt.Errorf("failed to create connection pool: %w", err)
	}

	// Validate connection
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}

	logger.Info("connected to PostgreSQL",
		slog.String("host", config.Host),
		slog.Int("port", config.Port),
		slog.String("database", config.Database),
		slog.Int("max_conns", int(config.MaxConns)),
	)

	return &Client{pool: pool, logger: logger}, nil
}

// Pool returns the underlying pgxpool.Pool for use with sqlc queries.
func (c *Client) Pool() *pgxpool.Pool {
	return c.pool
}

// Close closes the connection pool.
func (c *Client) Close() {
	c.pool.Close()
	c.logger.Info("PostgreSQL connection pool closed")
}

// Healthy returns true if the database is reachable.
func (c *Client) Healthy(ctx context.Context) bool {
	return c.pool.Ping(ctx) == nil
}

// Stats returns pool statistics for monitoring.
func (c *Client) Stats() *pgxpool.Stat {
	return c.pool.Stat()
}

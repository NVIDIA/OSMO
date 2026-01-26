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
	"flag"
	"fmt"
	"log/slog"
	"os"
	"strconv"
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

	logger.Info("postgres client connected successfully",
		slog.String("host", config.Host),
		slog.Int("port", config.Port),
		slog.String("database", config.Database),
	)

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

// CreateClient creates a PostgreSQL client from PostgresConfig
func (config *PostgresConfig) CreateClient(logger *slog.Logger) (*PostgresClient, error) {
	return NewPostgresClient(context.Background(), *config, logger)
}

// PostgresFlagPointers holds pointers to flag values for PostgreSQL configuration
type PostgresFlagPointers struct {
	host               *string
	port               *int
	user               *string
	password           *string
	database           *string
	maxConns           *int
	minConns           *int
	maxConnLifetimeMin *int
	sslMode            *string
}

// RegisterPostgresFlags registers PostgreSQL-related command-line flags
// Returns a PostgresFlagPointers that should be converted to PostgresArgs
// after flag.Parse() is called
func RegisterPostgresFlags() *PostgresFlagPointers {
	return &PostgresFlagPointers{
		host: flag.String("postgres-host",
			getEnv("OSMO_POSTGRES_HOST", "localhost"),
			"PostgreSQL host"),
		port: flag.Int("postgres-port",
			getEnvInt("OSMO_POSTGRES_PORT", 5432),
			"PostgreSQL port"),
		user: flag.String("postgres-user",
			getEnv("OSMO_POSTGRES_USER", "postgres"),
			"PostgreSQL user"),
		password: flag.String("postgres-password",
			getEnv("OSMO_POSTGRES_PASSWORD", ""),
			"PostgreSQL password"),
		database: flag.String("postgres-database",
			getEnv("OSMO_POSTGRES_DATABASE_NAME", "osmo_db"),
			"PostgreSQL database name"),
		maxConns: flag.Int("postgres-max-conns",
			getEnvInt("OSMO_POSTGRES_MAX_CONNS", 10),
			"PostgreSQL maximum connections in pool"),
		minConns: flag.Int("postgres-min-conns",
			getEnvInt("OSMO_POSTGRES_MIN_CONNS", 2),
			"PostgreSQL minimum connections in pool"),
		maxConnLifetimeMin: flag.Int("postgres-max-conn-lifetime",
			getEnvInt("OSMO_POSTGRES_MAX_CONN_LIFETIME", 5),
			"PostgreSQL maximum connection lifetime in minutes"),
		sslMode: flag.String("postgres-ssl-mode",
			getEnv("OSMO_POSTGRES_SSL_MODE", "disable"),
			"PostgreSQL SSL mode (disable, require, verify-ca, verify-full)"),
	}
}

// ToPostgresConfig converts flag pointers to PostgresConfig
// This should be called after flag.Parse()
func (p *PostgresFlagPointers) ToPostgresConfig() PostgresConfig {
	return PostgresConfig{
		Host:            *p.host,
		Port:            *p.port,
		Database:        *p.database,
		User:            *p.user,
		Password:        *p.password,
		MaxConns:        int32(*p.maxConns),
		MinConns:        int32(*p.minConns),
		MaxConnLifetime: time.Duration(*p.maxConnLifetimeMin) * time.Minute,
		SSLMode:         *p.sslMode,
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

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

package database

import (
	"context"
	_ "embed"
	"fmt"
	"log/slog"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/modules/postgres"
	"github.com/testcontainers/testcontainers-go/wait"

	osmo_postgres "go.corp.nvidia.com/osmo/utils/postgres"
)

//go:embed testdata/schema.sql
var schemaSQL string

const (
	DefaultPostgresImage    = "postgres:15.1"
	DefaultPostgresDB       = "osmo_db"
	DefaultPostgresUser     = "postgres"
	DefaultPostgresPassword = "osmo_pass"
)

// PostgresFixture holds a running PostgreSQL testcontainer and provides
// access to the connection pool and an osmo PostgresClient.
type PostgresFixture struct {
	Container testcontainers.Container
	Pool      *pgxpool.Pool
	Client    *osmo_postgres.PostgresClient
	ConnStr   string
	Host      string
	Port      string
}

// PostgresOption configures the PostgreSQL container.
type PostgresOption func(*postgresConfig)

type postgresConfig struct {
	image      string
	dbName     string
	user       string
	password   string
	initSQL    []string
	applySchema bool
}

// WithPostgresImage overrides the default PostgreSQL Docker image.
func WithPostgresImage(image string) PostgresOption {
	return func(c *postgresConfig) { c.image = image }
}

// WithInitSQL adds SQL script files to run on container startup.
func WithInitSQL(paths ...string) PostgresOption {
	return func(c *postgresConfig) { c.initSQL = append(c.initSQL, paths...) }
}

// WithDatabase overrides the default database name.
func WithDatabase(name string) PostgresOption {
	return func(c *postgresConfig) { c.dbName = name }
}

// WithCredentials overrides the default user and password.
func WithCredentials(user, password string) PostgresOption {
	return func(c *postgresConfig) {
		c.user = user
		c.password = password
	}
}

// WithOsmoSchema applies the shared OSMO database schema (embedded from
// testdata/schema.sql) after the container starts. This creates the core
// tables (roles, users, user_roles, pools, workflows, etc.) so tests
// don't need to bring their own schema files.
func WithOsmoSchema() PostgresOption {
	return func(c *postgresConfig) { c.applySchema = true }
}

// StartPostgresWithSchema is a convenience wrapper that starts a PostgreSQL
// container with the shared OSMO schema already applied. Equivalent to:
//
//	database.StartPostgres(t, database.WithOsmoSchema(), opts...)
func StartPostgresWithSchema(t testing.TB, opts ...PostgresOption) *PostgresFixture {
	t.Helper()
	return StartPostgres(t, append([]PostgresOption{WithOsmoSchema()}, opts...)...)
}

// StartPostgres creates and starts a PostgreSQL testcontainer. The container
// and all connections are automatically cleaned up when the test finishes
// via t.Cleanup(). Returns a PostgresFixture with both a raw pgxpool.Pool
// and an osmo PostgresClient ready to use.
func StartPostgres(t testing.TB, opts ...PostgresOption) *PostgresFixture {
	t.Helper()

	password := DefaultPostgresPassword
	if envPassword := os.Getenv("OSMO_POSTGRES_PASSWORD"); envPassword != "" {
		password = envPassword
	}

	config := &postgresConfig{
		image:    DefaultPostgresImage,
		dbName:   DefaultPostgresDB,
		user:     DefaultPostgresUser,
		password: password,
	}
	for _, opt := range opts {
		opt(config)
	}

	ctx := context.Background()

	containerOpts := []testcontainers.ContainerCustomizer{
		postgres.WithDatabase(config.dbName),
		postgres.WithUsername(config.user),
		postgres.WithPassword(config.password),
		testcontainers.WithWaitStrategy(
			wait.ForLog("database system is ready to accept connections").
				WithOccurrence(2).
				WithStartupTimeout(30 * time.Second),
		),
	}

	for _, sqlFile := range config.initSQL {
		containerOpts = append(containerOpts, postgres.WithInitScripts(sqlFile))
	}

	container, err := postgres.Run(ctx, config.image, containerOpts...)
	if err != nil {
		t.Fatalf("failed to start postgres container: %v", err)
	}

	t.Cleanup(func() {
		if terminateErr := container.Terminate(ctx); terminateErr != nil {
			t.Logf("failed to terminate postgres container: %v", terminateErr)
		}
	})

	connStr, err := container.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		t.Fatalf("failed to get postgres connection string: %v", err)
	}

	pool, err := pgxpool.New(ctx, connStr)
	if err != nil {
		t.Fatalf("failed to create connection pool: %v", err)
	}
	t.Cleanup(pool.Close)

	if config.applySchema {
		if _, err := pool.Exec(ctx, schemaSQL); err != nil {
			t.Fatalf("failed to apply OSMO schema: %v", err)
		}
	}

	host, err := container.Host(ctx)
	if err != nil {
		t.Fatalf("failed to get container host: %v", err)
	}

	mappedPort, err := container.MappedPort(ctx, "5432")
	if err != nil {
		t.Fatalf("failed to get mapped port: %v", err)
	}

	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelDebug}))

	pgClient, err := osmo_postgres.NewPostgresClient(ctx, osmo_postgres.PostgresConfig{
		Host:            host,
		Port:            mappedPort.Int(),
		Database:        config.dbName,
		User:            config.user,
		Password:        config.password,
		MaxConns:        5,
		MinConns:        1,
		MaxConnLifetime: 5 * time.Minute,
		SSLMode:         "disable",
	}, logger)
	if err != nil {
		t.Fatalf("failed to create osmo postgres client: %v", err)
	}
	t.Cleanup(pgClient.Close)

	return &PostgresFixture{
		Container: container,
		Pool:      pool,
		Client:    pgClient,
		ConnStr:   connStr,
		Host:      host,
		Port:      mappedPort.Port(),
	}
}

// TruncateAllTables truncates all user-created tables in the public schema,
// providing per-test isolation. Call this at the start of subtests to reset
// database state.
func (f *PostgresFixture) TruncateAllTables(t testing.TB) {
	t.Helper()
	ctx := context.Background()

	rows, err := f.Pool.Query(ctx, `
		SELECT tablename FROM pg_tables
		WHERE schemaname = 'public'
	`)
	if err != nil {
		t.Fatalf("failed to list tables: %v", err)
	}
	defer rows.Close()

	var tables []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			t.Fatalf("failed to scan table name: %v", err)
		}
		tables = append(tables, name)
	}

	if len(tables) > 0 {
		truncateSQL := fmt.Sprintf("TRUNCATE TABLE %s CASCADE", strings.Join(tables, ", "))
		if _, err := f.Pool.Exec(ctx, truncateSQL); err != nil {
			t.Fatalf("failed to truncate tables: %v", err)
		}
	}
}

// ResetSchema drops all tables in the public schema and re-applies the
// embedded OSMO schema. This gives each test a clean database with empty
// tables. Callers can then apply service-specific seed data via ExecSQL
// or ExecSQLFile.
func (f *PostgresFixture) ResetSchema(t testing.TB) {
	t.Helper()
	ctx := context.Background()

	// Drop all tables so schema can be re-applied cleanly.
	rows, err := f.Pool.Query(ctx, `
		SELECT tablename FROM pg_tables
		WHERE schemaname = 'public'
	`)
	if err != nil {
		t.Fatalf("failed to list tables: %v", err)
	}
	defer rows.Close()

	var tables []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			t.Fatalf("failed to scan table name: %v", err)
		}
		tables = append(tables, name)
	}

	for _, table := range tables {
		if _, err := f.Pool.Exec(ctx, fmt.Sprintf("DROP TABLE IF EXISTS %s CASCADE", table)); err != nil {
			t.Fatalf("failed to drop table %s: %v", table, err)
		}
	}

	// Re-apply the shared schema.
	if _, err := f.Pool.Exec(ctx, schemaSQL); err != nil {
		t.Fatalf("failed to re-apply OSMO schema: %v", err)
	}
}

// ExecSQL executes a SQL statement against the test database.
func (f *PostgresFixture) ExecSQL(t testing.TB, sql string, args ...any) {
	t.Helper()
	if _, err := f.Pool.Exec(context.Background(), sql, args...); err != nil {
		t.Fatalf("failed to execute SQL: %v", err)
	}
}

// ExecSQLFile reads a SQL file from disk and executes it against the test
// database. Use this to apply service-specific seed data between tests.
func (f *PostgresFixture) ExecSQLFile(t testing.TB, path string) {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("failed to read SQL file %s: %v", path, err)
	}
	f.ExecSQL(t, string(data))
}

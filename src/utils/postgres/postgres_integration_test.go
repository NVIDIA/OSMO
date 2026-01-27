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
	"log/slog"
	"os"
	"testing"
	"time"
)

var postgresFlagPtrs = RegisterPostgresFlags()

// TestPostgresIntegration_Connection tests connecting to a real PostgreSQL instance
func TestPostgresIntegration_Connection(t *testing.T) {
	flag.Parse()

	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))

	// Create postgres client using flag pointers
	config := postgresFlagPtrs.ToPostgresConfig()

	ctx := context.Background()
	client, err := NewPostgresClient(ctx, config, logger)
	if err != nil {
		t.Fatalf("Failed to create postgres client: %v\n"+
			"Make sure PostgreSQL is running with:\n"+
			"  docker run --rm -d --name postgres -p 5432:5432 \\\n"+
			"    -e POSTGRES_PASSWORD=osmo -e POSTGRES_DB=osmo_db postgres:15.1",
			err)
	}
	defer client.Close()

	// Verify connection
	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	if err := client.Ping(pingCtx); err != nil {
		t.Fatalf("Failed to ping database: %v", err)
	}

	t.Log("✓ Successfully connected to PostgreSQL")
}

// TestPostgresIntegration_Pool tests that the connection pool is accessible
func TestPostgresIntegration_Pool(t *testing.T) {
	flag.Parse()

	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))

	// Create postgres client using flag pointers
	config := postgresFlagPtrs.ToPostgresConfig()

	ctx := context.Background()
	client, err := NewPostgresClient(ctx, config, logger)
	if err != nil {
		t.Fatalf("Failed to create postgres client: %v", err)
	}
	defer client.Close()

	// Get pool and verify it's not nil
	pool := client.Pool()
	if pool == nil {
		t.Fatal("Pool() returned nil")
	}

	// Execute a simple query using the pool
	queryCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	rows, err := pool.Query(queryCtx, "SELECT 1")
	if err != nil {
		t.Fatalf("Failed to execute query: %v", err)
	}
	defer rows.Close()

	if !rows.Next() {
		t.Fatal("Expected at least one row from SELECT 1")
	}

	var result int
	if err := rows.Scan(&result); err != nil {
		t.Fatalf("Failed to scan result: %v", err)
	}

	if result != 1 {
		t.Errorf("Expected result 1, got %d", result)
	}

	t.Log("✓ Successfully executed query using pool")
}

// TestPostgresIntegration_CreateClient tests the CreateClient method on PostgresConfig
func TestPostgresIntegration_CreateClient(t *testing.T) {
	flag.Parse()

	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))

	// Create postgres client using flag pointers and CreateClient method
	config := postgresFlagPtrs.ToPostgresConfig()
	client, err := config.CreateClient(logger)
	if err != nil {
		t.Fatalf("Failed to create postgres client using CreateClient: %v", err)
	}
	defer client.Close()

	// Verify connection
	ctx := context.Background()
	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	if err := client.Ping(pingCtx); err != nil {
		t.Fatalf("Failed to ping database: %v", err)
	}

	t.Log("✓ Successfully connected using CreateClient method")
}

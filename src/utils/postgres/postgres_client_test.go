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
	"testing"
	"time"
)

func TestPostgresConfig(t *testing.T) {
	// Test creating a config struct
	config := PostgresConfig{
		Host:            "localhost",
		Port:            5432,
		Database:        "test_db",
		User:            "test_user",
		Password:        "test_pass",
		MaxConns:        10,
		MinConns:        2,
		MaxConnLifetime: 5 * time.Minute,
		SSLMode:         "disable",
	}

	if config.Host != "localhost" {
		t.Errorf("config.Host = %q, want %q", config.Host, "localhost")
	}
	if config.Port != 5432 {
		t.Errorf("config.Port = %d, want %d", config.Port, 5432)
	}
	if config.Database != "test_db" {
		t.Errorf("config.Database = %q, want %q", config.Database, "test_db")
	}
	if config.User != "test_user" {
		t.Errorf("config.User = %q, want %q", config.User, "test_user")
	}
	if config.Password != "test_pass" {
		t.Errorf("config.Password = %q, want %q", config.Password, "test_pass")
	}
	if config.MaxConns != 10 {
		t.Errorf("config.MaxConns = %d, want %d", config.MaxConns, 10)
	}
	if config.MinConns != 2 {
		t.Errorf("config.MinConns = %d, want %d", config.MinConns, 2)
	}
	if config.MaxConnLifetime != 5*time.Minute {
		t.Errorf("config.MaxConnLifetime = %v, want %v", config.MaxConnLifetime, 5*time.Minute)
	}
	if config.SSLMode != "disable" {
		t.Errorf("config.SSLMode = %q, want %q", config.SSLMode, "disable")
	}
}

// Note: Full PostgreSQL integration tests require a running database
// and are better suited for integration test environments.
// These unit tests verify the structure and helper functions.

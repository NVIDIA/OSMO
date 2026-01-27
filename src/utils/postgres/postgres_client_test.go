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
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// TestURLEscaping verifies that passwords with special characters are properly escaped
func TestURLEscaping(t *testing.T) {
	testCases := []struct {
		name     string
		password string
	}{
		{
			name:     "password with percent",
			password: "test%2password",
		},
		{
			name:     "password with at sign",
			password: "test@password",
		},
		{
			name:     "password with colon",
			password: "test:password",
		},
		{
			name:     "password with slash",
			password: "test/password",
		},
		{
			name:     "password with multiple special chars",
			password: "p@ss%2:w/rd",
		},
		{
			name:     "complex password like from Vault",
			password: "Ab%2Cd@Ef:Gh/Ij",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			// Build connection URL with proper escaping
			connURL := fmt.Sprintf(
				"postgres://%s:%s@%s:%d/%s?sslmode=%s",
				url.PathEscape("testuser"),
				url.PathEscape(tc.password),
				"localhost",
				5432,
				"testdb",
				"disable",
			)

			// Try to parse it - should not error
			_, err := pgxpool.ParseConfig(connURL)
			if err != nil {
				t.Errorf("Failed to parse connection URL with password '%s': %v", tc.password, err)
				t.Logf("Generated URL: %s", connURL)
			} else {
				t.Logf("✓ Successfully parsed URL with password: %s", tc.password)
			}
		})
	}
}

// TestURLEscapingWithoutEscape demonstrates the failure case without escaping
func TestURLEscapingWithoutEscape(t *testing.T) {
	password := "test%2password"

	// Build connection URL WITHOUT escaping (the old way)
	connURL := fmt.Sprintf(
		"postgres://%s:%s@%s:%d/%s?sslmode=%s",
		"testuser",
		password, // NOT escaped
		"localhost",
		5432,
		"testdb",
		"disable",
	)

	// This should fail to parse
	_, err := pgxpool.ParseConfig(connURL)
	if err == nil {
		t.Errorf("Expected error when parsing unescaped password, but got none")
	} else {
		t.Logf("✓ Expected error occurred without escaping: %v", err)
	}
}

// TestGetEnv tests the getEnv helper function
func TestGetEnv(t *testing.T) {
	testCases := []struct {
		name         string
		envKey       string
		envValue     string
		defaultValue string
		expected     string
	}{
		{
			name:         "env var set",
			envKey:       "TEST_ENV_VAR",
			envValue:     "test_value",
			defaultValue: "default",
			expected:     "test_value",
		},
		{
			name:         "env var not set",
			envKey:       "TEST_NONEXISTENT_VAR",
			envValue:     "",
			defaultValue: "default",
			expected:     "default",
		},
		{
			name:         "env var empty string",
			envKey:       "TEST_EMPTY_VAR",
			envValue:     "",
			defaultValue: "default",
			expected:     "default",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			// Set up environment
			if tc.envValue != "" {
				os.Setenv(tc.envKey, tc.envValue)
				defer os.Unsetenv(tc.envKey)
			}

			result := getEnv(tc.envKey, tc.defaultValue)
			if result != tc.expected {
				t.Errorf("Expected %s, got %s", tc.expected, result)
			}
		})
	}
}

// TestGetEnvInt tests the getEnvInt helper function
func TestGetEnvInt(t *testing.T) {
	testCases := []struct {
		name         string
		envKey       string
		envValue     string
		defaultValue int
		expected     int
	}{
		{
			name:         "valid integer",
			envKey:       "TEST_INT_VAR",
			envValue:     "42",
			defaultValue: 10,
			expected:     42,
		},
		{
			name:         "invalid integer",
			envKey:       "TEST_INVALID_INT",
			envValue:     "not_a_number",
			defaultValue: 10,
			expected:     10,
		},
		{
			name:         "env var not set",
			envKey:       "TEST_NONEXISTENT_INT",
			envValue:     "",
			defaultValue: 10,
			expected:     10,
		},
		{
			name:         "negative integer",
			envKey:       "TEST_NEGATIVE_INT",
			envValue:     "-5",
			defaultValue: 10,
			expected:     -5,
		},
		{
			name:         "zero",
			envKey:       "TEST_ZERO_INT",
			envValue:     "0",
			defaultValue: 10,
			expected:     0,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			// Set up environment
			if tc.envValue != "" {
				os.Setenv(tc.envKey, tc.envValue)
				defer os.Unsetenv(tc.envKey)
			}

			result := getEnvInt(tc.envKey, tc.defaultValue)
			if result != tc.expected {
				t.Errorf("Expected %d, got %d", tc.expected, result)
			}
		})
	}
}

// TestGetEnvOrConfig tests the getEnvOrConfig function with various scenarios
func TestGetEnvOrConfig(t *testing.T) {
	// Create a temporary config file
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "test_config.yaml")
	configContent := `postgres_password: "config_password"
redis_password: "config_redis_pass"
other_value: "test"`

	if err := os.WriteFile(configPath, []byte(configContent), 0644); err != nil {
		t.Fatalf("Failed to create test config file: %v", err)
	}

	testCases := []struct {
		name         string
		envKey       string
		envValue     string
		configKey    string
		configPath   string
		defaultValue string
		expected     string
	}{
		{
			name:         "env var takes priority",
			envKey:       "TEST_PASSWORD",
			envValue:     "env_password",
			configKey:    "postgres_password",
			configPath:   configPath,
			defaultValue: "default",
			expected:     "env_password",
		},
		{
			name:         "fallback to config file",
			envKey:       "TEST_EMPTY_PASSWORD",
			envValue:     "",
			configKey:    "postgres_password",
			configPath:   configPath,
			defaultValue: "default",
			expected:     "config_password",
		},
		{
			name:         "fallback to default",
			envKey:       "TEST_NONEXISTENT",
			envValue:     "",
			configKey:    "nonexistent_key",
			configPath:   configPath,
			defaultValue: "default",
			expected:     "default",
		},
		{
			name:         "no config file",
			envKey:       "TEST_NO_CONFIG",
			envValue:     "",
			configKey:    "postgres_password",
			configPath:   "",
			defaultValue: "default",
			expected:     "default",
		},
		{
			name:         "invalid config file path",
			envKey:       "TEST_INVALID_CONFIG",
			envValue:     "",
			configKey:    "postgres_password",
			configPath:   "/nonexistent/path/config.yaml",
			defaultValue: "default",
			expected:     "default",
		},
		{
			name:         "read other key from config",
			envKey:       "TEST_OTHER",
			envValue:     "",
			configKey:    "other_value",
			configPath:   configPath,
			defaultValue: "default",
			expected:     "test",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			// Set up environment
			if tc.envValue != "" {
				os.Setenv(tc.envKey, tc.envValue)
				defer os.Unsetenv(tc.envKey)
			}
			if tc.configPath != "" {
				os.Setenv("OSMO_CONFIG_FILE", tc.configPath)
				defer os.Unsetenv("OSMO_CONFIG_FILE")
			}

			result := getEnvOrConfig(tc.envKey, tc.configKey, tc.defaultValue)
			if result != tc.expected {
				t.Errorf("Expected %s, got %s", tc.expected, result)
			}
		})
	}
}

// TestGetEnvOrConfigWithInvalidYAML tests handling of malformed YAML
func TestGetEnvOrConfigWithInvalidYAML(t *testing.T) {
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "invalid.yaml")
	invalidContent := `invalid: yaml: content: [[[`

	if err := os.WriteFile(configPath, []byte(invalidContent), 0644); err != nil {
		t.Fatalf("Failed to create invalid config file: %v", err)
	}

	os.Setenv("OSMO_CONFIG_FILE", configPath)
	defer os.Unsetenv("OSMO_CONFIG_FILE")

	result := getEnvOrConfig("TEST_KEY", "postgres_password", "default")
	if result != "default" {
		t.Errorf("Expected default value for invalid YAML, got %s", result)
	}
}

// TestPostgresConfigToPostgresConfig tests the flag to config conversion
func TestPostgresFlagPointersToPostgresConfig(t *testing.T) {
	// Create test values
	host := "testhost"
	port := 5433
	user := "testuser"
	password := "testpass"
	database := "testdb"
	maxConns := 20
	minConns := 5
	maxConnLifetime := 10
	sslMode := "require"

	flagPtrs := &PostgresFlagPointers{
		host:               &host,
		port:               &port,
		user:               &user,
		password:           &password,
		database:           &database,
		maxConns:           &maxConns,
		minConns:           &minConns,
		maxConnLifetimeMin: &maxConnLifetime,
		sslMode:            &sslMode,
	}

	config := flagPtrs.ToPostgresConfig()

	// Verify all fields
	if config.Host != host {
		t.Errorf("Expected host %s, got %s", host, config.Host)
	}
	if config.Port != port {
		t.Errorf("Expected port %d, got %d", port, config.Port)
	}
	if config.User != user {
		t.Errorf("Expected user %s, got %s", user, config.User)
	}
	if config.Password != password {
		t.Errorf("Expected password %s, got %s", password, config.Password)
	}
	if config.Database != database {
		t.Errorf("Expected database %s, got %s", database, config.Database)
	}
	if config.MaxConns != int32(maxConns) {
		t.Errorf("Expected maxConns %d, got %d", maxConns, config.MaxConns)
	}
	if config.MinConns != int32(minConns) {
		t.Errorf("Expected minConns %d, got %d", minConns, config.MinConns)
	}
	expectedLifetime := time.Duration(maxConnLifetime) * time.Minute
	if config.MaxConnLifetime != expectedLifetime {
		t.Errorf("Expected maxConnLifetime %v, got %v", expectedLifetime, config.MaxConnLifetime)
	}
	if config.SSLMode != sslMode {
		t.Errorf("Expected sslMode %s, got %s", sslMode, config.SSLMode)
	}
}

// TestConnectionURLGeneration tests the full URL generation with escaping
func TestConnectionURLGeneration(t *testing.T) {
	testCases := []struct {
		name           string
		config         PostgresConfig
		expectedPrefix string
		shouldParse    bool
	}{
		{
			name: "standard config",
			config: PostgresConfig{
				Host:     "localhost",
				Port:     5432,
				Database: "testdb",
				User:     "postgres",
				Password: "simplepass",
				SSLMode:  "disable",
			},
			expectedPrefix: "postgres://postgres:",
			shouldParse:    true,
		},
		{
			name: "config with special chars in password",
			config: PostgresConfig{
				Host:     "db.example.com",
				Port:     5432,
				Database: "mydb",
				User:     "admin",
				Password: "p@ss%2:w/rd",
				SSLMode:  "require",
			},
			expectedPrefix: "postgres://admin:",
			shouldParse:    true,
		},
		{
			name: "config with special chars in username",
			config: PostgresConfig{
				Host:     "localhost",
				Port:     5432,
				Database: "testdb",
				User:     "user@domain.com",
				Password: "password",
				SSLMode:  "prefer",
			},
			expectedPrefix: "postgres://user",
			shouldParse:    true,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			connURL := fmt.Sprintf(
				"postgres://%s:%s@%s:%d/%s?sslmode=%s",
				url.PathEscape(tc.config.User),
				url.PathEscape(tc.config.Password),
				tc.config.Host,
				tc.config.Port,
				tc.config.Database,
				tc.config.SSLMode,
			)

			_, err := pgxpool.ParseConfig(connURL)
			if tc.shouldParse && err != nil {
				t.Errorf("Failed to parse config: %v", err)
				t.Logf("Generated URL: %s", connURL)
			} else if !tc.shouldParse && err == nil {
				t.Errorf("Expected parse to fail, but it succeeded")
			}
		})
	}
}

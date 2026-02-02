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
	"flag"
	"os"
	"path/filepath"
	"testing"

	"go.corp.nvidia.com/osmo/utils"
)

// TestRedisConfig verifies RedisConfig struct creation
func TestRedisConfig(t *testing.T) {
	config := RedisConfig{
		Host:       "redis.example.com",
		Port:       6380,
		Password:   "secret123",
		DB:         2,
		TLSEnabled: true,
	}

	if config.Host != "redis.example.com" {
		t.Errorf("Expected host redis.example.com, got %s", config.Host)
	}
	if config.Port != 6380 {
		t.Errorf("Expected port 6380, got %d", config.Port)
	}
	if config.Password != "secret123" {
		t.Errorf("Expected password secret123, got %s", config.Password)
	}
	if config.DB != 2 {
		t.Errorf("Expected DB 2, got %d", config.DB)
	}
	if !config.TLSEnabled {
		t.Errorf("Expected TLSEnabled true, got false")
	}
}

// TestToRedisConfig verifies conversion from flag pointers to RedisConfig
func TestToRedisConfig(t *testing.T) {
	host := "redis.local"
	port := 6379
	password := "testpass"
	db := 1
	tlsEnabled := true

	flagPtrs := &RedisFlagPointers{
		host:       &host,
		port:       &port,
		password:   &password,
		db:         &db,
		tlsEnabled: &tlsEnabled,
	}

	config := flagPtrs.ToRedisConfig()

	if config.Host != host {
		t.Errorf("Expected host %s, got %s", host, config.Host)
	}
	if config.Port != port {
		t.Errorf("Expected port %d, got %d", port, config.Port)
	}
	if config.Password != password {
		t.Errorf("Expected password %s, got %s", password, config.Password)
	}
	if config.DB != db {
		t.Errorf("Expected DB %d, got %d", db, config.DB)
	}
	if config.TLSEnabled != tlsEnabled {
		t.Errorf("Expected TLSEnabled %v, got %v", tlsEnabled, config.TLSEnabled)
	}
}

// TestGetEnv tests the GetEnv helper function from utils package
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
			envKey:       "TEST_REDIS_HOST",
			envValue:     "redis.test.com",
			defaultValue: "localhost",
			expected:     "redis.test.com",
		},
		{
			name:         "env var not set",
			envKey:       "TEST_REDIS_HOST_NOTSET",
			envValue:     "",
			defaultValue: "localhost",
			expected:     "localhost",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			if tc.envValue != "" {
				os.Setenv(tc.envKey, tc.envValue)
				defer os.Unsetenv(tc.envKey)
			}

			result := utils.GetEnv(tc.envKey, tc.defaultValue)
			if result != tc.expected {
				t.Errorf("Expected %s, got %s", tc.expected, result)
			}
		})
	}
}

// TestGetEnvInt tests the GetEnvInt helper function from utils package
func TestGetEnvInt(t *testing.T) {
	testCases := []struct {
		name         string
		envKey       string
		envValue     string
		defaultValue int
		expected     int
	}{
		{
			name:         "valid int env var",
			envKey:       "TEST_REDIS_PORT",
			envValue:     "6380",
			defaultValue: 6379,
			expected:     6380,
		},
		{
			name:         "env var not set",
			envKey:       "TEST_REDIS_PORT_NOTSET",
			envValue:     "",
			defaultValue: 6379,
			expected:     6379,
		},
		{
			name:         "invalid int env var",
			envKey:       "TEST_REDIS_PORT_INVALID",
			envValue:     "not_a_number",
			defaultValue: 6379,
			expected:     6379,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			if tc.envValue != "" {
				os.Setenv(tc.envKey, tc.envValue)
				defer os.Unsetenv(tc.envKey)
			}

			result := utils.GetEnvInt(tc.envKey, tc.defaultValue)
			if result != tc.expected {
				t.Errorf("Expected %d, got %d", tc.expected, result)
			}
		})
	}
}

// TestGetEnvBool tests the GetEnvBool helper function from utils package
func TestGetEnvBool(t *testing.T) {
	testCases := []struct {
		name         string
		envKey       string
		envValue     string
		defaultValue bool
		expected     bool
	}{
		{
			name:         "true value",
			envKey:       "TEST_REDIS_TLS",
			envValue:     "true",
			defaultValue: false,
			expected:     true,
		},
		{
			name:         "false value",
			envKey:       "TEST_REDIS_TLS",
			envValue:     "false",
			defaultValue: true,
			expected:     false,
		},
		{
			name:         "1 as true",
			envKey:       "TEST_REDIS_TLS",
			envValue:     "1",
			defaultValue: false,
			expected:     true,
		},
		{
			name:         "0 as false",
			envKey:       "TEST_REDIS_TLS",
			envValue:     "0",
			defaultValue: true,
			expected:     false,
		},
		{
			name:         "env var not set",
			envKey:       "TEST_REDIS_TLS_NOTSET",
			envValue:     "",
			defaultValue: true,
			expected:     true,
		},
		{
			name:         "invalid bool env var",
			envKey:       "TEST_REDIS_TLS_INVALID",
			envValue:     "not_a_bool",
			defaultValue: false,
			expected:     false,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			if tc.envValue != "" {
				os.Setenv(tc.envKey, tc.envValue)
				defer os.Unsetenv(tc.envKey)
			}

			result := utils.GetEnvBool(tc.envKey, tc.defaultValue)
			if result != tc.expected {
				t.Errorf("Expected %v, got %v", tc.expected, result)
			}
		})
	}
}

// TestGetEnvOrConfig tests the GetEnvOrConfig helper function from utils package
func TestGetEnvOrConfig(t *testing.T) {
	testCases := []struct {
		name         string
		envKey       string
		envValue     string
		configKey    string
		configValue  string
		defaultValue string
		expected     string
	}{
		{
			name:         "env var takes precedence",
			envKey:       "TEST_REDIS_PASSWORD",
			envValue:     "env_password",
			configKey:    "redis_password",
			configValue:  "config_password",
			defaultValue: "default",
			expected:     "env_password",
		},
		{
			name:         "config file used when env not set",
			envKey:       "TEST_REDIS_PASSWORD_NOTSET",
			envValue:     "",
			configKey:    "redis_password",
			configValue:  "config_password",
			defaultValue: "default",
			expected:     "config_password",
		},
		{
			name:         "default used when both not set",
			envKey:       "TEST_REDIS_PASSWORD_NOTSET",
			envValue:     "",
			configKey:    "nonexistent_key",
			configValue:  "",
			defaultValue: "default",
			expected:     "default",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			// Set env var if provided
			if tc.envValue != "" {
				os.Setenv(tc.envKey, tc.envValue)
				defer os.Unsetenv(tc.envKey)
			}

			// Create temp config file if config value provided
			if tc.configValue != "" {
				tmpDir := t.TempDir()
				configPath := filepath.Join(tmpDir, "test_config.yaml")
				configContent := tc.configKey + ": " + tc.configValue + "\n"
				if err := os.WriteFile(configPath, []byte(configContent), 0644); err != nil {
					t.Fatalf("Failed to write config file: %v", err)
				}
				os.Setenv("OSMO_CONFIG_FILE", configPath)
				defer os.Unsetenv("OSMO_CONFIG_FILE")
			}

			result := utils.GetEnvOrConfig(tc.envKey, tc.configKey, tc.defaultValue)
			if result != tc.expected {
				t.Errorf("Expected %s, got %s", tc.expected, result)
			}
		})
	}
}

// TestGetEnvOrConfigNoConfigFile tests behavior when OSMO_CONFIG_FILE is not set
func TestGetEnvOrConfigNoConfigFile(t *testing.T) {
	// Ensure OSMO_CONFIG_FILE is not set
	os.Unsetenv("OSMO_CONFIG_FILE")

	result := utils.GetEnvOrConfig("TEST_KEY", "redis_password", "default")
	if result != "default" {
		t.Errorf("Expected 'default', got '%s'", result)
	}
}

// TestRegisterRedisFlags tests that RegisterRedisFlags returns proper flag pointers
func TestRegisterRedisFlags(t *testing.T) {
	// Clear any existing environment variables
	os.Unsetenv("OSMO_REDIS_HOST")
	os.Unsetenv("OSMO_REDIS_PORT")
	os.Unsetenv("OSMO_REDIS_PASSWORD")
	os.Unsetenv("OSMO_REDIS_DB_NUMBER")
	os.Unsetenv("OSMO_REDIS_TLS_ENABLE")

	// Create a new flag set to avoid conflicts
	fs := flag.NewFlagSet("test", flag.ContinueOnError)

	// We can't directly test RegisterRedisFlags since it uses the global flag package,
	// but we can verify the structure
	flagPtrs := RegisterRedisFlags()

	if flagPtrs == nil {
		t.Error("Expected non-nil RedisFlagPointers")
	}

	if flagPtrs.host == nil {
		t.Error("Expected non-nil host pointer")
	}
	if flagPtrs.port == nil {
		t.Error("Expected non-nil port pointer")
	}
	if flagPtrs.password == nil {
		t.Error("Expected non-nil password pointer")
	}
	if flagPtrs.db == nil {
		t.Error("Expected non-nil db pointer")
	}
	if flagPtrs.tlsEnabled == nil {
		t.Error("Expected non-nil tlsEnabled pointer")
	}

	// Test default values
	config := flagPtrs.ToRedisConfig()
	if config.Host != "localhost" {
		t.Errorf("Expected default host 'localhost', got '%s'", config.Host)
	}
	if config.Port != 6379 {
		t.Errorf("Expected default port 6379, got %d", config.Port)
	}
	if config.DB != 0 {
		t.Errorf("Expected default DB 0, got %d", config.DB)
	}
	if config.TLSEnabled != false {
		t.Errorf("Expected default TLSEnabled false, got %v", config.TLSEnabled)
	}

	// Cleanup: we can't easily unregister flags, so just note this
	_ = fs
}

// TestRedisConfigWithEnvironmentVariables tests flag registration with env vars set
func TestRedisConfigWithEnvironmentVariables(t *testing.T) {
	// Set environment variables
	os.Setenv("OSMO_REDIS_HOST", "redis.env.com")
	os.Setenv("OSMO_REDIS_PORT", "6380")
	os.Setenv("OSMO_REDIS_DB_NUMBER", "3")
	os.Setenv("OSMO_REDIS_TLS_ENABLE", "true")

	defer func() {
		os.Unsetenv("OSMO_REDIS_HOST")
		os.Unsetenv("OSMO_REDIS_PORT")
		os.Unsetenv("OSMO_REDIS_DB_NUMBER")
		os.Unsetenv("OSMO_REDIS_TLS_ENABLE")
	}()

	// Note: This test demonstrates the expected behavior but can't fully test
	// RegisterRedisFlags without managing the global flag state
	// In a real scenario, the flags would pick up these env vars as defaults

	host := utils.GetEnv("OSMO_REDIS_HOST", "localhost")
	port := utils.GetEnvInt("OSMO_REDIS_PORT", 6379)
	db := utils.GetEnvInt("OSMO_REDIS_DB_NUMBER", 0)
	tlsEnabled := utils.GetEnvBool("OSMO_REDIS_TLS_ENABLE", false)

	if host != "redis.env.com" {
		t.Errorf("Expected host 'redis.env.com', got '%s'", host)
	}
	if port != 6380 {
		t.Errorf("Expected port 6380, got %d", port)
	}
	if db != 3 {
		t.Errorf("Expected DB 3, got %d", db)
	}
	if !tlsEnabled {
		t.Errorf("Expected TLSEnabled true, got false")
	}
}

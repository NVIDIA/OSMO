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

package utils

import (
	"log/slog"
	"os"
	"strconv"

	"gopkg.in/yaml.v3"
)

// GetEnv retrieves a string environment variable or returns a default value
func GetEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

// GetEnvInt retrieves an integer environment variable or returns a default value
func GetEnvInt(key string, defaultValue int) int {
	if value := os.Getenv(key); value != "" {
		if intValue, err := strconv.Atoi(value); err == nil {
			return intValue
		}
	}
	return defaultValue
}

// GetEnvBool retrieves a boolean environment variable or returns a default value
func GetEnvBool(key string, defaultValue bool) bool {
	if value := os.Getenv(key); value != "" {
		if boolValue, err := strconv.ParseBool(value); err == nil {
			return boolValue
		}
	}
	return defaultValue
}

// GetEnvOrConfig checks for value in environment variable first,
// then falls back to reading from a config file (path from OSMO_CONFIG_FILE env var)
// Priority: envKey > config file (configKey) > defaultValue
func GetEnvOrConfig(envKey, configKey, defaultValue string) string {
	if value := os.Getenv(envKey); value != "" {
		return value
	}

	if configPath := os.Getenv("OSMO_CONFIG_FILE"); configPath != "" {
		if data, err := os.ReadFile(configPath); err == nil {
			var config map[string]interface{}
			if err := yaml.Unmarshal(data, &config); err == nil {
				if value, exists := config[configKey]; exists {
					if strValue, isString := value.(string); isString && strValue != "" {
						return strValue
					}
				}
			} else {
				slog.Warn("Failed to parse config file",
					slog.String("path", configPath),
					slog.String("error", err.Error()))
			}
		}
	}

	return defaultValue
}

/*
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.

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
	"fmt"
	"os"
	"path/filepath"
	"runtime"

	"gopkg.in/yaml.v3"
)

// Version represents the version structure
type Version struct {
	Major    string `yaml:"major"`
	Minor    string `yaml:"minor"`
	Revision string `yaml:"revision"`
	Hash     string `yaml:"hash"`
}

// String returns the version as a string
func (v Version) String() string {
	version := fmt.Sprintf("%s.%s.%s", v.Major, v.Minor, v.Revision)
	if v.Hash != "" {
		version += fmt.Sprintf(".%s", v.Hash)
	}
	return version
}

// LoadVersion loads the version from version.yaml file in the same directory
func LoadVersion() (string, error) {
	// Get the directory where this Go file is located
	_, filename, _, ok := runtime.Caller(0)
	if !ok {
		return "dev", fmt.Errorf("failed to get current file path")
	}

	dir := filepath.Dir(filename)
	versionPath := filepath.Join(dir, "version.yaml")

	data, err := os.ReadFile(versionPath)
	if err != nil {
		return "dev", fmt.Errorf("failed to read version file: %w", err)
	}

	var version Version
	if err := yaml.Unmarshal(data, &version); err != nil {
		return "dev", fmt.Errorf("failed to parse version file: %w", err)
	}

	return version.String(), nil
}

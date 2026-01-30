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
	_ "embed"
	"fmt"

	"gopkg.in/yaml.v3"
)

//go:embed version.yaml
var versionYAML []byte

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

// LoadVersion loads the version from embedded version.yaml file
func LoadVersion() (string, error) {
	var version Version
	if err := yaml.Unmarshal(versionYAML, &version); err != nil {
		return "dev", fmt.Errorf("failed to parse embedded version file: %w", err)
	}

	return version.String(), nil
}

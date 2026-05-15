// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// SPDX-License-Identifier: Apache-2.0

package utils

import "testing"

func TestParseHost(t *testing.T) {
	host, port, err := ParseHost("http://0.0.0.0:8001")
	if err != nil {
		t.Fatalf("ParseHost() error = %v", err)
	}
	if host != "0.0.0.0" || port != 8001 {
		t.Fatalf("ParseHost() = %s, %d; want 0.0.0.0, 8001", host, port)
	}
}

func TestParseHostRejectsMissingPort(t *testing.T) {
	if _, _, err := ParseHost("http://0.0.0.0"); err == nil {
		t.Fatal("ParseHost() succeeded, want error")
	}
}

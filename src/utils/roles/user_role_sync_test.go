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

package roles

import (
	"context"
	"io"
	"log/slog"
	"testing"
)

// TestSyncUserRoles_EmptyUserName_ReturnsNilWithoutDB covers the early-return
// guard at the top of SyncUserRoles. With an empty userName the function must
// return (nil, nil) before touching the database, so passing a nil
// PostgresClient is enough — any database access would panic.
func TestSyncUserRoles_EmptyUserName_ReturnsNilWithoutDB(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))

	names, err := SyncUserRoles(
		context.Background(),
		nil, // would panic on dereference if the early return is missing
		"",
		[]string{"some-external-role"},
		logger,
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if names != nil {
		t.Errorf("names = %v, want nil", names)
	}
}

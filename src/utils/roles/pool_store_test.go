/*
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
SPDX-License-Identifier: Apache-2.0
*/

package roles

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestLoadConfigMapPoolStore(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.yaml")
	content := []byte(`
roles:
  retained-for-bridge: {}
backends:
  backend-a: {}
  backend-b: {}
pools:
  zeta: {backend: backend-a}
  alpha: {backend: backend-b}
`)
	if err := os.WriteFile(path, content, 0600); err != nil {
		t.Fatal(err)
	}
	store, err := LoadConfigMapPoolStore(path)
	if err != nil {
		t.Fatalf("load pool store: %v", err)
	}
	if got, want := store.GetPoolNames(), []string{"alpha", "zeta"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("pool names = %v, want %v", got, want)
	}
	if err := store.ValidateActiveWorkflowReference(
		"workflow-1", "zeta", "backend-a"); err != nil {
		t.Fatalf("valid workflow reference rejected: %v", err)
	}
	if err := store.ValidateActiveWorkflowReference(
		"workflow-2", "missing", "backend-a"); err == nil {
		t.Fatal("missing active pool was accepted")
	}
}

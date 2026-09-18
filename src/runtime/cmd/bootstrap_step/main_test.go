// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"
)

func TestTimeoutKillsAndReapsDescendants(t *testing.T) {
	pidFile := filepath.Join(t.TempDir(), "child")
	start := time.Now()
	err := run(context.Background(), 300*time.Millisecond, 0, []string{
		"/bin/sh", "-c", `trap '' TERM; sleep 600 & echo $! > "$1"; wait`, "sh", pidFile,
	})
	if err == nil || !strings.Contains(err.Error(), "exceeded") {
		t.Fatalf("expected timeout, got %v", err)
	}
	if time.Since(start) > 3*time.Second {
		t.Fatal("watchdog failed to bound execution")
	}
	data, err := os.ReadFile(pidFile)
	if err != nil {
		t.Fatal(err)
	}
	pid, err := strconv.Atoi(strings.TrimSpace(string(data)))
	if err != nil {
		t.Fatal(err)
	}
	if err := syscall.Kill(pid, 0); err != syscall.ESRCH {
		t.Fatalf("descendant still exists: %v", err)
	}
}

func TestRetryBudget(t *testing.T) {
	path := filepath.Join(t.TempDir(), "attempts")
	err := run(context.Background(), time.Second, 2, []string{
		"/bin/sh", "-c", `echo attempt >> "$1"; exit 7`, "sh", path,
	})
	if err == nil {
		t.Fatal("failed command succeeded")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "attempt\nattempt\nattempt\n" {
		t.Fatalf("wrong attempts: %q", data)
	}
}

func TestTimeoutReapsDescendantInAnotherSession(t *testing.T) {
	pidFile := filepath.Join(t.TempDir(), "session-leader")
	err := run(context.Background(), 300*time.Millisecond, 0, []string{
		"/bin/sh", "-c", `setsid sleep 600 & echo $! > "$1"; wait`, "sh", pidFile,
	})
	if err == nil {
		t.Fatal("expected timeout")
	}
	data, err := os.ReadFile(pidFile)
	if err != nil {
		t.Fatal(err)
	}
	pid, err := strconv.Atoi(strings.TrimSpace(string(data)))
	if err != nil {
		t.Fatal(err)
	}
	if err := syscall.Kill(pid, 0); err != syscall.ESRCH {
		t.Fatalf("escaped session descendant still exists: %v", err)
	}
}

func TestCancellationDoesNotRetry(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := run(ctx, time.Second, 5, []string{"/bin/true"}); err != context.Canceled {
		t.Fatalf("expected cancellation, got %v", err)
	}
}

func TestInstallExecutable(t *testing.T) {
	path := filepath.Join(t.TempDir(), "bootstrap-step")
	if err := install(path); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0755 {
		t.Fatalf("not executable: %v", info.Mode())
	}
	if err := install(path); err == nil {
		t.Fatal("must not overwrite installed supervisor")
	}
}

func TestPreparationCommandAndReceiptAreSequential(t *testing.T) {
	path := filepath.Join(t.TempDir(), "sequence")
	before, _ := json.Marshal([]string{"/bin/sh", "-c", `echo before >> "$1"`, "sh", path})
	after, _ := json.Marshal([]string{"/bin/sh", "-c", `echo after >> "$1"`, "sh", path})
	t.Setenv("OSMO_BOOTSTRAP_BEFORE", string(before))
	t.Setenv("OSMO_BOOTSTRAP_AFTER", string(after))
	if err := run(context.Background(), time.Second, 0, []string{
		"/bin/sh", "-c", `echo command >> "$1"`, "sh", path,
	}); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "before\ncommand\nafter\n" {
		t.Fatalf("unexpected order: %q", data)
	}
}

func TestFailedCommandCannotRecordReceipt(t *testing.T) {
	path := filepath.Join(t.TempDir(), "receipt")
	after, _ := json.Marshal([]string{"/bin/sh", "-c", `touch "$1"`, "sh", path})
	t.Setenv("OSMO_BOOTSTRAP_AFTER", string(after))
	if err := run(context.Background(), time.Second, 0, []string{"/bin/false"}); err == nil {
		t.Fatal("expected failure")
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatal("receipt ran after failure")
	}
}

func TestLeaseCleanupFencesOwnerAndResourceVersion(t *testing.T) {
	patches := 0
	holder := "pod/uid"
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Header.Get("Authorization") != "Bearer test-token" {
			t.Error("missing authorization")
		}
		if request.Method == http.MethodGet {
			_ = json.NewEncoder(writer).Encode(map[string]any{
				"metadata": map[string]string{"resourceVersion": "42"},
				"spec":     map[string]string{"holderIdentity": holder},
			})
			return
		}
		patches++
		var body map[string]map[string]any
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		if body["metadata"]["resourceVersion"] != "42" || body["spec"]["holderIdentity"] != nil {
			t.Error("missing compare-and-swap or holder clear")
		}
	}))
	defer server.Close()
	if err := releaseLease(server.Client(), server.URL, "test-token", "uid"); err != nil {
		t.Fatal(err)
	}
	holder = "new-pod/new-uid"
	if err := releaseLease(server.Client(), server.URL, "test-token", "uid"); err != nil {
		t.Fatal(err)
	}
	if patches != 1 {
		t.Fatalf("wrong number of owner-fenced patches: %d", patches)
	}
}

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

package data

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

// ---------------------------------------------------------------------------
// EpochMillis — JSON marshal/unmarshal round-trip in milliseconds
// ---------------------------------------------------------------------------

func TestEpochMillisMarshalJSON_EncodesUnixMilliseconds(t *testing.T) {
	tm := time.Date(2026, 1, 2, 3, 4, 5, 6_000_000, time.UTC)
	wantMillis := tm.UnixMilli()

	encoded, err := EpochMillis(tm).MarshalJSON()
	if err != nil {
		t.Fatalf("MarshalJSON returned error: %v", err)
	}
	if got := strings.TrimSpace(string(encoded)); got != formatInt64(wantMillis) {
		t.Errorf("encoded = %q, want %q", got, formatInt64(wantMillis))
	}
}

func TestEpochMillisUnmarshalJSON_DecodesBackToTime(t *testing.T) {
	tm := time.Date(2026, 6, 8, 12, 0, 0, 0, time.UTC)
	encoded, err := json.Marshal(EpochMillis(tm))
	if err != nil {
		t.Fatalf("json.Marshal returned error: %v", err)
	}

	var decoded EpochMillis
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatalf("UnmarshalJSON returned error: %v", err)
	}

	if !time.Time(decoded).Equal(tm) {
		t.Errorf("decoded = %v, want %v", time.Time(decoded), tm)
	}
}

func TestEpochMillisUnmarshalJSON_ReturnsErrorOnInvalidJSON(t *testing.T) {
	var decoded EpochMillis
	err := decoded.UnmarshalJSON([]byte(`"not-a-number"`))
	if err == nil {
		t.Fatalf("expected error decoding non-numeric JSON")
	}
}

func formatInt64(n int64) string {
	// Helper to format an int64 the same way encoding/json does for numbers.
	b, _ := json.Marshal(n)
	return string(b)
}

// ---------------------------------------------------------------------------
// WebsocketConnectionInfo — ReachedTimeout / TimeLeft are pure timing helpers
// ---------------------------------------------------------------------------

func TestWebsocketConnectionInfoReachedTimeout_TrueWhenElapsed(t *testing.T) {
	info := WebsocketConnectionInfo{
		DisconnectStartTime: time.Now().Add(-1 * time.Hour),
		Timeout:             10 * time.Second,
	}
	if !info.ReachedTimeout() {
		t.Errorf("expected timeout to be reached for 1h-old disconnect with 10s timeout")
	}
}

func TestWebsocketConnectionInfoReachedTimeout_FalseWhenWithinWindow(t *testing.T) {
	info := WebsocketConnectionInfo{
		DisconnectStartTime: time.Now(),
		Timeout:             1 * time.Hour,
	}
	if info.ReachedTimeout() {
		t.Errorf("expected timeout NOT reached for fresh disconnect with 1h timeout")
	}
}

func TestWebsocketConnectionInfoTimeLeft_PositiveWhenWithinWindow(t *testing.T) {
	info := WebsocketConnectionInfo{
		DisconnectStartTime: time.Now(),
		Timeout:             1 * time.Hour,
	}
	left := info.TimeLeft()
	if left <= 0 {
		t.Errorf("TimeLeft = %v, want > 0", left)
	}
	if left > time.Hour {
		t.Errorf("TimeLeft = %v, want <= 1h", left)
	}
}

func TestWebsocketConnectionInfoTimeLeft_NegativeWhenElapsed(t *testing.T) {
	info := WebsocketConnectionInfo{
		DisconnectStartTime: time.Now().Add(-2 * time.Hour),
		Timeout:             1 * time.Hour,
	}
	if info.TimeLeft() >= 0 {
		t.Errorf("expected negative TimeLeft when elapsed; got %v", info.TimeLeft())
	}
}

// ---------------------------------------------------------------------------
// ExponentialBackoffWithJitter — capped at exponent 5, returns 0 for negatives
// ---------------------------------------------------------------------------

func TestExponentialBackoffWithJitter_ZeroRetryWithinExpectedRange(t *testing.T) {
	// retryCount=0 -> maxDelay = 1s, range [500ms, 1s)
	delay := ExponentialBackoffWithJitter(0)

	if delay < 500*time.Millisecond {
		t.Errorf("delay = %v, want >= 500ms", delay)
	}
	if delay >= time.Second {
		t.Errorf("delay = %v, want < 1s", delay)
	}
}

func TestExponentialBackoffWithJitter_HighRetryCappedAtExponentFive(t *testing.T) {
	// retryCount > 5 should cap exponent at 5: maxDelay = 32s, range [16s, 32s)
	delay := ExponentialBackoffWithJitter(99)

	if delay < 16*time.Second {
		t.Errorf("delay = %v, want >= 16s", delay)
	}
	if delay >= 32*time.Second {
		t.Errorf("delay = %v, want < 32s", delay)
	}
}

func TestExponentialBackoffWithJitter_NegativeReturnsZero(t *testing.T) {
	// 2^-100 ≈ 0 once converted to int64 nanoseconds, hits the maxDelay <= 0 branch.
	delay := ExponentialBackoffWithJitter(-100)
	if delay != 0 {
		t.Errorf("delay = %v, want 0 for very negative retryCount", delay)
	}
}

// ---------------------------------------------------------------------------
// CreateFolder — appends slash, creates nested directory
// ---------------------------------------------------------------------------

func TestCreateFolder_CreatesNestedDirectoryAndReturnsFullPath(t *testing.T) {
	root := t.TempDir()

	got := CreateFolder(root, "child")

	want := root + "/child"
	if got != want {
		t.Errorf("CreateFolder returned %q, want %q", got, want)
	}
	stat, err := os.Stat(want)
	if err != nil {
		t.Fatalf("expected directory at %q: %v", want, err)
	}
	if !stat.IsDir() {
		t.Errorf("expected %q to be a directory", want)
	}
}

func TestCreateFolder_NoOpWhenAlreadyExists(t *testing.T) {
	root := t.TempDir()
	pre := filepath.Join(root, "subfolder")
	if err := os.MkdirAll(pre, 0o777); err != nil {
		t.Fatalf("setup MkdirAll failed: %v", err)
	}

	got := CreateFolder(root+"/", "subfolder")

	if got != root+"/subfolder" {
		t.Errorf("CreateFolder returned %q, want %q", got, root+"/subfolder")
	}
	stat, err := os.Stat(got)
	if err != nil {
		t.Fatalf("expected existing directory at %q: %v", got, err)
	}
	if !stat.IsDir() {
		t.Errorf("expected %q to be a directory", got)
	}
}

// ---------------------------------------------------------------------------
// CollectBenchmarkMetrics — reads benchmark JSON files, ignores others
// ---------------------------------------------------------------------------

func TestCollectBenchmarkMetrics_NonexistentDirectoryReturnsNil(t *testing.T) {
	got := CollectBenchmarkMetrics("/path/does/not/exist/for/osmo/test")
	if got != nil {
		t.Errorf("expected nil for nonexistent directory, got %v", got)
	}
}

func TestCollectBenchmarkMetrics_ParsesValidJSONFiles(t *testing.T) {
	dir := t.TempDir()
	startTime := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	endTime := startTime.Add(2 * time.Second)
	bm := BenchmarkMetrics{
		StartTime:             EpochMillis(startTime),
		EndTime:               EpochMillis(endTime),
		TotalBytesTransferred: 1024,
		TotalNumberOfFiles:    3,
	}
	data, err := json.Marshal(bm)
	if err != nil {
		t.Fatalf("setup json.Marshal failed: %v", err)
	}
	filePath := filepath.Join(dir, "task1"+BenchmarkSuffix)
	if err := os.WriteFile(filePath, data, 0o644); err != nil {
		t.Fatalf("setup os.WriteFile failed: %v", err)
	}

	got := CollectBenchmarkMetrics(dir)

	if len(got) != 1 {
		t.Fatalf("expected 1 metric, got %d", len(got))
	}
	if got[0].TotalBytesTransferred != 1024 {
		t.Errorf("TotalBytesTransferred = %d, want 1024", got[0].TotalBytesTransferred)
	}
	if got[0].TotalNumberOfFiles != 3 {
		t.Errorf("TotalNumberOfFiles = %d, want 3", got[0].TotalNumberOfFiles)
	}
}

func TestCollectBenchmarkMetrics_SkipsDirectories(t *testing.T) {
	dir := t.TempDir()
	if err := os.Mkdir(filepath.Join(dir, "ignore"+BenchmarkSuffix), 0o777); err != nil {
		t.Fatalf("setup os.Mkdir failed: %v", err)
	}

	got := CollectBenchmarkMetrics(dir)

	if len(got) != 0 {
		t.Errorf("expected 0 metrics (directory skipped), got %d", len(got))
	}
}

func TestCollectBenchmarkMetrics_SkipsNonBenchmarkSuffixFiles(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "other.json"),
		[]byte(`{}`), 0o644); err != nil {
		t.Fatalf("setup os.WriteFile failed: %v", err)
	}

	got := CollectBenchmarkMetrics(dir)

	if len(got) != 0 {
		t.Errorf("expected 0 metrics (non-benchmark suffix), got %d", len(got))
	}
}

func TestCollectBenchmarkMetrics_SkipsMalformedJSON(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "bad"+BenchmarkSuffix),
		[]byte(`{not-json`), 0o644); err != nil {
		t.Fatalf("setup os.WriteFile failed: %v", err)
	}

	got := CollectBenchmarkMetrics(dir)

	if len(got) != 0 {
		t.Errorf("expected 0 metrics (malformed JSON skipped), got %d", len(got))
	}
}

// ---------------------------------------------------------------------------
// PrintDirContents — uses tree(1) to print a directory listing
// ---------------------------------------------------------------------------

func TestPrintDirContents_EmitsTreeOutputBelowTwentyLines(t *testing.T) {
	if _, err := os.Stat("/usr/bin/tree"); err != nil {
		t.Skipf("tree command not available: %v", err)
	}
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "a.txt"),
		[]byte("hello"), 0o644); err != nil {
		t.Fatalf("setup os.WriteFile failed: %v", err)
	}
	if err := os.WriteFile(filepath.Join(root, "b.txt"),
		[]byte("world"), 0o644); err != nil {
		t.Fatalf("setup os.WriteFile failed: %v", err)
	}

	osmoChan := make(chan string, 4)
	PrintDirContents(nil, root, 1, osmoChan)
	close(osmoChan)

	var collected []string
	for msg := range osmoChan {
		collected = append(collected, msg)
	}
	if len(collected) != 1 {
		t.Fatalf("expected 1 channel message, got %d (%v)", len(collected), collected)
	}
	if !strings.Contains(collected[0], "a.txt") || !strings.Contains(collected[0], "b.txt") {
		t.Errorf("expected tree output to mention both files, got: %q", collected[0])
	}
}

func TestPrintDirContents_TruncatesTreeOutputAboveTwentyLines(t *testing.T) {
	if _, err := os.Stat("/usr/bin/tree"); err != nil {
		t.Skipf("tree command not available: %v", err)
	}
	root := t.TempDir()
	// Create > 20 files so tree output exceeds the truncation threshold.
	for i := 0; i < 30; i++ {
		name := filepath.Join(root, "file_"+formatInt64(int64(i))+".txt")
		if err := os.WriteFile(name, []byte("x"), 0o644); err != nil {
			t.Fatalf("setup os.WriteFile failed: %v", err)
		}
	}

	osmoChan := make(chan string, 4)
	PrintDirContents(nil, root, 1, osmoChan)
	close(osmoChan)

	var collected []string
	for msg := range osmoChan {
		collected = append(collected, msg)
	}
	if len(collected) != 1 {
		t.Fatalf("expected 1 channel message, got %d", len(collected))
	}
	lines := strings.Split(collected[0], "\n")
	if len(lines) != 21 {
		t.Errorf("expected 21 lines (20 truncated + last summary), got %d", len(lines))
	}
}

// ---------------------------------------------------------------------------
// RunOSMOCommandWithRetry — success path, non-retriable failure path
// ---------------------------------------------------------------------------

func TestRunOSMOCommandWithRetry_ReturnsStdoutOnSuccess(t *testing.T) {
	WebsocketConnection = WebsocketConnectionInfo{}
	osmoChan := make(chan string, 16)

	outb := RunOSMOCommandWithRetry([]string{"sh", "-c", "printf hello"},
		1, osmoChan, 0)

	if outb.String() != "hello" {
		t.Errorf("stdout = %q, want %q", outb.String(), "hello")
	}
}

func TestRunOSMOCommandWithRetry_PanicsAfterRetriesOnNonRetriableExit(t *testing.T) {
	WebsocketConnection = WebsocketConnectionInfo{}
	osmoChan := make(chan string, 64)

	defer func() {
		if r := recover(); r == nil {
			t.Fatalf("expected panic after retry exhaustion")
		}
	}()

	RunOSMOCommandWithRetry([]string{"sh", "-c", "exit 1"}, 1, osmoChan, 0)
}

// ---------------------------------------------------------------------------
// RunOSMOCommandStreamingWithRetry — success path through the streaming
// goroutines. Exercises common.RunCommand end-to-end (the WaitGroup is now
// pre-incremented in the parent and the closures accept *sync.WaitGroup, so
// the streaming goroutines complete before RunCommand returns).
// ---------------------------------------------------------------------------

func TestRunOSMOCommandStreamingWithRetry_SucceedsOnFirstAttempt(t *testing.T) {
	WebsocketConnection = WebsocketConnectionInfo{}
	osmoChan := make(chan string, 64)

	RunOSMOCommandStreamingWithRetry(
		[]string{"sh", "-c", "echo streaming-ok"},
		[]string{"sh", "-c", "echo streaming-ok"},
		2, osmoChan, 0,
	)
	close(osmoChan)

	var collected []string
	for msg := range osmoChan {
		collected = append(collected, msg)
	}
	joined := strings.Join(collected, "\n")
	if !strings.Contains(joined, "streaming-ok") {
		t.Errorf("expected 'streaming-ok' in osmoChan messages, got: %v", collected)
	}
}

func TestCheckpoint_InvalidFrequencyReturnsImmediately(t *testing.T) {
	osmoChan := make(chan string, 8)
	stop := false
	var wg sync.WaitGroup
	wg.Add(1)

	Checkpoint(osmoChan, "/data;s3://bucket/url;not-a-number;*.bin", &wg, &stop)

	close(osmoChan)
	var collected []string
	for msg := range osmoChan {
		collected = append(collected, msg)
	}
	if len(collected) == 0 {
		t.Fatalf("expected at least one channel message about invalid frequency")
	}
	if !strings.Contains(collected[0], "Invalid checkpoint frequency") {
		t.Errorf("expected invalid frequency message, got: %q", collected[0])
	}
}

// ---------------------------------------------------------------------------
// createOutCommandStream / createErrCommandStream — call the returned closures
// directly with synthetic scanners so we cover the streaming bodies without
// going through common.RunCommand. The closures expect their caller to have
// already called wg.Add(1) (common.RunCommand pre-increments by 2).
// ---------------------------------------------------------------------------

func TestCreateOutCommandStream_StreamsScannerLinesToChannel(t *testing.T) {
	osmoChan := make(chan string, 16)
	streamFn := createOutCommandStream(osmoChan)

	scanner := bufio.NewScanner(strings.NewReader("alpha\nbeta\n"))

	// /usr/bin/true exits immediately. After Wait() the cmd.Process is still
	// non-nil so the watcher goroutine's Kill call (only reachable on
	// DataTimeout, which is 10 minutes) won't NPE if it ever ran.
	cmd := exec.Command("/usr/bin/true")
	if err := cmd.Start(); err != nil {
		t.Fatalf("start /usr/bin/true: %v", err)
	}
	if err := cmd.Wait(); err != nil {
		t.Fatalf("wait /usr/bin/true: %v", err)
	}

	var wg sync.WaitGroup
	wg.Add(1)
	timeoutChan := make(chan bool, 2)

	streamFn(cmd, scanner, &wg, timeoutChan)

	got1 := <-osmoChan
	got2 := <-osmoChan
	if got1 != "alpha" || got2 != "beta" {
		t.Errorf("channel = (%q, %q), want (alpha, beta)", got1, got2)
	}
	// streamOutCommand sends false to timeoutChan after a clean scan.
	if timedOut := <-timeoutChan; timedOut {
		t.Errorf("timeoutChan = true, want false on clean scanner exit")
	}
	wg.Wait()
}

func TestCreateErrCommandStream_StreamsScannerLinesToChannel(t *testing.T) {
	osmoChan := make(chan string, 16)
	streamFn := createErrCommandStream(osmoChan)

	scanner := bufio.NewScanner(strings.NewReader("err1\nerr2\n"))

	var wg sync.WaitGroup
	wg.Add(1)
	streamFn(scanner, &wg)

	got1 := <-osmoChan
	got2 := <-osmoChan
	if got1 != "err1" || got2 != "err2" {
		t.Errorf("channel = (%q, %q), want (err1, err2)", got1, got2)
	}
	wg.Wait()
}

// errReader returns the given error after `okReads` successful reads.
type errReader struct {
	data    []byte
	idx     int
	limit   int
	err     error
	reads   int
}

func (r *errReader) Read(p []byte) (int, error) {
	if r.reads >= r.limit {
		return 0, r.err
	}
	r.reads++
	if r.idx >= len(r.data) {
		return 0, r.err
	}
	n := copy(p, r.data[r.idx:])
	r.idx += n
	return n, nil
}

func TestCreateErrCommandStream_LogsScannerError(t *testing.T) {
	osmoChan := make(chan string, 16)
	streamFn := createErrCommandStream(osmoChan)

	// Scanner reads once, then returns an error from the underlying reader.
	scanner := bufio.NewScanner(&errReader{
		data:  []byte("partial\n"),
		limit: 1,
		err:   fmt.Errorf("synthetic stderr read error"),
	})

	var wg sync.WaitGroup
	wg.Add(1)
	streamFn(scanner, &wg)
	wg.Wait()

	close(osmoChan)
	var collected []string
	for msg := range osmoChan {
		collected = append(collected, msg)
	}
	// We expect "partial" then an "Error: ..." line.
	if len(collected) < 2 {
		t.Fatalf("expected at least 2 messages (data + error), got %v", collected)
	}
	if !strings.Contains(collected[len(collected)-1], "Error:") {
		t.Errorf("last message = %q, want one containing 'Error:'", collected[len(collected)-1])
	}
}

// ---------------------------------------------------------------------------
// SendDatasetSizeAndChecksum — the function executes `osmo dataset info ...`
// via RunOSMOCommandWithRetry. Wrapping the test so it captures the panic
// raised after the underlying retries exhaust (PATH=/nonexistent forces every
// attempt to fail with "executable file not found").
// ---------------------------------------------------------------------------

func TestSendDatasetSizeAndChecksum_PanicsAfterRetriesWhenOsmoMissing(t *testing.T) {
	WebsocketConnection = WebsocketConnectionInfo{}
	osmoChan := make(chan string, 256)
	t.Setenv("PATH", "/nonexistent")

	defer func() {
		if r := recover(); r == nil {
			t.Fatalf("expected panic after retry exhaustion in SendDatasetSizeAndChecksum")
		}
	}()

	_ = SendDatasetSizeAndChecksum(nil, "my-dataset", osmoChan)
}

func TestSendDatasetSizeAndChecksum_ReturnsURIFromFirstVersionOnSuccess(t *testing.T) {
	WebsocketConnection = WebsocketConnectionInfo{}
	osmoChan := make(chan string, 64)

	dir := t.TempDir()
	fakeOsmo := filepath.Join(dir, "osmo")
	// The fake "osmo" binary just emits a fixed JSON document with a single
	// version, so SendDatasetSizeAndChecksum hits the non-empty-Versions
	// branch and returns the version URI.
	jsonBody := `{"versions":[{"size":42,"checksum":"abc","uri":"s3://bucket/v1"}]}`
	script := "#!/bin/sh\nprintf '%s' '" + jsonBody + "'\n"
	if err := os.WriteFile(fakeOsmo, []byte(script), 0o755); err != nil {
		t.Fatalf("write fake osmo: %v", err)
	}
	t.Setenv("PATH", dir)

	uri := SendDatasetSizeAndChecksum(nil, "my-dataset", osmoChan)

	if uri != "s3://bucket/v1" {
		t.Errorf("uri = %q, want %q", uri, "s3://bucket/v1")
	}
}

func TestSendDatasetSizeAndChecksum_ReturnsEmptyWhenVersionsListIsEmpty(t *testing.T) {
	WebsocketConnection = WebsocketConnectionInfo{}
	osmoChan := make(chan string, 64)

	dir := t.TempDir()
	fakeOsmo := filepath.Join(dir, "osmo")
	// Empty versions list — should hit the `len(datasetInfo.Versions) == 0`
	// branch and return "".
	jsonBody := `{"versions":[]}`
	script := "#!/bin/sh\nprintf '%s' '" + jsonBody + "'\n"
	if err := os.WriteFile(fakeOsmo, []byte(script), 0o755); err != nil {
		t.Fatalf("write fake osmo: %v", err)
	}
	t.Setenv("PATH", dir)

	uri := SendDatasetSizeAndChecksum(nil, "my-dataset", osmoChan)

	if uri != "" {
		t.Errorf("uri = %q, want empty string", uri)
	}
}

// ---------------------------------------------------------------------------
// RunOSMOCommandWithRetry — exercise the exit-10 (cannot connect) and
// exit-75 (rate-limited) retriable branches via a temporary script that
// flips its exit code based on a marker file.
// ---------------------------------------------------------------------------

func TestRunOSMOCommandWithRetry_RetriesOnExitCode10ThenSucceeds(t *testing.T) {
	WebsocketConnection = WebsocketConnectionInfo{}
	osmoChan := make(chan string, 64)

	dir := t.TempDir()
	marker := filepath.Join(dir, "marker")
	scriptPath := filepath.Join(dir, "flip10.sh")
	script := fmt.Sprintf(
		"#!/bin/sh\nif [ -e %s ]; then printf hello; exit 0; fi\ntouch %s\nexit 10\n",
		marker, marker)
	if err := os.WriteFile(scriptPath, []byte(script), 0o755); err != nil {
		t.Fatalf("write script: %v", err)
	}

	outb := RunOSMOCommandWithRetry([]string{scriptPath}, 1, osmoChan, 0)

	if outb.String() != "hello" {
		t.Errorf("stdout = %q, want %q", outb.String(), "hello")
	}
}

func TestRunOSMOCommandWithRetry_RetriesOnExitCode75ThenSucceeds(t *testing.T) {
	WebsocketConnection = WebsocketConnectionInfo{}
	osmoChan := make(chan string, 64)

	dir := t.TempDir()
	marker := filepath.Join(dir, "marker")
	scriptPath := filepath.Join(dir, "flip75.sh")
	script := fmt.Sprintf(
		"#!/bin/sh\nif [ -e %s ]; then printf rate_ok; exit 0; fi\ntouch %s\nexit 75\n",
		marker, marker)
	if err := os.WriteFile(scriptPath, []byte(script), 0o755); err != nil {
		t.Fatalf("write script: %v", err)
	}

	outb := RunOSMOCommandWithRetry([]string{scriptPath}, 1, osmoChan, 0)

	if outb.String() != "rate_ok" {
		t.Errorf("stdout = %q, want %q", outb.String(), "rate_ok")
	}
}

// ---------------------------------------------------------------------------
// CreateFolder — panics when MkdirAll cannot create the directory because the
// parent is a file.
// ---------------------------------------------------------------------------

func TestCreateFolder_PanicsWhenParentIsAFile(t *testing.T) {
	dir := t.TempDir()
	// Write a regular file at the location we'll try to MkdirAll under.
	parent := filepath.Join(dir, "i_am_a_file")
	if err := os.WriteFile(parent, []byte("not-a-dir"), 0o600); err != nil {
		t.Fatalf("write parent file: %v", err)
	}

	defer func() {
		if r := recover(); r == nil {
			t.Fatalf("expected CreateFolder to panic when parent is a file")
		}
	}()

	_ = CreateFolder(parent, "child")
}

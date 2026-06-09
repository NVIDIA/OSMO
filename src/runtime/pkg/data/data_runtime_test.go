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
	"slices"
	"strings"
	"sync"
	"testing"
	"time"
)

// ---------------------------------------------------------------------------
// setOrUnsetEnv — sets when value is non-empty, unsets when empty
// ---------------------------------------------------------------------------

func TestSetOrUnsetEnv_SetsValueWhenNonEmpty(t *testing.T) {
	const key = "OSMO_TEST_SET_OR_UNSET_VAR"
	t.Setenv(key, "")
	os.Unsetenv(key)

	setOrUnsetEnv(key, "hello")

	got, present := os.LookupEnv(key)
	if !present {
		t.Fatalf("expected %s to be set after setOrUnsetEnv", key)
	}
	if got != "hello" {
		t.Errorf("env %s = %q, want %q", key, got, "hello")
	}
}

func TestSetOrUnsetEnv_UnsetsValueWhenEmpty(t *testing.T) {
	const key = "OSMO_TEST_SET_OR_UNSET_VAR2"
	t.Setenv(key, "preexisting")

	setOrUnsetEnv(key, "")

	if _, present := os.LookupEnv(key); present {
		t.Errorf("expected %s to be unset after setOrUnsetEnv with empty value", key)
	}
}

// ---------------------------------------------------------------------------
// awsForcePathStyleEnabled — recognised truthy strings
// ---------------------------------------------------------------------------

func TestAwsForcePathStyleEnabled_TrueWord(t *testing.T) {
	t.Setenv(awsS3ForcePathStyle, "true")
	if !awsForcePathStyleEnabled() {
		t.Errorf("expected true for AWS_S3_FORCE_PATH_STYLE=true")
	}
}

func TestAwsForcePathStyleEnabled_OneDigit(t *testing.T) {
	t.Setenv(awsS3ForcePathStyle, "1")
	if !awsForcePathStyleEnabled() {
		t.Errorf("expected true for AWS_S3_FORCE_PATH_STYLE=1")
	}
}

func TestAwsForcePathStyleEnabled_FalseWord(t *testing.T) {
	t.Setenv(awsS3ForcePathStyle, "false")
	if awsForcePathStyleEnabled() {
		t.Errorf("expected false for AWS_S3_FORCE_PATH_STYLE=false")
	}
}

func TestAwsForcePathStyleEnabled_Whitespace(t *testing.T) {
	t.Setenv(awsS3ForcePathStyle, "  TrUe  ")
	if !awsForcePathStyleEnabled() {
		t.Errorf("expected true for trimmed/lowercased value")
	}
}

// ---------------------------------------------------------------------------
// buildMountCommandArgs — cache-size branch produces --cache flags
// ---------------------------------------------------------------------------

func TestBuildMountCommandArgsWithPositiveCacheSize(t *testing.T) {
	t.Setenv(osmoS3AddressingStyle, "")
	t.Setenv(awsS3ForcePathStyle, "")
	backend := ParseStorageBackend("s3://aws-bucket/data")
	credential := DataCredential{}

	args := buildMountCommandArgs(backend, credential, "/mnt/input", "/mnt/cache", 512)

	if !slices.Contains(args, "--cache") {
		t.Fatalf("expected --cache flag in args: %v", args)
	}
	if !slices.Contains(args, "/mnt/cache") {
		t.Fatalf("expected cache path in args: %v", args)
	}
	if !slices.Contains(args, "--max-cache-size") {
		t.Fatalf("expected --max-cache-size flag in args: %v", args)
	}
	if !slices.Contains(args, "512") {
		t.Fatalf("expected cache size value in args: %v", args)
	}
	if !slices.Contains(args, "--metadata-ttl") {
		t.Fatalf("expected --metadata-ttl flag in args: %v", args)
	}
	if !slices.Contains(args, "indefinite") {
		t.Fatalf("expected metadata ttl 'indefinite' in args: %v", args)
	}
}

// ---------------------------------------------------------------------------
// MountMap.Load — adds new entries and collapses to common prefix
// ---------------------------------------------------------------------------

func TestMountMapLoad_AddsNewEntryWhenMountBaseUnseen(t *testing.T) {
	mountMap := MountMap{
		lock:      sync.Mutex{},
		locations: make(map[string]MountLocation),
	}

	mountMap.Load("s3://bucket1/data1")

	got, ok := mountMap.locations["s3://bucket1"]
	if !ok {
		t.Fatalf("expected mount base s3://bucket1 to be present, locations: %v",
			mountMap.locations)
	}
	if got.URI != "s3://bucket1/data1" {
		t.Errorf("URI = %q, want %q", got.URI, "s3://bucket1/data1")
	}
}

func TestMountMapLoad_CollapsesToLongestCommonPathPrefix(t *testing.T) {
	mountMap := MountMap{
		lock:      sync.Mutex{},
		locations: make(map[string]MountLocation),
	}

	mountMap.Load("s3://bucket1/foo/bar")
	mountMap.Load("s3://bucket1/foo/baz")

	got, ok := mountMap.locations["s3://bucket1"]
	if !ok {
		t.Fatalf("expected mount base s3://bucket1, got: %v", mountMap.locations)
	}
	if got.URI != "s3://bucket1/foo/" {
		t.Errorf("URI = %q, want %q (longest common path prefix)",
			got.URI, "s3://bucket1/foo/")
	}
}

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
// ParseMountLocations — reads JSON manifest, collapses non-hash storage paths
// ---------------------------------------------------------------------------

func writeManifestFile(t *testing.T, dir string, objects []ManifestObject) string {
	t.Helper()
	path := filepath.Join(dir, "manifest.json")
	data, err := json.Marshal(objects)
	if err != nil {
		t.Fatalf("setup json.Marshal failed: %v", err)
	}
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatalf("setup os.WriteFile failed: %v", err)
	}
	return path
}

func TestParseMountLocations_NonexistentFileReturnsError(t *testing.T) {
	_, err := ParseMountLocations("/nonexistent/manifest.json", "s3://hashes/")
	if err == nil {
		t.Errorf("expected error opening missing manifest")
	}
}

func TestParseMountLocations_AggregatesStoragePathsByMountBase(t *testing.T) {
	dir := t.TempDir()
	manifestPath := writeManifestFile(t, dir, []ManifestObject{
		{RelativePath: "a.txt", StoragePath: "s3://data-bucket/foo/a.txt"},
		{RelativePath: "b.txt", StoragePath: "s3://data-bucket/foo/b.txt"},
	})

	locations, err := ParseMountLocations(manifestPath, "s3://hashes-bucket/")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	got, ok := locations["s3://data-bucket"]
	if !ok {
		t.Fatalf("expected mount base s3://data-bucket, got: %v", locations)
	}
	if got.URI != "s3://data-bucket/foo/" {
		t.Errorf("URI = %q, want %q", got.URI, "s3://data-bucket/foo/")
	}
}

func TestParseMountLocations_LoadsHashUriWhenManifestReferencesIt(t *testing.T) {
	dir := t.TempDir()
	manifestPath := writeManifestFile(t, dir, []ManifestObject{
		{RelativePath: "x", StoragePath: "s3://hashes-bucket/abc/123"},
	})

	locations, err := ParseMountLocations(manifestPath, "s3://hashes-bucket/")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Only the hash URI itself should be loaded (via the post-loop hashFolderUsed branch).
	got, ok := locations["s3://hashes-bucket"]
	if !ok {
		t.Fatalf("expected mount base s3://hashes-bucket, got: %v", locations)
	}
	if got.URI != "s3://hashes-bucket/" {
		t.Errorf("URI = %q, want %q", got.URI, "s3://hashes-bucket/")
	}
}

// ---------------------------------------------------------------------------
// LinkManifest — creates symlinks under destination for each manifest entry
// ---------------------------------------------------------------------------

func TestLinkManifest_NonexistentManifestReturnsError(t *testing.T) {
	err := LinkManifest("/nonexistent/manifest.json", map[string]MountLocation{}, "/tmp/")
	if err == nil {
		t.Errorf("expected error opening missing manifest")
	}
}

func TestLinkManifest_CreatesSymlinksForManifestEntries(t *testing.T) {
	root := t.TempDir()
	mountFolder := filepath.Join(root, "mount")
	if err := os.MkdirAll(mountFolder, 0o777); err != nil {
		t.Fatalf("setup MkdirAll failed: %v", err)
	}
	destination := filepath.Join(root, "dest") + "/"
	manifestPath := writeManifestFile(t, root, []ManifestObject{
		{RelativePath: "out/a.txt", StoragePath: "s3://data-bucket/foo/a.txt"},
	})
	mountLocations := map[string]MountLocation{
		"s3://data-bucket": {Folder: mountFolder, URI: "s3://data-bucket/foo/"},
	}

	if err := LinkManifest(manifestPath, mountLocations, destination); err != nil {
		t.Fatalf("LinkManifest returned error: %v", err)
	}

	target := destination + "out/a.txt"
	link, err := os.Readlink(target)
	if err != nil {
		t.Fatalf("expected symlink at %q: %v", target, err)
	}
	wantSource := mountFolder + "/a.txt"
	if link != wantSource {
		t.Errorf("symlink target = %q, want %q", link, wantSource)
	}
}

func TestLinkManifest_SkipsEntriesWithEmptyMountFolder(t *testing.T) {
	root := t.TempDir()
	destination := filepath.Join(root, "dest") + "/"
	manifestPath := writeManifestFile(t, root, []ManifestObject{
		{RelativePath: "out/a.txt", StoragePath: "s3://data-bucket/foo/a.txt"},
	})
	mountLocations := map[string]MountLocation{
		"s3://data-bucket": {Folder: "", URI: "s3://data-bucket/foo/"},
	}

	if err := LinkManifest(manifestPath, mountLocations, destination); err != nil {
		t.Fatalf("LinkManifest returned error: %v", err)
	}

	target := destination + "out/a.txt"
	if _, err := os.Lstat(target); !os.IsNotExist(err) {
		t.Errorf("expected no symlink for empty mount folder, got err=%v", err)
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

// ---------------------------------------------------------------------------
// MountURL — supported / unsupported download type branches
// ---------------------------------------------------------------------------

func TestMountURL_UnsupportedDownloadTypeReturnsTrueWithoutPanic(t *testing.T) {
	osmoChan := make(chan string, 8)

	got := MountURL("unsupported_type", ConfigInfo{}, "s3://bucket/path",
		"/tmp/does-not-need-to-exist", "/tmp/cache-not-needed", 0, osmoChan)

	if !got {
		t.Errorf("expected isEmpty=true for unsupported download type, got false")
	}
}

func TestMountURL_AppliesProvidedAwsCredentialsToEnv(t *testing.T) {
	t.Setenv("AWS_ACCESS_KEY_ID", "stale-access")
	t.Setenv("AWS_SECRET_ACCESS_KEY", "stale-secret")
	t.Setenv("AWS_REGION", "stale-region")
	t.Setenv("AWS_SESSION_TOKEN", "stale-session")
	osmoChan := make(chan string, 8)

	credential := DataCredential{
		AccessKeyId: "AKIAEXAMPLE",
		AccessKey:   "secret-value",
		Region:      "us-west-2",
	}
	cfg := ConfigInfo{Auth: DataConfig{Data: map[string]DataCredential{
		"s3://demo-bucket": credential,
	}}}

	_ = MountURL("unsupported_type", cfg, "s3://demo-bucket/path",
		"/tmp/no-mount", "/tmp/no-cache", 0, osmoChan)

	if got := os.Getenv("AWS_ACCESS_KEY_ID"); got != "AKIAEXAMPLE" {
		t.Errorf("AWS_ACCESS_KEY_ID = %q, want %q", got, "AKIAEXAMPLE")
	}
	if got := os.Getenv("AWS_SECRET_ACCESS_KEY"); got != "secret-value" {
		t.Errorf("AWS_SECRET_ACCESS_KEY = %q, want %q", got, "secret-value")
	}
	if got := os.Getenv("AWS_REGION"); got != "us-west-2" {
		t.Errorf("AWS_REGION = %q, want %q", got, "us-west-2")
	}
	if _, present := os.LookupEnv("AWS_SESSION_TOKEN"); present {
		t.Errorf("AWS_SESSION_TOKEN must always be unset by MountURL")
	}
}

func TestMountURL_ClearsAwsEnvWhenNoCredentialMatches(t *testing.T) {
	t.Setenv("AWS_ACCESS_KEY_ID", "should-be-cleared")
	t.Setenv("AWS_SECRET_ACCESS_KEY", "should-be-cleared")
	t.Setenv("AWS_REGION", "should-be-cleared")
	osmoChan := make(chan string, 8)

	_ = MountURL("unsupported_type", ConfigInfo{}, "s3://no-match/path",
		"/tmp/no-mount", "/tmp/no-cache", 0, osmoChan)

	if _, present := os.LookupEnv("AWS_ACCESS_KEY_ID"); present {
		t.Errorf("AWS_ACCESS_KEY_ID should be unset when no credential matches")
	}
	if _, present := os.LookupEnv("AWS_SECRET_ACCESS_KEY"); present {
		t.Errorf("AWS_SECRET_ACCESS_KEY should be unset when no credential matches")
	}
	if _, present := os.LookupEnv("AWS_REGION"); present {
		t.Errorf("AWS_REGION should be unset when no credential matches")
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
// MountURL Mountpoint retry path — uses /usr/bin/true as a no-op stand-in
// for mount-s3 so cmd.Run() succeeds, IsDirEmpty stays true, and the loop
// runs the full MountRetryCount before returning isEmpty=true.
// ---------------------------------------------------------------------------

func TestMountURL_RunsMountLoopAndReturnsEmptyWhenMountStaysEmpty(t *testing.T) {
	t.Setenv("MOUNT_S3_PATH", "/usr/bin/true")
	osmoChan := make(chan string, 64)

	root := t.TempDir()
	cachePath := filepath.Join(root, "cache")
	if err := os.MkdirAll(cachePath, 0o755); err != nil {
		t.Fatalf("setup MkdirAll cache failed: %v", err)
	}
	localPath := filepath.Join(root, "mount")
	if err := os.MkdirAll(localPath, 0o755); err != nil {
		t.Fatalf("setup MkdirAll mount failed: %v", err)
	}

	got := MountURL(Mountpoint, ConfigInfo{}, "s3://test-bucket/data",
		localPath, cachePath, 0, osmoChan)

	if !got {
		t.Errorf("expected isEmpty=true when mount target stays empty, got false")
	}
}

func TestMountURL_PanicsWhenMountCommandFailsWithGenericError(t *testing.T) {
	// /usr/bin/false exits with status 1; the error string contains neither
	// "Timeout" nor "is already mounted", so MountURL takes the LogError
	// branch (which panics).
	t.Setenv("MOUNT_S3_PATH", "/usr/bin/false")
	osmoChan := make(chan string, 64)

	root := t.TempDir()
	cachePath := filepath.Join(root, "cache")
	if err := os.MkdirAll(cachePath, 0o755); err != nil {
		t.Fatalf("setup MkdirAll cache failed: %v", err)
	}
	localPath := filepath.Join(root, "mount")
	if err := os.MkdirAll(localPath, 0o755); err != nil {
		t.Fatalf("setup MkdirAll mount failed: %v", err)
	}

	defer func() {
		if r := recover(); r == nil {
			t.Fatalf("expected MountURL to panic on generic mount error")
		}
	}()

	_ = MountURL(Mountpoint, ConfigInfo{}, "s3://test-bucket/data",
		localPath, cachePath, 0, osmoChan)
}

func TestMountURL_BreaksOutOfLoopWhenLocalPathHasContent(t *testing.T) {
	t.Setenv("MOUNT_S3_PATH", "/usr/bin/true")
	osmoChan := make(chan string, 64)

	root := t.TempDir()
	cachePath := filepath.Join(root, "cache")
	if err := os.MkdirAll(cachePath, 0o755); err != nil {
		t.Fatalf("setup MkdirAll cache failed: %v", err)
	}
	localPath := filepath.Join(root, "mount")
	if err := os.MkdirAll(localPath, 0o755); err != nil {
		t.Fatalf("setup MkdirAll mount failed: %v", err)
	}
	// Pre-populate so IsDirEmpty returns false on the first iteration and
	// the loop's `if !isEmpty { break }` branch fires.
	if err := os.WriteFile(filepath.Join(localPath, "marker"),
		[]byte("hello"), 0o600); err != nil {
		t.Fatalf("setup write marker failed: %v", err)
	}

	got := MountURL(Mountpoint, ConfigInfo{}, "s3://test-bucket/data",
		localPath, cachePath, 0, osmoChan)

	if got {
		t.Errorf("expected isEmpty=false when mount target has content, got true")
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

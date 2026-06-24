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
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"go.corp.nvidia.com/osmo/runtime/pkg/common"
	"go.corp.nvidia.com/osmo/runtime/pkg/metrics"
)

// ---------------------------------------------------------------------------
// ParseInputOutput — task prefix
// ---------------------------------------------------------------------------

func TestParseInputOutput_TaskInput_ThreeCommaFieldsReturnsTaskInput(t *testing.T) {
	got := ParseInputOutput("task:myfolder,http://host/path/data.tar,*.txt")

	want := TaskInput{
		Folder: "myfolder",
		Name:   "data.tar",
		Url:    "http://host/path/data.tar",
		Regex:  "*.txt",
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("ParseInputOutput task-input mismatch:\n got:  %#v\n want: %#v", got, want)
	}
}

func TestParseInputOutput_TaskInput_NameIsUrlBasenameAfterLastSlash(t *testing.T) {
	got := ParseInputOutput("task:folder,s3://bucket/a/b/c.bin,regex")

	taskInput, ok := got.(TaskInput)
	if !ok {
		t.Fatalf("expected TaskInput, got %T", got)
	}
	if taskInput.Name != "c.bin" {
		t.Errorf("Name = %q, want %q (basename after last slash)", taskInput.Name, "c.bin")
	}
}

func TestParseInputOutput_TaskInput_UrlWithoutSlashesKeepsWholeAsName(t *testing.T) {
	// LastIndex returns -1 for no slash; +1 yields index 0 so Name == full string.
	got := ParseInputOutput("task:folder,bare_url,regex")

	taskInput, ok := got.(TaskInput)
	if !ok {
		t.Fatalf("expected TaskInput, got %T", got)
	}
	if taskInput.Name != "bare_url" {
		t.Errorf("Name = %q, want %q", taskInput.Name, "bare_url")
	}
}

func TestParseInputOutput_TaskOutput_SingleFieldReturnsTaskOutput(t *testing.T) {
	got := ParseInputOutput("task:s3://bucket/output/file")

	taskOutput, ok := got.(*TaskOutput)
	if !ok {
		t.Fatalf("expected *TaskOutput, got %T", got)
	}
	if taskOutput.Url != "s3://bucket/output/file" {
		t.Errorf("Url = %q, want %q", taskOutput.Url, "s3://bucket/output/file")
	}
	if taskOutput.Name != "file" {
		t.Errorf("Name = %q, want %q", taskOutput.Name, "file")
	}
}

// ---------------------------------------------------------------------------
// ParseInputOutput — url prefix
// ---------------------------------------------------------------------------

func TestParseInputOutput_UrlInput_ThreeFieldsReturnsUrlInput(t *testing.T) {
	got := ParseInputOutput("url:inputs,http://example.com/data,*.json")

	want := UrlInput{
		Folder: "inputs",
		Url:    "http://example.com/data",
		Regex:  "*.json",
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("ParseInputOutput url-input mismatch:\n got:  %#v\n want: %#v", got, want)
	}
}

func TestParseInputOutput_UrlOutput_TwoFieldsReturnsUrlOutput(t *testing.T) {
	got := ParseInputOutput("url:http://example.com/data,*.json")

	urlOutput, ok := got.(*UrlOutput)
	if !ok {
		t.Fatalf("expected *UrlOutput, got %T", got)
	}
	want := &UrlOutput{Url: "http://example.com/data", Regex: "*.json"}
	if !reflect.DeepEqual(urlOutput, want) {
		t.Errorf("UrlOutput mismatch:\n got:  %#v\n want: %#v", urlOutput, want)
	}
}

// ---------------------------------------------------------------------------
// ParseInputOutput — kpi prefix
// ---------------------------------------------------------------------------

func TestParseInputOutput_Kpi_ReturnsKpiOutput(t *testing.T) {
	got := ParseInputOutput("kpi:http://metrics.example,results/metrics.json")

	kpi, ok := got.(*KpiOutput)
	if !ok {
		t.Fatalf("expected *KpiOutput, got %T", got)
	}
	want := &KpiOutput{
		Url:  "http://metrics.example",
		Path: "results/metrics.json",
	}
	if !reflect.DeepEqual(kpi, want) {
		t.Errorf("KpiOutput mismatch:\n got:  %#v\n want: %#v", kpi, want)
	}
}

// ---------------------------------------------------------------------------
// ParseInputOutput — error path
// ---------------------------------------------------------------------------

func TestParseInputOutput_UnknownPrefix_Panics(t *testing.T) {
	defer func() {
		r := recover()
		if r == nil {
			t.Fatalf("expected panic for unknown prefix, got none")
		}
	}()

	_ = ParseInputOutput("bogus:some-payload")
}

// ---------------------------------------------------------------------------
// GetLogInfo / GetUrlIdentifier / GetFolder — pure accessors
// ---------------------------------------------------------------------------

func TestTaskInput_Accessors(t *testing.T) {
	ti := TaskInput{Folder: "f", Name: "n", Url: "u", Regex: "r"}

	if got := ti.GetLogInfo(); got != "n" {
		t.Errorf("GetLogInfo = %q, want %q", got, "n")
	}
	if got := ti.GetUrlIdentifier(); got != "u" {
		t.Errorf("GetUrlIdentifier = %q, want %q", got, "u")
	}
	if got := ti.GetFolder(); got != "f" {
		t.Errorf("GetFolder = %q, want %q", got, "f")
	}
}

func TestTaskOutput_Accessors(t *testing.T) {
	to := TaskOutput{Name: "n", Url: "u"}

	if got := to.GetLogInfo(); got != "n" {
		t.Errorf("GetLogInfo = %q, want %q", got, "n")
	}
	if got := to.GetUrlIdentifier(); got != "u" {
		t.Errorf("GetUrlIdentifier = %q, want %q", got, "u")
	}
}

func TestUrlInput_Accessors(t *testing.T) {
	ui := UrlInput{Folder: "f", Url: "u", Regex: "r"}

	if got := ui.GetLogInfo(); got != "u" {
		t.Errorf("GetLogInfo = %q, want %q", got, "u")
	}
	if got := ui.GetUrlIdentifier(); got != "u" {
		t.Errorf("GetUrlIdentifier = %q, want %q", got, "u")
	}
	if got := ui.GetFolder(); got != "f" {
		t.Errorf("GetFolder = %q, want %q", got, "f")
	}
}

func TestUrlOutput_Accessors(t *testing.T) {
	uo := UrlOutput{Url: "u", Regex: "r"}

	if got := uo.GetLogInfo(); got != "u" {
		t.Errorf("GetLogInfo = %q, want %q", got, "u")
	}
	if got := uo.GetUrlIdentifier(); got != "u" {
		t.Errorf("GetUrlIdentifier = %q, want %q", got, "u")
	}
}

func TestKpiOutput_Accessors(t *testing.T) {
	kpi := KpiOutput{Url: "http://m.example", Path: "results/m.json"}

	if got := kpi.GetLogInfo(); got != "KPI: results/m.json" {
		t.Errorf("GetLogInfo = %q, want %q", got, "KPI: results/m.json")
	}
	if got := kpi.GetUrlIdentifier(); got != "http://m.example/results/m.json" {
		t.Errorf("GetUrlIdentifier = %q, want %q", got, "http://m.example/results/m.json")
	}
}

// ---------------------------------------------------------------------------
// ValidateDataAuth — exercises the URL READ/WRITE dispatch, JSON parsing,
// and pass/fail/unknown status handling. The function shells out to `osmo`,
// so each test stages a fake `osmo` binary on PATH that emits the JSON
// payload the test wants to assert against. Non-URL types (TaskInput,
// TaskOutput, KpiOutput) bypass the shellout entirely, so those tests do
// not need PATH manipulation.
// ---------------------------------------------------------------------------

// stageFakeOsmo writes a shell script as the only `osmo` on PATH and returns
// the directory holding it. Caller is responsible for `t.Setenv("PATH", dir)`.
// A no-op fake `tree` is also written so PrintDirContents calls during the
// Download tests resolve via PATH instead of falling through to the absolute
// /usr/bin/tree fallback, which isn't installed in every CI container.
func stageFakeOsmo(t *testing.T, body string) string {
	t.Helper()
	dir := t.TempDir()
	fakeOsmo := filepath.Join(dir, "osmo")
	if err := os.WriteFile(fakeOsmo, []byte(body), 0o755); err != nil {
		t.Fatalf("write fake osmo: %v", err)
	}
	fakeTree := filepath.Join(dir, "tree")
	if err := os.WriteFile(fakeTree, []byte("#!/bin/sh\nexit 0\n"), 0o755); err != nil {
		t.Fatalf("write fake tree: %v", err)
	}
	return dir
}

func TestValidateDataAuth_TaskInput_ReturnsNilWithoutShellout(t *testing.T) {
	osmoChan := make(chan string, 16)

	err := ValidateDataAuth(
		"task:myfolder,http://host/path/data.tar,*.txt", "/cfg.yaml", osmoChan)

	if err != nil {
		t.Errorf("expected nil for TaskInput, got %v", err)
	}
}

func TestValidateDataAuth_TaskOutput_ReturnsNilWithoutShellout(t *testing.T) {
	osmoChan := make(chan string, 16)

	err := ValidateDataAuth(
		"task:s3://bucket/output/file", "/cfg.yaml", osmoChan)

	if err != nil {
		t.Errorf("expected nil for TaskOutput, got %v", err)
	}
}

func TestValidateDataAuth_KpiOutput_ReturnsNilWithoutShellout(t *testing.T) {
	osmoChan := make(chan string, 16)

	err := ValidateDataAuth(
		"kpi:http://metrics.example,results/metrics.json", "/cfg.yaml", osmoChan)

	if err != nil {
		t.Errorf("expected nil for KpiOutput, got %v", err)
	}
}

func TestValidateDataAuth_UrlInput_PassReturnsNilAndAnnouncesRead(t *testing.T) {
	WebsocketConnection = WebsocketConnectionInfo{}
	osmoChan := make(chan string, 64)

	dir := stageFakeOsmo(t, "#!/bin/sh\nprintf '{\"status\":\"pass\"}'\n")
	t.Setenv("PATH", dir)

	err := ValidateDataAuth(
		"url:inputs,http://example.com/data,*.json", "/cfg.yaml", osmoChan)

	if err != nil {
		t.Fatalf("expected nil error, got %v", err)
	}
	close(osmoChan)
	var sawRead, sawSuccess bool
	for msg := range osmoChan {
		if strings.Contains(msg, "Validating READ access") {
			sawRead = true
		}
		if strings.Contains(msg, "Data auth validation successful") {
			sawSuccess = true
		}
	}
	if !sawRead {
		t.Errorf("expected READ-access announce on osmoChan, got none")
	}
	if !sawSuccess {
		t.Errorf("expected success announce on osmoChan, got none")
	}
}

func TestValidateDataAuth_UrlInput_FailReturnsErrorWithDetail(t *testing.T) {
	WebsocketConnection = WebsocketConnectionInfo{}
	osmoChan := make(chan string, 64)

	dir := stageFakeOsmo(t,
		"#!/bin/sh\nprintf '{\"status\":\"fail\",\"error\":\"forbidden\"}'\n")
	t.Setenv("PATH", dir)

	err := ValidateDataAuth(
		"url:inputs,http://example.com/data,*.json", "/cfg.yaml", osmoChan)

	if err == nil {
		t.Fatal("expected error for fail status")
	}
	if !strings.Contains(err.Error(), "Data auth validation failed") {
		t.Errorf("expected 'Data auth validation failed' in error, got: %v", err)
	}
	if !strings.Contains(err.Error(), "forbidden") {
		t.Errorf("expected upstream error detail in error, got: %v", err)
	}
}

func TestValidateDataAuth_UrlInput_UnknownStatusReturnsError(t *testing.T) {
	WebsocketConnection = WebsocketConnectionInfo{}
	osmoChan := make(chan string, 64)

	dir := stageFakeOsmo(t,
		"#!/bin/sh\nprintf '{\"status\":\"weird\"}'\n")
	t.Setenv("PATH", dir)

	err := ValidateDataAuth(
		"url:inputs,http://example.com/data,*.json", "/cfg.yaml", osmoChan)

	if err == nil {
		t.Fatal("expected error for unknown status")
	}
	if !strings.Contains(err.Error(), "unknown data auth validation status") {
		t.Errorf("expected unknown-status error, got: %v", err)
	}
}

func TestValidateDataAuth_UrlInput_InvalidJSONReturnsParseError(t *testing.T) {
	WebsocketConnection = WebsocketConnectionInfo{}
	osmoChan := make(chan string, 64)

	dir := stageFakeOsmo(t, "#!/bin/sh\nprintf 'not-json'\n")
	t.Setenv("PATH", dir)

	err := ValidateDataAuth(
		"url:inputs,http://example.com/data,*.json", "/cfg.yaml", osmoChan)

	if err == nil {
		t.Fatal("expected error for non-JSON response")
	}
	if !strings.Contains(err.Error(), "Failed to parse validation response") {
		t.Errorf("expected parse-failure error, got: %v", err)
	}
}

// UrlOutput hits the *UrlOutput switch arm, which dispatches with
// --access-type WRITE. The fake osmo emits "fail" if WRITE is missing so a
// regression that swaps READ/WRITE fails this test.
func TestValidateDataAuth_UrlOutput_PassDispatchesWriteAccess(t *testing.T) {
	WebsocketConnection = WebsocketConnectionInfo{}
	osmoChan := make(chan string, 64)

	dir := stageFakeOsmo(t, `#!/bin/sh
for a in "$@"; do
  if [ "$a" = "WRITE" ]; then
    printf '{"status":"pass"}'
    exit 0
  fi
done
printf '{"status":"fail","error":"WRITE access flag missing"}'
`)
	t.Setenv("PATH", dir)

	err := ValidateDataAuth(
		"url:http://example.com/data,*.json", "/cfg.yaml", osmoChan)

	if err != nil {
		t.Fatalf("expected nil error for WRITE+pass, got %v", err)
	}
	close(osmoChan)
	var sawWrite bool
	for msg := range osmoChan {
		if strings.Contains(msg, "Validating WRITE access") {
			sawWrite = true
		}
	}
	if !sawWrite {
		t.Errorf("expected WRITE-access announce on osmoChan, got none")
	}
}

func TestValidateDataAuth_UrlOutput_FailReturnsErrorWithDetail(t *testing.T) {
	WebsocketConnection = WebsocketConnectionInfo{}
	osmoChan := make(chan string, 64)

	dir := stageFakeOsmo(t,
		"#!/bin/sh\nprintf '{\"status\":\"fail\",\"error\":\"denied\"}'\n")
	t.Setenv("PATH", dir)

	err := ValidateDataAuth(
		"url:http://example.com/data,*.json", "/cfg.yaml", osmoChan)

	if err == nil {
		t.Fatal("expected error for fail status on UrlOutput")
	}
	if !strings.Contains(err.Error(), "denied") {
		t.Errorf("expected upstream error detail in error, got: %v", err)
	}
}

// ---------------------------------------------------------------------------
// ValidateInputsOutputsAccess — wraps ValidateDataAuth in a loop over inputs
// and outputs. Empty list path emits the bookend messages and returns nil;
// failure short-circuits and propagates the error.
// ---------------------------------------------------------------------------

func TestValidateInputsOutputsAccess_EmptyListsAnnouncesAndReturnsNil(t *testing.T) {
	osmoChan := make(chan string, 16)

	err := ValidateInputsOutputsAccess(
		common.ArrayFlags{}, common.ArrayFlags{}, "/cfg.yaml", osmoChan)
	close(osmoChan)

	if err != nil {
		t.Fatalf("expected nil error, got %v", err)
	}
	var collected []string
	for msg := range osmoChan {
		collected = append(collected, msg)
	}
	if len(collected) != 2 {
		t.Fatalf("expected 2 messages (start, end), got %d (%v)", len(collected), collected)
	}
	if !strings.Contains(collected[0], "Validating data access permissions") {
		t.Errorf("expected start message, got %q", collected[0])
	}
	if !strings.Contains(collected[len(collected)-1], "All data access validations passed") {
		t.Errorf("expected end message, got %q", collected[len(collected)-1])
	}
}

func TestValidateInputsOutputsAccess_TaskAndKpiItems_ReturnsNilSkippingShellout(t *testing.T) {
	// Task and Kpi items are no-ops in ValidateDataAuth, so this whole loop
	// returns nil without ever invoking osmo on PATH.
	osmoChan := make(chan string, 16)

	inputs := common.ArrayFlags{"task:f,http://h/p/d.tar,*.txt"}
	outputs := common.ArrayFlags{"task:s3://bucket/file", "kpi:http://m,results/m.json"}

	err := ValidateInputsOutputsAccess(inputs, outputs, "/cfg.yaml", osmoChan)

	if err != nil {
		t.Fatalf("expected nil error, got %v", err)
	}
}

func TestValidateInputsOutputsAccess_UrlInputFailShortCircuits(t *testing.T) {
	WebsocketConnection = WebsocketConnectionInfo{}
	osmoChan := make(chan string, 64)

	dir := stageFakeOsmo(t,
		"#!/bin/sh\nprintf '{\"status\":\"fail\",\"error\":\"nope\"}'\n")
	t.Setenv("PATH", dir)

	inputs := common.ArrayFlags{
		"url:in,http://example.com/data,*.json",
		// Second input would have run too, but the first error short-circuits.
		"url:in2,http://example.com/data2,*.json",
	}

	err := ValidateInputsOutputsAccess(inputs, common.ArrayFlags{}, "/cfg.yaml", osmoChan)

	if err == nil {
		t.Fatal("expected error to propagate from the first failing item")
	}
	if !strings.Contains(err.Error(), "nope") {
		t.Errorf("expected upstream error detail in propagated error, got: %v", err)
	}
}

// ---------------------------------------------------------------------------
// Download / UploadFolder — cover the per-type metric pipelines plus the
// surrounding folder/log/channel behavior. Each test:
//  1. Redirects BenchmarkPath to a writable tempdir (production default
//     "/osmo/data/benchmarks/" is not writable in the bazel test sandbox).
//  2. Stages a fake `osmo` so DownloadURI / UploadData succeed without doing
//     real work.
//  3. Pre-populates BenchmarkPath/<expected-folder>/x_benchmark.json with a
//     payload that has bytes>0, plus an empty-bytes entry to force the
//     `if benchmark.TotalBytesTransferred == 0 { continue }` skip branch.
//  4. Invokes the method on a real (temp-dir) inputPath/outputPath.
// ---------------------------------------------------------------------------

// redirectBenchmarkPath points BenchmarkPath at a per-test tempdir so the
// metric loop bodies in TaskInput/TaskOutput/UrlInput/UrlOutput/KpiOutput can
// execute against pre-staged benchmark files. The original value is restored
// on test cleanup.
func redirectBenchmarkPath(t *testing.T) {
	t.Helper()
	original := BenchmarkPath
	BenchmarkPath = t.TempDir() + "/"
	t.Cleanup(func() { BenchmarkPath = original })
}

// stageBenchmarkFiles writes one benchmark JSON with bytes=1024 (passes the
// non-zero check) and one with bytes=0 (skipped via continue) under
// BenchmarkPath/<folder>.
func stageBenchmarkFiles(t *testing.T, folder string) {
	t.Helper()
	dir := BenchmarkPath + folder
	if err := os.MkdirAll(dir, 0o777); err != nil {
		t.Fatalf("MkdirAll %q: %v", dir, err)
	}

	startTime := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	ok := BenchmarkMetrics{
		StartTime:             EpochMillis(startTime),
		EndTime:               EpochMillis(startTime.Add(2 * time.Second)),
		TotalBytesTransferred: 1024,
		TotalNumberOfFiles:    3,
	}
	zero := BenchmarkMetrics{
		StartTime:             EpochMillis(startTime),
		EndTime:               EpochMillis(startTime),
		TotalBytesTransferred: 0,
		TotalNumberOfFiles:    0,
	}
	for name, payload := range map[string]BenchmarkMetrics{
		"good_benchmark.json": ok,
		"zero_benchmark.json": zero,
	} {
		body, err := json.Marshal(payload)
		if err != nil {
			t.Fatalf("marshal %s: %v", name, err)
		}
		if err := os.WriteFile(filepath.Join(dir, name), body, 0o644); err != nil {
			t.Fatalf("write %s: %v", name, err)
		}
	}
}

// stageNoOpOsmo writes a fake osmo that always exits 0, used for the
// Download/Upload paths that go through RunOSMOCommandStreamingWithRetry.
// Returns the directory containing the fake binary.
func stageNoOpOsmo(t *testing.T) string {
	t.Helper()
	return stageFakeOsmo(t, "#!/bin/sh\nexit 0\n")
}

// drainMetricChan converts received metrics into URLs so tests can assert on
// the metric pipeline without depending on every single field.
func drainMetricChan(metricChan chan metrics.Metric) []string {
	var urls []string
	close(metricChan)
	for m := range metricChan {
		if io, ok := m.(metrics.TaskIOMetrics); ok {
			urls = append(urls, io.URL)
		}
	}
	return urls
}

func TestTaskInput_Download_RunsThroughCreateFolderAndMetricPipeline(t *testing.T) {
	WebsocketConnection = WebsocketConnectionInfo{}
	t.Setenv("PATH", stageNoOpOsmo(t))
	redirectBenchmarkPath(t)

	stageBenchmarkFiles(t, "INPUT_3")

	inputPath := t.TempDir() + "/"
	osmoChan := make(chan string, 64)
	metricChan := make(chan metrics.Metric, 8)

	ti := TaskInput{
		Folder: "fld",
		Name:   "data.tar",
		Url:    "s3://bucket/data.tar",
		Regex:  "",
	}
	ti.Download(nil, inputPath, osmoChan, metricChan,
		"r1", "g1", "t1", 3)

	if _, err := os.Stat(inputPath + "fld"); err != nil {
		t.Errorf("expected CreateFolder to make %q: %v", inputPath+"fld", err)
	}

	urls := drainMetricChan(metricChan)
	if len(urls) != 1 {
		t.Fatalf("expected 1 metric (zero-bytes skipped), got %d (%v)", len(urls), urls)
	}
	if urls[0] != ti.Url {
		t.Errorf("metric URL = %q, want %q", urls[0], ti.Url)
	}
}

func TestTaskOutput_UploadFolder_RunsThroughMetricPipeline(t *testing.T) {
	WebsocketConnection = WebsocketConnectionInfo{}
	t.Setenv("PATH", stageNoOpOsmo(t))
	redirectBenchmarkPath(t)

	stageBenchmarkFiles(t, "OUTPUT_7")

	outputPath := t.TempDir() + "/"
	osmoChan := make(chan string, 64)
	metricChan := make(chan metrics.Metric, 8)

	to := &TaskOutput{Name: "out.bin", Url: "s3://bucket/out.bin"}
	to.UploadFolder(nil, outputPath, osmoChan, metricChan,
		"r2", "g2", "t2", "url-id", 7)

	urls := drainMetricChan(metricChan)
	if len(urls) != 1 {
		t.Fatalf("expected 1 metric, got %d (%v)", len(urls), urls)
	}
	if urls[0] != "url-id" {
		t.Errorf("metric URL = %q, want %q", urls[0], "url-id")
	}
}

func TestUrlInput_Download_UsesGroupTaskIndexedBenchmarkFolder(t *testing.T) {
	WebsocketConnection = WebsocketConnectionInfo{}
	t.Setenv("PATH", stageNoOpOsmo(t))
	redirectBenchmarkPath(t)

	// UrlInput.Download builds benchmarkFolder as "<group>_<task>_INPUT_<idx>"
	stageBenchmarkFiles(t, "grp_tsk_INPUT_2")

	inputPath := t.TempDir() + "/"
	osmoChan := make(chan string, 64)
	metricChan := make(chan metrics.Metric, 8)

	ui := UrlInput{Folder: "uin", Url: "s3://bucket/data", Regex: "*.bin"}
	ui.Download(nil, inputPath, osmoChan, metricChan,
		"r3", "grp", "tsk", 2)

	if _, err := os.Stat(inputPath + "uin"); err != nil {
		t.Errorf("expected CreateFolder to make %q: %v", inputPath+"uin", err)
	}
	urls := drainMetricChan(metricChan)
	if len(urls) != 1 {
		t.Fatalf("expected 1 metric, got %d (%v)", len(urls), urls)
	}
	if urls[0] != ui.Url {
		t.Errorf("metric URL = %q, want %q", urls[0], ui.Url)
	}
}

func TestUrlOutput_UploadFolder_RunsThroughMetricPipeline(t *testing.T) {
	WebsocketConnection = WebsocketConnectionInfo{}
	t.Setenv("PATH", stageNoOpOsmo(t))
	redirectBenchmarkPath(t)

	stageBenchmarkFiles(t, "OUTPUT_4")

	outputPath := t.TempDir() + "/"
	osmoChan := make(chan string, 64)
	metricChan := make(chan metrics.Metric, 8)

	uo := &UrlOutput{Url: "s3://bucket/out", Regex: "*.bin"}
	uo.UploadFolder(nil, outputPath, osmoChan, metricChan,
		"r4", "g4", "t4", "url-id-4", 4)

	urls := drainMetricChan(metricChan)
	if len(urls) != 1 {
		t.Fatalf("expected 1 metric, got %d (%v)", len(urls), urls)
	}
	if urls[0] != "url-id-4" {
		t.Errorf("metric URL = %q, want %q", urls[0], "url-id-4")
	}
}

func TestKpiOutput_UploadFolder_RunsThroughMetricPipeline(t *testing.T) {
	WebsocketConnection = WebsocketConnectionInfo{}
	t.Setenv("PATH", stageNoOpOsmo(t))
	redirectBenchmarkPath(t)

	stageBenchmarkFiles(t, "OUTPUT_9")

	outputPath := t.TempDir() + "/"
	osmoChan := make(chan string, 64)
	metricChan := make(chan metrics.Metric, 8)

	kpi := &KpiOutput{Url: "s3://bucket/kpi", Path: "results/m.json"}
	kpi.UploadFolder(nil, outputPath, osmoChan, metricChan,
		"r5", "g5", "t5", "url-id-9", 9)

	urls := drainMetricChan(metricChan)
	if len(urls) != 1 {
		t.Fatalf("expected 1 metric, got %d (%v)", len(urls), urls)
	}
	if urls[0] != "url-id-9" {
		t.Errorf("metric URL = %q, want %q", urls[0], "url-id-9")
	}
}


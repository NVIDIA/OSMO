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
	"net"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"

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
// ParseInputOutput — dataset prefix (input vs output disambiguation via ';')
// ---------------------------------------------------------------------------

func TestParseInputOutput_DatasetInput_NoSemicolonReturnsDatasetInput(t *testing.T) {
	got := ParseInputOutput("dataset:myfolder,my-dataset:v1,*.png")

	want := DatasetInput{
		Folder:  "myfolder",
		Dataset: "my-dataset:v1",
		Regex:   "*.png",
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("ParseInputOutput dataset-input mismatch:\n got:  %#v\n want: %#v", got, want)
	}
}

func TestParseInputOutput_DatasetOutput_WithSemicolonReturnsDatasetOutput(t *testing.T) {
	got := ParseInputOutput("dataset:ds1,path1,meta1.json,meta2.json;label1.json;*.csv")

	datasetOutput, ok := got.(*DatasetOutput)
	if !ok {
		t.Fatalf("expected *DatasetOutput, got %T", got)
	}
	want := &DatasetOutput{
		Dataset:      "ds1",
		Path:         "path1",
		Metadata:     common.ArrayFlags{"meta1.json", "meta2.json"},
		MetadataFile: "",
		Labels:       common.ArrayFlags{"label1.json"},
		Url:          "",
		Regex:        "*.csv",
	}
	if !reflect.DeepEqual(datasetOutput, want) {
		t.Errorf("DatasetOutput mismatch:\n got:  %#v\n want: %#v", datasetOutput, want)
	}
}

func TestParseInputOutput_DatasetOutput_EmptyMetadataLeavesSliceNil(t *testing.T) {
	got := ParseInputOutput("dataset:ds1,path1,;label1.json;*.csv")

	datasetOutput, ok := got.(*DatasetOutput)
	if !ok {
		t.Fatalf("expected *DatasetOutput, got %T", got)
	}
	if datasetOutput.Metadata != nil {
		t.Errorf("Metadata = %#v, want nil when empty", datasetOutput.Metadata)
	}
	if !reflect.DeepEqual(datasetOutput.Labels, common.ArrayFlags{"label1.json"}) {
		t.Errorf("Labels = %#v, want [label1.json]", datasetOutput.Labels)
	}
}

func TestParseInputOutput_DatasetOutput_EmptyLabelsLeavesSliceNil(t *testing.T) {
	got := ParseInputOutput("dataset:ds1,path1,meta1.json;;*.csv")

	datasetOutput, ok := got.(*DatasetOutput)
	if !ok {
		t.Fatalf("expected *DatasetOutput, got %T", got)
	}
	if datasetOutput.Labels != nil {
		t.Errorf("Labels = %#v, want nil when empty", datasetOutput.Labels)
	}
	if !reflect.DeepEqual(datasetOutput.Metadata, common.ArrayFlags{"meta1.json"}) {
		t.Errorf("Metadata = %#v, want [meta1.json]", datasetOutput.Metadata)
	}
}

// ---------------------------------------------------------------------------
// ParseInputOutput — update_dataset prefix
// ---------------------------------------------------------------------------

func TestParseInputOutput_UpdateDataset_FullFormReturnsUpdateDatasetOutput(t *testing.T) {
	got := ParseInputOutput("update_dataset:ds1:tag;path1,path2;m1.json,m2.json;lbl.json")

	updateOutput, ok := got.(*UpdateDatasetOutput)
	if !ok {
		t.Fatalf("expected *UpdateDatasetOutput, got %T", got)
	}
	want := &UpdateDatasetOutput{
		Dataset:      "ds1:tag",
		Paths:        common.ArrayFlags{"path1", "path2"},
		Metadata:     common.ArrayFlags{"m1.json", "m2.json"},
		MetadataFile: "",
		Labels:       common.ArrayFlags{"lbl.json"},
		Url:          "",
	}
	if !reflect.DeepEqual(updateOutput, want) {
		t.Errorf("UpdateDatasetOutput mismatch:\n got:  %#v\n want: %#v", updateOutput, want)
	}
}

func TestParseInputOutput_UpdateDataset_EmptyPathsYieldsSingleEmptyString(t *testing.T) {
	// Per the parser: empty paths field produces []string{""} so downstream code
	// still iterates once.
	got := ParseInputOutput("update_dataset:ds1;;m1.json;lbl.json")

	updateOutput, ok := got.(*UpdateDatasetOutput)
	if !ok {
		t.Fatalf("expected *UpdateDatasetOutput, got %T", got)
	}
	if !reflect.DeepEqual(updateOutput.Paths, common.ArrayFlags{""}) {
		t.Errorf("Paths = %#v, want [\"\"]", updateOutput.Paths)
	}
}

func TestParseInputOutput_UpdateDataset_EmptyMetadataAndLabelsLeaveSlicesNil(t *testing.T) {
	got := ParseInputOutput("update_dataset:ds1;path1;;")

	updateOutput, ok := got.(*UpdateDatasetOutput)
	if !ok {
		t.Fatalf("expected *UpdateDatasetOutput, got %T", got)
	}
	if updateOutput.Metadata != nil {
		t.Errorf("Metadata = %#v, want nil", updateOutput.Metadata)
	}
	if updateOutput.Labels != nil {
		t.Errorf("Labels = %#v, want nil", updateOutput.Labels)
	}
	if !reflect.DeepEqual(updateOutput.Paths, common.ArrayFlags{"path1"}) {
		t.Errorf("Paths = %#v, want [path1]", updateOutput.Paths)
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

func TestDatasetInput_AccessorsAndFolderCombinesFolderAndDataset(t *testing.T) {
	di := DatasetInput{Folder: "root", Dataset: "my-ds:v1", Regex: "r"}

	if got := di.GetLogInfo(); got != "my-ds:v1" {
		t.Errorf("GetLogInfo = %q, want %q", got, "my-ds:v1")
	}
	if got := di.GetUrlIdentifier(); got != "my-ds:v1" {
		t.Errorf("GetUrlIdentifier = %q, want %q", got, "my-ds:v1")
	}
	// GetFolder strips everything after the first ':' from Dataset.
	if got := di.GetFolder(); got != "root/my-ds" {
		t.Errorf("GetFolder = %q, want %q", got, "root/my-ds")
	}
}

func TestDatasetInput_GetFolder_DatasetWithoutColonKeepsWholeName(t *testing.T) {
	di := DatasetInput{Folder: "root", Dataset: "plain-ds"}

	if got := di.GetFolder(); got != "root/plain-ds" {
		t.Errorf("GetFolder = %q, want %q", got, "root/plain-ds")
	}
}

func TestDatasetOutput_Accessors(t *testing.T) {
	do := DatasetOutput{Dataset: "d", Url: "u"}

	if got := do.GetLogInfo(); got != "d" {
		t.Errorf("GetLogInfo = %q, want %q", got, "d")
	}
	if got := do.GetUrlIdentifier(); got != "u" {
		t.Errorf("GetUrlIdentifier = %q, want %q", got, "u")
	}
}

func TestUpdateDatasetOutput_Accessors(t *testing.T) {
	udo := UpdateDatasetOutput{Dataset: "d", Url: "u"}

	if got := udo.GetLogInfo(); got != "d" {
		t.Errorf("GetLogInfo = %q, want %q", got, "d")
	}
	if got := udo.GetUrlIdentifier(); got != "u" {
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
// Helpers for CreateMount / UploadFolder tests
// ---------------------------------------------------------------------------

// writeShellScript writes an executable /bin/sh script at path with the given body.
func writeShellScript(t *testing.T, path string, body string) {
	t.Helper()
	contents := "#!/bin/sh\n" + body + "\n"
	if err := os.WriteFile(path, []byte(contents), 0o755); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}

// fakeBinaries installs fake `osmo`, `mount-s3`, and `tree` binaries in a temp
// directory and points the relevant env vars / PATH at them. Each script body
// is the body of the script (the shebang is added automatically). Use empty
// strings for default no-op behavior.
func fakeBinaries(t *testing.T, osmoBody, mountS3Body, treeBody string) {
	t.Helper()
	binDir := t.TempDir()
	if osmoBody == "" {
		osmoBody = "exit 0"
	}
	if mountS3Body == "" {
		mountS3Body = "exit 0"
	}
	if treeBody == "" {
		treeBody = "echo fake-tree-output\nexit 0"
	}
	writeShellScript(t, filepath.Join(binDir, "osmo"), osmoBody)
	writeShellScript(t, filepath.Join(binDir, "mount-s3"), mountS3Body)
	writeShellScript(t, filepath.Join(binDir, "tree"), treeBody)
	t.Setenv("PATH", binDir+":"+os.Getenv("PATH"))
	t.Setenv("MOUNT_S3_PATH", filepath.Join(binDir, "mount-s3"))
	t.Setenv("TREE_PATH", filepath.Join(binDir, "tree"))
}

// drainChannels collects everything written to osmoChan / metricChan while fn
// runs. fn's panics are recovered and returned in the panicValue field.
type captureResult struct {
	osmoMessages []string
	metricCount  int
	panicValue   interface{}
}

func runWithCapture(fn func(osmoChan chan string, metricChan chan metrics.Metric)) captureResult {
	osmoChan := make(chan string, 4096)
	metricChan := make(chan metrics.Metric, 4096)

	var msgs []string
	var metricCount int
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		for m := range osmoChan {
			msgs = append(msgs, m)
		}
	}()
	go func() {
		defer wg.Done()
		for range metricChan {
			metricCount++
		}
	}()

	var panicValue interface{}
	func() {
		defer func() {
			panicValue = recover()
		}()
		fn(osmoChan, metricChan)
	}()

	close(osmoChan)
	close(metricChan)
	wg.Wait()
	return captureResult{osmoMessages: msgs, metricCount: metricCount, panicValue: panicValue}
}

// dummyConn returns a connected net.Pipe; both ends are closed via t.Cleanup.
func dummyConn(t *testing.T) net.Conn {
	t.Helper()
	server, client := net.Pipe()
	t.Cleanup(func() {
		server.Close()
		client.Close()
	})
	return server
}

// tmpDirSlash returns t.TempDir() with a trailing slash (matching the inputPath
// convention used by the production code).
func tmpDirSlash(t *testing.T) string {
	t.Helper()
	return t.TempDir() + "/"
}

// containsSubstring reports whether any element of msgs contains substr.
func containsSubstring(msgs []string, substr string) bool {
	for _, m := range msgs {
		if strings.Contains(m, substr) {
			return true
		}
	}
	return false
}


// ---------------------------------------------------------------------------
// DatasetOutput.UploadFolder — early-return / panic paths (no fake binaries)
// ---------------------------------------------------------------------------

func TestDatasetOutput_UploadFolder_EmptyMetadataFilePanics(t *testing.T) {
	conn := dummyConn(t)
	do := &DatasetOutput{Dataset: "ds"}

	res := runWithCapture(func(osmoChan chan string, metricChan chan metrics.Metric) {
		do.UploadFolder(conn, tmpDirSlash(t), osmoChan, metricChan, "rid", "g", "tn", "url", 0)
	})

	if res.panicValue == nil {
		t.Fatalf("expected panic for empty MetadataFile, got none")
	}
	msg, ok := res.panicValue.(string)
	if !ok {
		t.Fatalf("expected string panic, got %T: %v", res.panicValue, res.panicValue)
	}
	if !strings.Contains(msg, "Metadata File is not Set") {
		t.Errorf("panic = %q, want to contain %q", msg, "Metadata File is not Set")
	}
}

func TestDatasetOutput_UploadFolder_NoFilesEmptyPathReturnsEarly(t *testing.T) {
	conn := dummyConn(t)
	emptyDir := tmpDirSlash(t)
	do := &DatasetOutput{Dataset: "ds", MetadataFile: "meta.json"}

	res := runWithCapture(func(osmoChan chan string, metricChan chan metrics.Metric) {
		do.UploadFolder(conn, emptyDir, osmoChan, metricChan, "rid", "g", "tn", "url", 0)
	})

	if res.panicValue != nil {
		t.Fatalf("unexpected panic: %v", res.panicValue)
	}
	if !containsSubstring(res.osmoMessages, "No files in path") {
		t.Errorf("expected 'No files in path' message, got %v", res.osmoMessages)
	}
	if !containsSubstring(res.osmoMessages, emptyDir+"*") {
		t.Errorf("expected message to reference glob '%s*', got %v", emptyDir, res.osmoMessages)
	}
}

func TestDatasetOutput_UploadFolder_NoFilesWithPathReturnsEarly(t *testing.T) {
	conn := dummyConn(t)
	emptyDir := tmpDirSlash(t)
	do := &DatasetOutput{Dataset: "ds", Path: "missing.bin", MetadataFile: "meta.json"}

	res := runWithCapture(func(osmoChan chan string, metricChan chan metrics.Metric) {
		do.UploadFolder(conn, emptyDir, osmoChan, metricChan, "rid", "g", "tn", "url", 0)
	})

	if res.panicValue != nil {
		t.Fatalf("unexpected panic: %v", res.panicValue)
	}
	if !containsSubstring(res.osmoMessages, "No files in path "+emptyDir+"missing.bin") {
		t.Errorf("expected message referencing path glob, got %v", res.osmoMessages)
	}
}

// ---------------------------------------------------------------------------
// UpdateDatasetOutput.UploadFolder — early-return / panic paths
// ---------------------------------------------------------------------------

func TestUpdateDatasetOutput_UploadFolder_EmptyMetadataFilePanics(t *testing.T) {
	conn := dummyConn(t)
	udo := &UpdateDatasetOutput{Dataset: "ds"}

	res := runWithCapture(func(osmoChan chan string, metricChan chan metrics.Metric) {
		udo.UploadFolder(conn, tmpDirSlash(t), osmoChan, metricChan, "rid", "g", "tn", "url", 0)
	})

	if res.panicValue == nil {
		t.Fatalf("expected panic for empty MetadataFile, got none")
	}
	msg, ok := res.panicValue.(string)
	if !ok || !strings.Contains(msg, "Metadata File is not Set") {
		t.Errorf("panic = %v, want 'Metadata File is not Set'", res.panicValue)
	}
}

func TestUpdateDatasetOutput_UploadFolder_NoFilesEmptyPathReturnsEarly(t *testing.T) {
	// Path "" → splitPaths[0]="" → combineOut += "*" branch (line 565)
	conn := dummyConn(t)
	emptyDir := tmpDirSlash(t)
	udo := &UpdateDatasetOutput{
		Dataset:      "ds",
		Paths:        common.ArrayFlags{""},
		MetadataFile: "meta.json",
	}

	res := runWithCapture(func(osmoChan chan string, metricChan chan metrics.Metric) {
		udo.UploadFolder(conn, emptyDir, osmoChan, metricChan, "rid", "g", "tn", "url", 0)
	})

	if res.panicValue != nil {
		t.Fatalf("unexpected panic: %v", res.panicValue)
	}
	if !containsSubstring(res.osmoMessages, "No files in path "+emptyDir+"*") {
		t.Errorf("expected glob message, got %v", res.osmoMessages)
	}
}

func TestUpdateDatasetOutput_UploadFolder_NoFilesWithPathReturnsEarly(t *testing.T) {
	// Path "sub" → splitPaths[0]="sub" → combineOut += "sub" branch (line 563)
	conn := dummyConn(t)
	emptyDir := tmpDirSlash(t)
	udo := &UpdateDatasetOutput{
		Dataset:      "ds",
		Paths:        common.ArrayFlags{"sub"},
		MetadataFile: "meta.json",
	}

	res := runWithCapture(func(osmoChan chan string, metricChan chan metrics.Metric) {
		udo.UploadFolder(conn, emptyDir, osmoChan, metricChan, "rid", "g", "tn", "url", 0)
	})

	if res.panicValue != nil {
		t.Fatalf("unexpected panic: %v", res.panicValue)
	}
	if !containsSubstring(res.osmoMessages, "No files in path "+emptyDir+"sub") {
		t.Errorf("expected message referencing path 'sub', got %v", res.osmoMessages)
	}
}

// ---------------------------------------------------------------------------
// TaskInput.CreateMount — Download branch (downloadType="download")
// ---------------------------------------------------------------------------

func TestTaskInput_CreateMount_DownloadBranchExecutesAndLogsDownloaded(t *testing.T) {
	// Fake osmo exits 0; benchmark dir doesn't exist so CollectBenchmarkMetrics
	// returns nil and the metric loop is a no-op.
	fakeBinaries(t, "exit 0", "", "")
	conn := dummyConn(t)
	inputPath := tmpDirSlash(t)
	ti := TaskInput{
		Folder: "myfolder",
		Name:   "data.bin",
		Url:    "s3://bucket/data.bin",
		Regex:  "*.bin",
	}

	res := runWithCapture(func(osmoChan chan string, metricChan chan metrics.Metric) {
		ti.CreateMount(conn, inputPath, ConfigInfo{}, osmoChan, metricChan,
			"rid", "g", "tn", Download, 0, 0)
	})

	if res.panicValue != nil {
		t.Fatalf("unexpected panic: %v", res.panicValue)
	}
	if !containsSubstring(res.osmoMessages, "Downloaded data.bin to {{input:myfolder}}") {
		t.Errorf("expected Downloaded message, got %v", res.osmoMessages)
	}
	if _, err := os.Stat(inputPath + "myfolder"); err != nil {
		t.Errorf("expected folder to be created: %v", err)
	}
}

// ---------------------------------------------------------------------------
// TaskInput.CreateMount — Mountpoint branch (downloadType="mountpoint-s3")
// ---------------------------------------------------------------------------

func TestTaskInput_CreateMount_MountpointBranchPopulatesAndReportsMounted(t *testing.T) {
	// Fake mount-s3 drops a sentinel file in the mount dir so IsDirEmpty
	// returns false on the first iteration (no retries / no syscall.Unmount).
	fakeBinaries(t, "", `touch "$2/.fake-mounted"
exit 0`, "")
	conn := dummyConn(t)
	inputPath := tmpDirSlash(t)
	ti := TaskInput{
		Folder: "myfolder",
		Name:   "data.bin",
		Url:    "s3://bucket/data.bin",
	}

	res := runWithCapture(func(osmoChan chan string, metricChan chan metrics.Metric) {
		ti.CreateMount(conn, inputPath, ConfigInfo{}, osmoChan, metricChan,
			"rid", "g", "tn", Mountpoint, 0, 0)
	})

	if res.panicValue != nil {
		t.Fatalf("unexpected panic: %v", res.panicValue)
	}
	if !containsSubstring(res.osmoMessages, "Mounted data.bin to {{input:myfolder}}") {
		t.Errorf("expected 'Mounted' message, got %v", res.osmoMessages)
	}
	if res.metricCount == 0 {
		t.Errorf("expected at least one mount metric, got none")
	}
}

func TestTaskInput_CreateMount_MountpointBranchReportsFailureWhenEmpty(t *testing.T) {
	// Fake mount-s3 succeeds (exit 0) but writes nothing → IsDirEmpty=true →
	// loop retries MountRetryCount times → MountURL returns isEmpty=true →
	// CreateMount emits "Mount for task X failed" and uses MountpointFailed type.
	prevRetry := MountRetryCount
	MountRetryCount = 1
	t.Cleanup(func() { MountRetryCount = prevRetry })

	fakeBinaries(t, "", "exit 0", "")
	conn := dummyConn(t)
	inputPath := tmpDirSlash(t)
	ti := TaskInput{
		Folder: "task-empty",
		Name:   "data.bin",
		Url:    "s3://bucket/data.bin",
	}

	res := runWithCapture(func(osmoChan chan string, metricChan chan metrics.Metric) {
		ti.CreateMount(conn, inputPath, ConfigInfo{}, osmoChan, metricChan,
			"rid", "g", "tn", Mountpoint, 0, 0)
	})

	if res.panicValue != nil {
		t.Fatalf("unexpected panic: %v", res.panicValue)
	}
	if !containsSubstring(res.osmoMessages, "Mount for task data.bin failed") {
		t.Errorf("expected 'Mount for task ... failed' message, got %v", res.osmoMessages)
	}
}

// ---------------------------------------------------------------------------
// TaskOutput.UploadFolder — exec-based happy path
// ---------------------------------------------------------------------------

func TestTaskOutput_UploadFolder_HappyPathLogsUploaded(t *testing.T) {
	fakeBinaries(t, "exit 0", "", "")
	conn := dummyConn(t)
	to := &TaskOutput{Name: "out.bin", Url: "s3://bucket/out.bin"}

	res := runWithCapture(func(osmoChan chan string, metricChan chan metrics.Metric) {
		to.UploadFolder(conn, tmpDirSlash(t), osmoChan, metricChan,
			"rid", "g", "tn", "url-id", 0)
	})

	if res.panicValue != nil {
		t.Fatalf("unexpected panic: %v", res.panicValue)
	}
	if !containsSubstring(res.osmoMessages, "Uploaded out.bin") {
		t.Errorf("expected 'Uploaded out.bin' message, got %v", res.osmoMessages)
	}
}

// ---------------------------------------------------------------------------
// DatasetInput.CreateMount — Download branch (versions present, downloadType=download)
// ---------------------------------------------------------------------------

func TestDatasetInput_CreateMount_DownloadBranchEmitsDownloadedMessage(t *testing.T) {
	// Fake osmo: for "dataset info" emit a single-version JSON; everything
	// else exits 0 silently.
	osmoScript := `case "$1 $2" in
  "dataset info")
    cat <<'JSON'
{"type":"DATASET","versions":[{"name":"ds-v","version":"v1","uri":"s3://bucket/path/file","size":100,"checksum":"abc"}],"hash_location":""}
JSON
    ;;
esac
exit 0`
	fakeBinaries(t, osmoScript, "", "")
	conn := dummyConn(t)
	inputPath := tmpDirSlash(t)
	di := DatasetInput{
		Folder:  "ds-folder",
		Dataset: "my-dataset:v1",
	}

	res := runWithCapture(func(osmoChan chan string, metricChan chan metrics.Metric) {
		di.CreateMount(conn, inputPath, ConfigInfo{}, osmoChan, metricChan,
			"rid", "g", "tn", Download, 0, 0)
	})

	if res.panicValue != nil {
		t.Fatalf("unexpected panic: %v", res.panicValue)
	}
	if !containsSubstring(res.osmoMessages, "Downloaded my-dataset:v1 to {{input:ds-folder}}") {
		t.Errorf("expected Downloaded message, got %v", res.osmoMessages)
	}
}

func TestDatasetInput_CreateMount_DownloadBranchAppendsBucketWhenDatasetHasSlash(t *testing.T) {
	// Dataset string contains "/" → datasetSplit length > 1 → bucket prefix
	// is prepended. We can verify execution completed by checking the
	// "Downloaded" message; behavior covers line 366-367.
	osmoScript := `case "$1 $2" in
  "dataset info")
    cat <<'JSON'
{"type":"DATASET","versions":[{"name":"ds-v","version":"v1","uri":"s3://bucket/file","size":1,"checksum":"x"}],"hash_location":""}
JSON
    ;;
esac
exit 0`
	fakeBinaries(t, osmoScript, "", "")
	conn := dummyConn(t)
	di := DatasetInput{
		Folder:  "f",
		Dataset: "bucketname/ds:v1",
		Regex:   "*.txt",
	}

	res := runWithCapture(func(osmoChan chan string, metricChan chan metrics.Metric) {
		di.CreateMount(conn, tmpDirSlash(t), ConfigInfo{}, osmoChan, metricChan,
			"rid", "g", "tn", Download, 0, 0)
	})

	if res.panicValue != nil {
		t.Fatalf("unexpected panic: %v", res.panicValue)
	}
	if !containsSubstring(res.osmoMessages, "Downloaded bucketname/ds:v1") {
		t.Errorf("expected Downloaded message, got %v", res.osmoMessages)
	}
}

func TestDatasetInput_CreateMount_EmptyVersionsPanics(t *testing.T) {
	// "dataset info" returns empty versions → triggers the panic path (lines
	// 216-219) and DOWNLOAD_FAILED_CODE exit code is set.
	osmoScript := `case "$1 $2" in
  "dataset info")
    echo '{"type":"DATASET","versions":[]}'
    ;;
esac
exit 0`
	fakeBinaries(t, osmoScript, "", "")
	conn := dummyConn(t)
	di := DatasetInput{Folder: "f", Dataset: "no-versions"}

	res := runWithCapture(func(osmoChan chan string, metricChan chan metrics.Metric) {
		di.CreateMount(conn, tmpDirSlash(t), ConfigInfo{}, osmoChan, metricChan,
			"rid", "g", "tn", Download, 0, 0)
	})

	if res.panicValue == nil {
		t.Fatalf("expected panic for empty Versions, got none")
	}
	msg, ok := res.panicValue.(string)
	if !ok || !strings.Contains(msg, "Info is Empty") {
		t.Errorf("panic = %v, want 'Info is Empty'", res.panicValue)
	}
}

// ---------------------------------------------------------------------------
// DatasetInput.CreateMount — Mountpoint branch with empty manifest
// ---------------------------------------------------------------------------

func TestDatasetInput_CreateMount_MountpointBranchEmptyManifestNoMounts(t *testing.T) {
	// Fake osmo: for "dataset info" emit single-version JSON; for
	// "data download" write an empty JSON array as the manifest at <dest>/<basename>.
	// With an empty manifest, ParseMountLocations returns an empty map →
	// mount loop is skipped → "Mounting finished" message is emitted.
	osmoScript := `case "$1 $2" in
  "dataset info")
    cat <<'JSON'
{"type":"DATASET","versions":[{"name":"ds-v","version":"v1","uri":"s3://bucket/path/manifest.json","size":1,"checksum":"x","hash_location":""}],"hash_location":"s3://bucket/hashes"}
JSON
    ;;
  "data download")
    # $3 = uri (s3://.../manifest.json), $4 = dest dir
    base=$(basename "$3")
    mkdir -p "$4"
    echo '[]' > "$4/$base"
    ;;
esac
exit 0`
	fakeBinaries(t, osmoScript, "", "")
	conn := dummyConn(t)
	di := DatasetInput{Folder: "ds-folder", Dataset: "my-dataset:v1"}

	res := runWithCapture(func(osmoChan chan string, metricChan chan metrics.Metric) {
		di.CreateMount(conn, tmpDirSlash(t), ConfigInfo{}, osmoChan, metricChan,
			"rid", "g", "tn", Mountpoint, 0, 0)
	})

	if res.panicValue != nil {
		t.Fatalf("unexpected panic: %v", res.panicValue)
	}
	if !containsSubstring(res.osmoMessages, "Mounting finished for ds-v") {
		t.Errorf("expected 'Mounting finished' message, got %v", res.osmoMessages)
	}
	if !containsSubstring(res.osmoMessages, "Mounted my-dataset:v1") {
		t.Errorf("expected 'Mounted ...' summary message, got %v", res.osmoMessages)
	}
}

func TestDatasetInput_CreateMount_MountpointBranchCollectionUsesVersionHashLocation(t *testing.T) {
	// Type=="COLLECTION" path: hashesUri = datasetVersionInfo.HashLocation.
	osmoScript := `case "$1 $2" in
  "dataset info")
    cat <<'JSON'
{"type":"COLLECTION","versions":[{"name":"col-v","version":"v1","uri":"s3://bucket/path/manifest.json","size":1,"checksum":"x","hash_location":"s3://bucket/v-hashes"}],"hash_location":"s3://bucket/top-hashes"}
JSON
    ;;
  "data download")
    base=$(basename "$3")
    mkdir -p "$4"
    echo '[]' > "$4/$base"
    ;;
esac
exit 0`
	fakeBinaries(t, osmoScript, "", "")
	conn := dummyConn(t)
	di := DatasetInput{Folder: "col-folder", Dataset: "my-collection"}

	res := runWithCapture(func(osmoChan chan string, metricChan chan metrics.Metric) {
		di.CreateMount(conn, tmpDirSlash(t), ConfigInfo{}, osmoChan, metricChan,
			"rid", "g", "tn", Mountpoint, 0, 0)
	})

	if res.panicValue != nil {
		t.Fatalf("unexpected panic: %v", res.panicValue)
	}
	if !containsSubstring(res.osmoMessages, "Mounting finished for col-v") {
		t.Errorf("expected 'Mounting finished' message, got %v", res.osmoMessages)
	}
}

// ---------------------------------------------------------------------------
// DatasetOutput.UploadFolder — exec-based happy path
// ---------------------------------------------------------------------------

func TestDatasetOutput_UploadFolder_HappyPathLogsUploadedAndTags(t *testing.T) {
	// Set up an output dir with one file so common.GetFiles returns >0.
	// Fake osmo:
	//   - "dataset upload" → first invocation must return JSON {"version_id":"v_xyz"}
	//   - "dataset info" → return single-version JSON for SendDatasetSizeAndChecksum
	//   - "dataset tag" → exit 0 (covers tag branch)
	//   - others → exit 0
	osmoScript := `case "$1 $2" in
  "dataset upload")
    echo '{"version_id":"v_xyz"}'
    ;;
  "dataset info")
    cat <<'JSON'
{"type":"DATASET","versions":[{"name":"ds","version":"v_xyz","uri":"s3://bucket/ds/v_xyz","size":42,"checksum":"sum"}]}
JSON
    ;;
esac
exit 0`
	fakeBinaries(t, osmoScript, "", "")
	conn := dummyConn(t)

	outputPath := tmpDirSlash(t)
	// Create a file matching the glob "*"
	if err := os.WriteFile(outputPath+"file.bin", []byte("data"), 0o644); err != nil {
		t.Fatalf("create output file: %v", err)
	}
	// Metadata files referenced by f.Metadata must exist so CheckIfFileExists
	// returns true.
	if err := os.WriteFile(outputPath+"meta-extra.json", []byte("{}"), 0o644); err != nil {
		t.Fatalf("create meta file: %v", err)
	}
	if err := os.WriteFile(outputPath+"labels.json", []byte("{}"), 0o644); err != nil {
		t.Fatalf("create labels file: %v", err)
	}

	do := &DatasetOutput{
		Dataset:      "my-ds:tag1",
		MetadataFile: "meta-primary.json",
		Metadata:     common.ArrayFlags{"meta-extra.json"},
		Labels:       common.ArrayFlags{"labels.json"},
		Regex:        "*.bin",
	}

	res := runWithCapture(func(osmoChan chan string, metricChan chan metrics.Metric) {
		do.UploadFolder(conn, outputPath, osmoChan, metricChan,
			"rid", "g", "tn", "url-id", 0)
	})

	if res.panicValue != nil {
		t.Fatalf("unexpected panic: %v", res.panicValue)
	}
	if !containsSubstring(res.osmoMessages, "Uploaded to my-ds:v_xyz") {
		t.Errorf("expected 'Uploaded to my-ds:v_xyz' message, got %v", res.osmoMessages)
	}
	if !containsSubstring(res.osmoMessages, "Tagged my-ds:v_xyz with tag1") {
		t.Errorf("expected 'Tagged ... with tag1' message, got %v", res.osmoMessages)
	}
}

func TestDatasetOutput_UploadFolder_MissingMetadataFileReturnsEarly(t *testing.T) {
	// Output dir has the glob target but the referenced Metadata file is
	// missing → CheckIfFileExists returns false and the function returns
	// after logging "File does not exist". Covers lines 467-470.
	osmoScript := `exit 0`
	fakeBinaries(t, osmoScript, "", "")
	conn := dummyConn(t)
	outputPath := tmpDirSlash(t)
	if err := os.WriteFile(outputPath+"file.bin", []byte("data"), 0o644); err != nil {
		t.Fatalf("create output file: %v", err)
	}

	do := &DatasetOutput{
		Dataset:      "my-ds",
		MetadataFile: "meta-primary.json",
		Metadata:     common.ArrayFlags{"missing-meta.json"},
	}

	res := runWithCapture(func(osmoChan chan string, metricChan chan metrics.Metric) {
		do.UploadFolder(conn, outputPath, osmoChan, metricChan,
			"rid", "g", "tn", "url-id", 0)
	})

	if res.panicValue != nil {
		t.Fatalf("unexpected panic: %v", res.panicValue)
	}
	if !containsSubstring(res.osmoMessages, "File does not exist") {
		t.Errorf("expected 'File does not exist' message, got %v", res.osmoMessages)
	}
	// The function should NOT reach the upload — no "Uploaded to" message.
	if containsSubstring(res.osmoMessages, "Uploaded to") {
		t.Errorf("did not expect upload to proceed past missing metadata, got %v", res.osmoMessages)
	}
}

// ---------------------------------------------------------------------------
// UpdateDatasetOutput.UploadFolder — happy path with file present
// ---------------------------------------------------------------------------

func TestUpdateDatasetOutput_UploadFolder_HappyPathLogsUpdated(t *testing.T) {
	osmoScript := `case "$1 $2" in
  "dataset update")
    echo '{"version_id":"v_xyz"}'
    ;;
  "dataset info")
    cat <<'JSON'
{"type":"DATASET","versions":[{"name":"ds","version":"v_xyz","uri":"s3://bucket/ds/v_xyz","size":42,"checksum":"sum"}]}
JSON
    ;;
esac
exit 0`
	fakeBinaries(t, osmoScript, "", "")
	conn := dummyConn(t)
	outputPath := tmpDirSlash(t)
	if err := os.WriteFile(outputPath+"a.txt", []byte("a"), 0o644); err != nil {
		t.Fatalf("create file: %v", err)
	}

	udo := &UpdateDatasetOutput{
		Dataset:      "my-ds",
		Paths:        common.ArrayFlags{"a.txt"},
		MetadataFile: "meta.json",
	}

	res := runWithCapture(func(osmoChan chan string, metricChan chan metrics.Metric) {
		udo.UploadFolder(conn, outputPath, osmoChan, metricChan,
			"rid", "g", "tn", "url-id", 0)
	})

	if res.panicValue != nil {
		t.Fatalf("unexpected panic: %v", res.panicValue)
	}
	if !containsSubstring(res.osmoMessages, "Updated my-ds") {
		t.Errorf("expected 'Updated my-ds' message, got %v", res.osmoMessages)
	}
}

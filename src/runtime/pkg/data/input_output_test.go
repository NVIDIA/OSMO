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
	"reflect"
	"testing"
)

func TestParseInputOutput_Task_WithThreeFields_ReturnsTaskInput(t *testing.T) {
	result := ParseInputOutput("task:input_folder,s3://bucket/path/file.txt,.*\\.csv")

	taskInput, ok := result.(TaskInput)
	if !ok {
		t.Fatalf("expected TaskInput, got %T", result)
	}
	if taskInput.Folder != "input_folder" {
		t.Errorf("Folder: got %q, want %q", taskInput.Folder, "input_folder")
	}
	if taskInput.Url != "s3://bucket/path/file.txt" {
		t.Errorf("Url: got %q, want %q", taskInput.Url, "s3://bucket/path/file.txt")
	}
	if taskInput.Name != "file.txt" {
		t.Errorf("Name: got %q, want %q", taskInput.Name, "file.txt")
	}
	if taskInput.Regex != ".*\\.csv" {
		t.Errorf("Regex: got %q, want %q", taskInput.Regex, ".*\\.csv")
	}
}

func TestParseInputOutput_Task_WithOneField_ReturnsTaskOutput(t *testing.T) {
	result := ParseInputOutput("task:s3://bucket/path/output.txt")

	taskOutput, ok := result.(*TaskOutput)
	if !ok {
		t.Fatalf("expected *TaskOutput, got %T", result)
	}
	if taskOutput.Url != "s3://bucket/path/output.txt" {
		t.Errorf("Url: got %q, want %q", taskOutput.Url, "s3://bucket/path/output.txt")
	}
	if taskOutput.Name != "output.txt" {
		t.Errorf("Name: got %q, want %q", taskOutput.Name, "output.txt")
	}
}

func TestParseInputOutput_Task_UrlWithoutSlash_NameEqualsUrl(t *testing.T) {
	// LastIndex returns -1 when "/" is absent; +1 makes the slice start at 0.
	result := ParseInputOutput("task:nodashes")

	taskOutput, ok := result.(*TaskOutput)
	if !ok {
		t.Fatalf("expected *TaskOutput, got %T", result)
	}
	if taskOutput.Name != "nodashes" {
		t.Errorf("Name: got %q, want %q", taskOutput.Name, "nodashes")
	}
	if taskOutput.Url != "nodashes" {
		t.Errorf("Url: got %q, want %q", taskOutput.Url, "nodashes")
	}
}

func TestParseInputOutput_Url_WithTwoFields_ReturnsUrlOutput(t *testing.T) {
	result := ParseInputOutput("url:s3://bucket/out,.*\\.log")

	urlOutput, ok := result.(*UrlOutput)
	if !ok {
		t.Fatalf("expected *UrlOutput, got %T", result)
	}
	if urlOutput.Url != "s3://bucket/out" {
		t.Errorf("Url: got %q, want %q", urlOutput.Url, "s3://bucket/out")
	}
	if urlOutput.Regex != ".*\\.log" {
		t.Errorf("Regex: got %q, want %q", urlOutput.Regex, ".*\\.log")
	}
}

func TestParseInputOutput_Url_WithThreeFields_ReturnsUrlInput(t *testing.T) {
	result := ParseInputOutput("url:in_folder,s3://bucket/in,.*\\.txt")

	urlInput, ok := result.(UrlInput)
	if !ok {
		t.Fatalf("expected UrlInput, got %T", result)
	}
	if urlInput.Folder != "in_folder" {
		t.Errorf("Folder: got %q, want %q", urlInput.Folder, "in_folder")
	}
	if urlInput.Url != "s3://bucket/in" {
		t.Errorf("Url: got %q, want %q", urlInput.Url, "s3://bucket/in")
	}
	if urlInput.Regex != ".*\\.txt" {
		t.Errorf("Regex: got %q, want %q", urlInput.Regex, ".*\\.txt")
	}
}

func TestParseInputOutput_Dataset_WithoutSemicolon_ReturnsDatasetInput(t *testing.T) {
	result := ParseInputOutput("dataset:data_folder,my_dataset:v1,.*\\.bin")

	datasetInput, ok := result.(DatasetInput)
	if !ok {
		t.Fatalf("expected DatasetInput, got %T", result)
	}
	if datasetInput.Folder != "data_folder" {
		t.Errorf("Folder: got %q, want %q", datasetInput.Folder, "data_folder")
	}
	if datasetInput.Dataset != "my_dataset:v1" {
		t.Errorf("Dataset: got %q, want %q", datasetInput.Dataset, "my_dataset:v1")
	}
	if datasetInput.Regex != ".*\\.bin" {
		t.Errorf("Regex: got %q, want %q", datasetInput.Regex, ".*\\.bin")
	}
}

func TestParseInputOutput_Dataset_WithSemicolon_ReturnsDatasetOutput(t *testing.T) {
	result := ParseInputOutput("dataset:my_dataset:tag,out_path,meta1.json,meta2.json;label1.json;.*\\.csv")

	datasetOutput, ok := result.(*DatasetOutput)
	if !ok {
		t.Fatalf("expected *DatasetOutput, got %T", result)
	}
	if datasetOutput.Dataset != "my_dataset:tag" {
		t.Errorf("Dataset: got %q, want %q", datasetOutput.Dataset, "my_dataset:tag")
	}
	if datasetOutput.Path != "out_path" {
		t.Errorf("Path: got %q, want %q", datasetOutput.Path, "out_path")
	}
	expectedMetadata := []string{"meta1.json", "meta2.json"}
	if !reflect.DeepEqual([]string(datasetOutput.Metadata), expectedMetadata) {
		t.Errorf("Metadata: got %v, want %v", datasetOutput.Metadata, expectedMetadata)
	}
	expectedLabels := []string{"label1.json"}
	if !reflect.DeepEqual([]string(datasetOutput.Labels), expectedLabels) {
		t.Errorf("Labels: got %v, want %v", datasetOutput.Labels, expectedLabels)
	}
	if datasetOutput.Regex != ".*\\.csv" {
		t.Errorf("Regex: got %q, want %q", datasetOutput.Regex, ".*\\.csv")
	}
}

func TestParseInputOutput_Dataset_WithEmptyMetadataAndLabels_ReturnsEmptySlices(t *testing.T) {
	// DatasetOutput: metadata and labels sections empty, only regex present.
	result := ParseInputOutput("dataset:my_dataset,out_path,;;.*\\.txt")

	datasetOutput, ok := result.(*DatasetOutput)
	if !ok {
		t.Fatalf("expected *DatasetOutput, got %T", result)
	}
	if len(datasetOutput.Metadata) != 0 {
		t.Errorf("Metadata: expected empty, got %v", datasetOutput.Metadata)
	}
	if len(datasetOutput.Labels) != 0 {
		t.Errorf("Labels: expected empty, got %v", datasetOutput.Labels)
	}
	if datasetOutput.Regex != ".*\\.txt" {
		t.Errorf("Regex: got %q, want %q", datasetOutput.Regex, ".*\\.txt")
	}
}

func TestParseInputOutput_UpdateDataset_ParsesAllSegments(t *testing.T) {
	result := ParseInputOutput(
		"update_dataset:my_dataset:tag;path1,path2;meta1.json,meta2.json;label1.json")

	updateOutput, ok := result.(*UpdateDatasetOutput)
	if !ok {
		t.Fatalf("expected *UpdateDatasetOutput, got %T", result)
	}
	if updateOutput.Dataset != "my_dataset:tag" {
		t.Errorf("Dataset: got %q, want %q", updateOutput.Dataset, "my_dataset:tag")
	}
	expectedPaths := []string{"path1", "path2"}
	if !reflect.DeepEqual([]string(updateOutput.Paths), expectedPaths) {
		t.Errorf("Paths: got %v, want %v", updateOutput.Paths, expectedPaths)
	}
	expectedMetadata := []string{"meta1.json", "meta2.json"}
	if !reflect.DeepEqual([]string(updateOutput.Metadata), expectedMetadata) {
		t.Errorf("Metadata: got %v, want %v", updateOutput.Metadata, expectedMetadata)
	}
	expectedLabels := []string{"label1.json"}
	if !reflect.DeepEqual([]string(updateOutput.Labels), expectedLabels) {
		t.Errorf("Labels: got %v, want %v", updateOutput.Labels, expectedLabels)
	}
}

func TestParseInputOutput_UpdateDataset_EmptyPaths_DefaultsToSingleEmptyString(t *testing.T) {
	// When the paths segment is empty, the parser injects a single empty string
	// (not an empty slice) so downstream logic uses the default "*" glob.
	result := ParseInputOutput("update_dataset:my_dataset;;;")

	updateOutput, ok := result.(*UpdateDatasetOutput)
	if !ok {
		t.Fatalf("expected *UpdateDatasetOutput, got %T", result)
	}
	expectedPaths := []string{""}
	if !reflect.DeepEqual([]string(updateOutput.Paths), expectedPaths) {
		t.Errorf("Paths: got %v, want %v", updateOutput.Paths, expectedPaths)
	}
	if len(updateOutput.Metadata) != 0 {
		t.Errorf("Metadata: expected empty, got %v", updateOutput.Metadata)
	}
	if len(updateOutput.Labels) != 0 {
		t.Errorf("Labels: expected empty, got %v", updateOutput.Labels)
	}
}

func TestParseInputOutput_Kpi_ReturnsKpiOutput(t *testing.T) {
	result := ParseInputOutput("kpi:s3://bucket/kpi,metrics/results.json")

	kpiOutput, ok := result.(*KpiOutput)
	if !ok {
		t.Fatalf("expected *KpiOutput, got %T", result)
	}
	if kpiOutput.Url != "s3://bucket/kpi" {
		t.Errorf("Url: got %q, want %q", kpiOutput.Url, "s3://bucket/kpi")
	}
	if kpiOutput.Path != "metrics/results.json" {
		t.Errorf("Path: got %q, want %q", kpiOutput.Path, "metrics/results.json")
	}
}

func TestParseInputOutput_UnknownType_Panics(t *testing.T) {
	defer func() {
		r := recover()
		if r == nil {
			t.Fatalf("expected panic for unknown input type")
		}
	}()

	ParseInputOutput("bogus:something,else")
}

// --- Getter method coverage ---

func TestTaskInput_Getters(t *testing.T) {
	input := TaskInput{Folder: "f", Name: "n", Url: "u", Regex: "r"}

	if got := input.GetLogInfo(); got != "n" {
		t.Errorf("GetLogInfo: got %q, want %q", got, "n")
	}
	if got := input.GetUrlIdentifier(); got != "u" {
		t.Errorf("GetUrlIdentifier: got %q, want %q", got, "u")
	}
	if got := input.GetFolder(); got != "f" {
		t.Errorf("GetFolder: got %q, want %q", got, "f")
	}
}

func TestTaskOutput_Getters(t *testing.T) {
	output := TaskOutput{Name: "n", Url: "u"}

	if got := output.GetLogInfo(); got != "n" {
		t.Errorf("GetLogInfo: got %q, want %q", got, "n")
	}
	if got := output.GetUrlIdentifier(); got != "u" {
		t.Errorf("GetUrlIdentifier: got %q, want %q", got, "u")
	}
}

func TestDatasetInput_Getters_BareDataset(t *testing.T) {
	input := DatasetInput{Folder: "data", Dataset: "my_dataset", Regex: ""}

	if got := input.GetLogInfo(); got != "my_dataset" {
		t.Errorf("GetLogInfo: got %q, want %q", got, "my_dataset")
	}
	if got := input.GetUrlIdentifier(); got != "my_dataset" {
		t.Errorf("GetUrlIdentifier: got %q, want %q", got, "my_dataset")
	}
	if got := input.GetFolder(); got != "data/my_dataset" {
		t.Errorf("GetFolder: got %q, want %q", got, "data/my_dataset")
	}
}

func TestDatasetInput_GetFolder_StripsVersionTag(t *testing.T) {
	// GetFolder splits off the ":<tag>" suffix so the folder name stays stable
	// across dataset versions.
	input := DatasetInput{Folder: "data", Dataset: "my_dataset:v2"}

	if got := input.GetFolder(); got != "data/my_dataset" {
		t.Errorf("GetFolder: got %q, want %q", got, "data/my_dataset")
	}
}

func TestDatasetOutput_Getters(t *testing.T) {
	output := DatasetOutput{Dataset: "ds", Url: "uri"}

	if got := output.GetLogInfo(); got != "ds" {
		t.Errorf("GetLogInfo: got %q, want %q", got, "ds")
	}
	if got := output.GetUrlIdentifier(); got != "uri" {
		t.Errorf("GetUrlIdentifier: got %q, want %q", got, "uri")
	}
}

func TestUpdateDatasetOutput_Getters(t *testing.T) {
	output := UpdateDatasetOutput{Dataset: "ds", Url: "uri"}

	if got := output.GetLogInfo(); got != "ds" {
		t.Errorf("GetLogInfo: got %q, want %q", got, "ds")
	}
	if got := output.GetUrlIdentifier(); got != "uri" {
		t.Errorf("GetUrlIdentifier: got %q, want %q", got, "uri")
	}
}

func TestUrlInput_Getters(t *testing.T) {
	input := UrlInput{Folder: "folder", Url: "https://example.com", Regex: "r"}

	if got := input.GetLogInfo(); got != "https://example.com" {
		t.Errorf("GetLogInfo: got %q, want %q", got, "https://example.com")
	}
	if got := input.GetUrlIdentifier(); got != "https://example.com" {
		t.Errorf("GetUrlIdentifier: got %q, want %q", got, "https://example.com")
	}
	if got := input.GetFolder(); got != "folder" {
		t.Errorf("GetFolder: got %q, want %q", got, "folder")
	}
}

func TestUrlOutput_Getters(t *testing.T) {
	output := UrlOutput{Url: "https://example.com/out", Regex: ""}

	if got := output.GetLogInfo(); got != "https://example.com/out" {
		t.Errorf("GetLogInfo: got %q, want %q", got, "https://example.com/out")
	}
	if got := output.GetUrlIdentifier(); got != "https://example.com/out" {
		t.Errorf("GetUrlIdentifier: got %q, want %q", got, "https://example.com/out")
	}
}

func TestKpiOutput_Getters(t *testing.T) {
	output := KpiOutput{Url: "https://kpi.example", Path: "results.json"}

	if got := output.GetLogInfo(); got != "KPI: results.json" {
		t.Errorf("GetLogInfo: got %q, want %q", got, "KPI: results.json")
	}
	if got := output.GetUrlIdentifier(); got != "https://kpi.example/results.json" {
		t.Errorf("GetUrlIdentifier: got %q, want %q",
			got, "https://kpi.example/results.json")
	}
}

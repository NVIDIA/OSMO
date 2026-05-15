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

	"go.corp.nvidia.com/osmo/runtime/pkg/common"
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

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

// ---------------------------------------------------------------------------
// Accessor tests: GetLogInfo / GetUrlIdentifier / GetFolder on each type
// ---------------------------------------------------------------------------

func TestTaskInput_GetLogInfo_ReturnsName(t *testing.T) {
	input := TaskInput{Folder: "myfolder", Name: "file.txt", Url: "s3://bucket/file.txt", Regex: "*"}

	if got := input.GetLogInfo(); got != "file.txt" {
		t.Errorf("GetLogInfo() = %q, want %q", got, "file.txt")
	}
}

func TestTaskInput_GetUrlIdentifier_ReturnsUrl(t *testing.T) {
	input := TaskInput{Folder: "myfolder", Name: "file.txt", Url: "s3://bucket/file.txt", Regex: "*"}

	if got := input.GetUrlIdentifier(); got != "s3://bucket/file.txt" {
		t.Errorf("GetUrlIdentifier() = %q, want %q", got, "s3://bucket/file.txt")
	}
}

func TestTaskInput_GetFolder_ReturnsFolder(t *testing.T) {
	input := TaskInput{Folder: "myfolder", Name: "file.txt", Url: "s3://bucket/file.txt", Regex: "*"}

	if got := input.GetFolder(); got != "myfolder" {
		t.Errorf("GetFolder() = %q, want %q", got, "myfolder")
	}
}

func TestTaskOutput_GetLogInfo_ReturnsName(t *testing.T) {
	output := TaskOutput{Name: "report.log", Url: "s3://bucket/report.log"}

	if got := output.GetLogInfo(); got != "report.log" {
		t.Errorf("GetLogInfo() = %q, want %q", got, "report.log")
	}
}

func TestTaskOutput_GetUrlIdentifier_ReturnsUrl(t *testing.T) {
	output := TaskOutput{Name: "report.log", Url: "s3://bucket/report.log"}

	if got := output.GetUrlIdentifier(); got != "s3://bucket/report.log" {
		t.Errorf("GetUrlIdentifier() = %q, want %q", got, "s3://bucket/report.log")
	}
}

func TestDatasetInput_GetLogInfo_ReturnsDataset(t *testing.T) {
	input := DatasetInput{Folder: "data", Dataset: "mydataset:v1", Regex: ""}

	if got := input.GetLogInfo(); got != "mydataset:v1" {
		t.Errorf("GetLogInfo() = %q, want %q", got, "mydataset:v1")
	}
}

func TestDatasetInput_GetUrlIdentifier_ReturnsDataset(t *testing.T) {
	input := DatasetInput{Folder: "data", Dataset: "mydataset:v1", Regex: ""}

	if got := input.GetUrlIdentifier(); got != "mydataset:v1" {
		t.Errorf("GetUrlIdentifier() = %q, want %q", got, "mydataset:v1")
	}
}

func TestDatasetInput_GetFolder_StripsVersionFromDataset(t *testing.T) {
	// Folder format: "<folder>/<dataset-without-tag>"
	input := DatasetInput{Folder: "data", Dataset: "mydataset:v1"}

	if got := input.GetFolder(); got != "data/mydataset" {
		t.Errorf("GetFolder() = %q, want %q", got, "data/mydataset")
	}
}

func TestDatasetInput_GetFolder_NoTagInDataset(t *testing.T) {
	// When Dataset has no ":", SplitN returns the whole value.
	input := DatasetInput{Folder: "data", Dataset: "mydataset"}

	if got := input.GetFolder(); got != "data/mydataset" {
		t.Errorf("GetFolder() = %q, want %q", got, "data/mydataset")
	}
}

func TestDatasetOutput_GetLogInfo_ReturnsDataset(t *testing.T) {
	output := DatasetOutput{Dataset: "outset:tag", Url: "s3://bucket/out"}

	if got := output.GetLogInfo(); got != "outset:tag" {
		t.Errorf("GetLogInfo() = %q, want %q", got, "outset:tag")
	}
}

func TestDatasetOutput_GetUrlIdentifier_ReturnsUrl(t *testing.T) {
	output := DatasetOutput{Dataset: "outset:tag", Url: "s3://bucket/out"}

	if got := output.GetUrlIdentifier(); got != "s3://bucket/out" {
		t.Errorf("GetUrlIdentifier() = %q, want %q", got, "s3://bucket/out")
	}
}

func TestUpdateDatasetOutput_GetLogInfo_ReturnsDataset(t *testing.T) {
	output := UpdateDatasetOutput{Dataset: "upd:tag", Url: "s3://bucket/upd"}

	if got := output.GetLogInfo(); got != "upd:tag" {
		t.Errorf("GetLogInfo() = %q, want %q", got, "upd:tag")
	}
}

func TestUpdateDatasetOutput_GetUrlIdentifier_ReturnsUrl(t *testing.T) {
	output := UpdateDatasetOutput{Dataset: "upd:tag", Url: "s3://bucket/upd"}

	if got := output.GetUrlIdentifier(); got != "s3://bucket/upd" {
		t.Errorf("GetUrlIdentifier() = %q, want %q", got, "s3://bucket/upd")
	}
}

func TestUrlInput_GetLogInfo_ReturnsUrl(t *testing.T) {
	input := UrlInput{Folder: "in", Url: "s3://bucket/x", Regex: ""}

	if got := input.GetLogInfo(); got != "s3://bucket/x" {
		t.Errorf("GetLogInfo() = %q, want %q", got, "s3://bucket/x")
	}
}

func TestUrlInput_GetUrlIdentifier_ReturnsUrl(t *testing.T) {
	input := UrlInput{Folder: "in", Url: "s3://bucket/x", Regex: ""}

	if got := input.GetUrlIdentifier(); got != "s3://bucket/x" {
		t.Errorf("GetUrlIdentifier() = %q, want %q", got, "s3://bucket/x")
	}
}

func TestUrlInput_GetFolder_ReturnsFolder(t *testing.T) {
	input := UrlInput{Folder: "in", Url: "s3://bucket/x", Regex: ""}

	if got := input.GetFolder(); got != "in" {
		t.Errorf("GetFolder() = %q, want %q", got, "in")
	}
}

func TestUrlOutput_GetLogInfo_ReturnsUrl(t *testing.T) {
	output := UrlOutput{Url: "s3://bucket/out", Regex: ""}

	if got := output.GetLogInfo(); got != "s3://bucket/out" {
		t.Errorf("GetLogInfo() = %q, want %q", got, "s3://bucket/out")
	}
}

func TestUrlOutput_GetUrlIdentifier_ReturnsUrl(t *testing.T) {
	output := UrlOutput{Url: "s3://bucket/out", Regex: ""}

	if got := output.GetUrlIdentifier(); got != "s3://bucket/out" {
		t.Errorf("GetUrlIdentifier() = %q, want %q", got, "s3://bucket/out")
	}
}

func TestKpiOutput_GetLogInfo_IncludesPath(t *testing.T) {
	output := KpiOutput{Url: "s3://bucket", Path: "kpi.json"}

	if got := output.GetLogInfo(); got != "KPI: kpi.json" {
		t.Errorf("GetLogInfo() = %q, want %q", got, "KPI: kpi.json")
	}
}

func TestKpiOutput_GetUrlIdentifier_JoinsUrlAndPath(t *testing.T) {
	output := KpiOutput{Url: "s3://bucket", Path: "kpi.json"}

	if got := output.GetUrlIdentifier(); got != "s3://bucket/kpi.json" {
		t.Errorf("GetUrlIdentifier() = %q, want %q", got, "s3://bucket/kpi.json")
	}
}

// ---------------------------------------------------------------------------
// ParseInputOutput tests — dispatch on prefix (task/url/dataset/update_dataset/kpi)
// ---------------------------------------------------------------------------

func TestParseInputOutput_Task_ThreePartsReturnsTaskInput(t *testing.T) {
	result := ParseInputOutput("task:myfolder,s3://bucket/dir/file.txt,*.txt")

	got, ok := result.(TaskInput)
	if !ok {
		t.Fatalf("expected TaskInput, got %T", result)
	}
	want := TaskInput{
		Folder: "myfolder",
		Name:   "file.txt",
		Url:    "s3://bucket/dir/file.txt",
		Regex:  "*.txt",
	}
	if got != want {
		t.Errorf("ParseInputOutput returned %+v, want %+v", got, want)
	}
}

func TestParseInputOutput_Task_UrlWithoutSlashUsesWholeNameAsBasename(t *testing.T) {
	// If the URL contains no '/', LastIndex returns -1 and the whole string
	// becomes the Name (the "<basename>" slice starts at index 0).
	result := ParseInputOutput("task:folder,bucket,regex")

	got, ok := result.(TaskInput)
	if !ok {
		t.Fatalf("expected TaskInput, got %T", result)
	}
	if got.Name != "bucket" {
		t.Errorf("Name = %q, want %q", got.Name, "bucket")
	}
	if got.Url != "bucket" {
		t.Errorf("Url = %q, want %q", got.Url, "bucket")
	}
}

func TestParseInputOutput_Task_SinglePartReturnsTaskOutput(t *testing.T) {
	result := ParseInputOutput("task:s3://bucket/dir/report.log")

	got, ok := result.(*TaskOutput)
	if !ok {
		t.Fatalf("expected *TaskOutput, got %T", result)
	}
	want := &TaskOutput{
		Name: "report.log",
		Url:  "s3://bucket/dir/report.log",
	}
	if *got != *want {
		t.Errorf("ParseInputOutput returned %+v, want %+v", got, want)
	}
}

func TestParseInputOutput_Url_TwoPartsReturnsUrlOutput(t *testing.T) {
	result := ParseInputOutput("url:s3://bucket/out,*.log")

	got, ok := result.(*UrlOutput)
	if !ok {
		t.Fatalf("expected *UrlOutput, got %T", result)
	}
	if got.Url != "s3://bucket/out" {
		t.Errorf("Url = %q, want %q", got.Url, "s3://bucket/out")
	}
	if got.Regex != "*.log" {
		t.Errorf("Regex = %q, want %q", got.Regex, "*.log")
	}
}

func TestParseInputOutput_Url_ThreePartsReturnsUrlInput(t *testing.T) {
	result := ParseInputOutput("url:myfolder,s3://bucket/in,*.txt")

	got, ok := result.(UrlInput)
	if !ok {
		t.Fatalf("expected UrlInput, got %T", result)
	}
	want := UrlInput{Folder: "myfolder", Url: "s3://bucket/in", Regex: "*.txt"}
	if got != want {
		t.Errorf("ParseInputOutput returned %+v, want %+v", got, want)
	}
}

func TestParseInputOutput_Dataset_InputWithoutSemicolon(t *testing.T) {
	result := ParseInputOutput("dataset:myfolder,mydataset:v1,myregex")

	got, ok := result.(DatasetInput)
	if !ok {
		t.Fatalf("expected DatasetInput, got %T", result)
	}
	want := DatasetInput{Folder: "myfolder", Dataset: "mydataset:v1", Regex: "myregex"}
	if got != want {
		t.Errorf("ParseInputOutput returned %+v, want %+v", got, want)
	}
}

func TestParseInputOutput_Dataset_OutputParsesMetadataLabelsRegex(t *testing.T) {
	// Format: dataset:<dataset>,<path>,<metadata>...;<labels>...;<regex>
	result := ParseInputOutput("dataset:myset,outpath,meta1,meta2;lbl1;myregex")

	got, ok := result.(*DatasetOutput)
	if !ok {
		t.Fatalf("expected *DatasetOutput, got %T", result)
	}
	if got.Dataset != "myset" {
		t.Errorf("Dataset = %q, want %q", got.Dataset, "myset")
	}
	if got.Path != "outpath" {
		t.Errorf("Path = %q, want %q", got.Path, "outpath")
	}
	wantMeta := []string{"meta1", "meta2"}
	if !reflect.DeepEqual([]string(got.Metadata), wantMeta) {
		t.Errorf("Metadata = %v, want %v", got.Metadata, wantMeta)
	}
	wantLabels := []string{"lbl1"}
	if !reflect.DeepEqual([]string(got.Labels), wantLabels) {
		t.Errorf("Labels = %v, want %v", got.Labels, wantLabels)
	}
	if got.Regex != "myregex" {
		t.Errorf("Regex = %q, want %q", got.Regex, "myregex")
	}
}

func TestParseInputOutput_Dataset_OutputEmptyMetadataAndLabels(t *testing.T) {
	// Empty metadata/labels sections produce nil slices.
	result := ParseInputOutput("dataset:myset,outpath,;;regex")

	got, ok := result.(*DatasetOutput)
	if !ok {
		t.Fatalf("expected *DatasetOutput, got %T", result)
	}
	if len(got.Metadata) != 0 {
		t.Errorf("Metadata = %v, want empty", got.Metadata)
	}
	if len(got.Labels) != 0 {
		t.Errorf("Labels = %v, want empty", got.Labels)
	}
	if got.Regex != "regex" {
		t.Errorf("Regex = %q, want %q", got.Regex, "regex")
	}
}

func TestParseInputOutput_UpdateDataset_ParsesAllFields(t *testing.T) {
	// update_dataset:<dataset>;<paths>;<metadata>;<labels>
	result := ParseInputOutput("update_dataset:myset:tag;path1,path2;meta1,meta2;lbl1,lbl2")

	got, ok := result.(*UpdateDatasetOutput)
	if !ok {
		t.Fatalf("expected *UpdateDatasetOutput, got %T", result)
	}
	if got.Dataset != "myset:tag" {
		t.Errorf("Dataset = %q, want %q", got.Dataset, "myset:tag")
	}
	wantPaths := []string{"path1", "path2"}
	if !reflect.DeepEqual([]string(got.Paths), wantPaths) {
		t.Errorf("Paths = %v, want %v", got.Paths, wantPaths)
	}
	wantMeta := []string{"meta1", "meta2"}
	if !reflect.DeepEqual([]string(got.Metadata), wantMeta) {
		t.Errorf("Metadata = %v, want %v", got.Metadata, wantMeta)
	}
	wantLabels := []string{"lbl1", "lbl2"}
	if !reflect.DeepEqual([]string(got.Labels), wantLabels) {
		t.Errorf("Labels = %v, want %v", got.Labels, wantLabels)
	}
}

func TestParseInputOutput_UpdateDataset_EmptyPathsDefaultsToSingleEmptyString(t *testing.T) {
	// When the paths field is empty, the parser substitutes a single empty
	// string so the downstream command still receives one path argument.
	result := ParseInputOutput("update_dataset:myset;;;")

	got, ok := result.(*UpdateDatasetOutput)
	if !ok {
		t.Fatalf("expected *UpdateDatasetOutput, got %T", result)
	}
	wantPaths := []string{""}
	if !reflect.DeepEqual([]string(got.Paths), wantPaths) {
		t.Errorf("Paths = %v, want %v", got.Paths, wantPaths)
	}
	if len(got.Metadata) != 0 {
		t.Errorf("Metadata = %v, want empty", got.Metadata)
	}
	if len(got.Labels) != 0 {
		t.Errorf("Labels = %v, want empty", got.Labels)
	}
}

func TestParseInputOutput_Kpi_ParsesUrlAndPath(t *testing.T) {
	result := ParseInputOutput("kpi:s3://bucket,reports/kpi.json")

	got, ok := result.(*KpiOutput)
	if !ok {
		t.Fatalf("expected *KpiOutput, got %T", result)
	}
	if got.Url != "s3://bucket" {
		t.Errorf("Url = %q, want %q", got.Url, "s3://bucket")
	}
	if got.Path != "reports/kpi.json" {
		t.Errorf("Path = %q, want %q", got.Path, "reports/kpi.json")
	}
}

func TestParseInputOutput_UnknownPrefix_Panics(t *testing.T) {
	defer func() {
		r := recover()
		if r == nil {
			t.Fatal("expected panic for unknown prefix, got none")
		}
	}()

	ParseInputOutput("garbage:whatever")
}

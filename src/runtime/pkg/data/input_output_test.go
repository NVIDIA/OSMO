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
	"fmt"
	"reflect"
	"testing"

	"go.corp.nvidia.com/osmo/runtime/pkg/common"
)

// --- Getter tests: TaskInput / TaskOutput ---

func TestTaskInput_Getters(t *testing.T) {
	f := TaskInput{
		Folder: "myfolder",
		Name:   "myname",
		Url:    "s3://bucket/key",
		Regex:  "*.txt",
	}
	if got := f.GetLogInfo(); got != "myname" {
		t.Errorf("GetLogInfo()=%q, want %q", got, "myname")
	}
	if got := f.GetUrlIdentifier(); got != "s3://bucket/key" {
		t.Errorf("GetUrlIdentifier()=%q, want %q", got, "s3://bucket/key")
	}
	if got := f.GetFolder(); got != "myfolder" {
		t.Errorf("GetFolder()=%q, want %q", got, "myfolder")
	}
}

func TestTaskOutput_Getters(t *testing.T) {
	f := TaskOutput{Name: "out-name", Url: "s3://bucket/out"}
	if got := f.GetLogInfo(); got != "out-name" {
		t.Errorf("GetLogInfo()=%q, want %q", got, "out-name")
	}
	if got := f.GetUrlIdentifier(); got != "s3://bucket/out" {
		t.Errorf("GetUrlIdentifier()=%q, want %q", got, "s3://bucket/out")
	}
}

// --- Getter tests: DatasetInput / DatasetOutput ---

func TestDatasetInput_Getters_PlainDataset(t *testing.T) {
	f := DatasetInput{Folder: "inputs", Dataset: "mydataset", Regex: ""}
	if got := f.GetLogInfo(); got != "mydataset" {
		t.Errorf("GetLogInfo()=%q, want %q", got, "mydataset")
	}
	if got := f.GetUrlIdentifier(); got != "mydataset" {
		t.Errorf("GetUrlIdentifier()=%q, want %q", got, "mydataset")
	}
	// GetFolder strips the tag suffix after ":" from the dataset and joins under Folder.
	if got := f.GetFolder(); got != "inputs/mydataset" {
		t.Errorf("GetFolder()=%q, want %q", got, "inputs/mydataset")
	}
}

func TestDatasetInput_GetFolder_StripsTagSuffix(t *testing.T) {
	f := DatasetInput{Folder: "inputs", Dataset: "mydataset:v1", Regex: ""}
	if got := f.GetFolder(); got != "inputs/mydataset" {
		t.Errorf("GetFolder()=%q, want %q", got, "inputs/mydataset")
	}
}

func TestDatasetInput_GetFolder_StripsOnlyFirstColon(t *testing.T) {
	// SplitN with n=2 keeps anything after the first colon in Dataset out of the folder.
	f := DatasetInput{Folder: "inputs", Dataset: "mydataset:v1:extra", Regex: ""}
	if got := f.GetFolder(); got != "inputs/mydataset" {
		t.Errorf("GetFolder()=%q, want %q", got, "inputs/mydataset")
	}
}

func TestDatasetOutput_Getters(t *testing.T) {
	f := DatasetOutput{Dataset: "my/dataset", Url: "s3://bucket/dataset"}
	if got := f.GetLogInfo(); got != "my/dataset" {
		t.Errorf("GetLogInfo()=%q, want %q", got, "my/dataset")
	}
	if got := f.GetUrlIdentifier(); got != "s3://bucket/dataset" {
		t.Errorf("GetUrlIdentifier()=%q, want %q", got, "s3://bucket/dataset")
	}
}

// --- Getter tests: UpdateDatasetOutput ---

func TestUpdateDatasetOutput_Getters(t *testing.T) {
	f := UpdateDatasetOutput{Dataset: "ds1", Url: "http://host/ds1"}
	if got := f.GetLogInfo(); got != "ds1" {
		t.Errorf("GetLogInfo()=%q, want %q", got, "ds1")
	}
	if got := f.GetUrlIdentifier(); got != "http://host/ds1" {
		t.Errorf("GetUrlIdentifier()=%q, want %q", got, "http://host/ds1")
	}
}

// --- Getter tests: UrlInput / UrlOutput ---

func TestUrlInput_Getters(t *testing.T) {
	f := UrlInput{Folder: "f1", Url: "s3://bucket/prefix", Regex: ".*\\.bin"}
	if got := f.GetLogInfo(); got != "s3://bucket/prefix" {
		t.Errorf("GetLogInfo()=%q, want %q", got, "s3://bucket/prefix")
	}
	if got := f.GetUrlIdentifier(); got != "s3://bucket/prefix" {
		t.Errorf("GetUrlIdentifier()=%q, want %q", got, "s3://bucket/prefix")
	}
	if got := f.GetFolder(); got != "f1" {
		t.Errorf("GetFolder()=%q, want %q", got, "f1")
	}
}

func TestUrlOutput_Getters(t *testing.T) {
	f := UrlOutput{Url: "s3://bucket/out", Regex: ""}
	if got := f.GetLogInfo(); got != "s3://bucket/out" {
		t.Errorf("GetLogInfo()=%q, want %q", got, "s3://bucket/out")
	}
	if got := f.GetUrlIdentifier(); got != "s3://bucket/out" {
		t.Errorf("GetUrlIdentifier()=%q, want %q", got, "s3://bucket/out")
	}
}

// --- Getter tests: KpiOutput ---

func TestKpiOutput_GetLogInfo_PrefixesWithKPI(t *testing.T) {
	f := KpiOutput{Url: "s3://bucket/out", Path: "scores.json"}
	if got := f.GetLogInfo(); got != "KPI: scores.json" {
		t.Errorf("GetLogInfo()=%q, want %q", got, "KPI: scores.json")
	}
}

func TestKpiOutput_GetUrlIdentifier_JoinsUrlAndPath(t *testing.T) {
	f := KpiOutput{Url: "s3://bucket/out", Path: "scores.json"}
	want := "s3://bucket/out/scores.json"
	if got := f.GetUrlIdentifier(); got != want {
		t.Errorf("GetUrlIdentifier()=%q, want %q", got, want)
	}
}

// --- ParseInputOutput: task ---

func TestParseInputOutput_TaskInput_ThreeFieldsProducesTaskInput(t *testing.T) {
	got := ParseInputOutput("task:myfolder,https://host.example.com/path/file.bin,*.bin")
	want := TaskInput{
		Folder: "myfolder",
		Name:   "file.bin",
		Url:    "https://host.example.com/path/file.bin",
		Regex:  "*.bin",
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("ParseInputOutput()=%#v, want %#v", got, want)
	}
}

func TestParseInputOutput_TaskInput_NameIsUrlWhenNoSlash(t *testing.T) {
	// LastIndex returns -1 when no slash; +1 → 0, so Name == full Url.
	got := ParseInputOutput("task:myfolder,plainurl,*.bin")
	taskInput, ok := got.(TaskInput)
	if !ok {
		t.Fatalf("expected TaskInput, got %T", got)
	}
	if taskInput.Name != "plainurl" {
		t.Errorf("Name=%q, want %q", taskInput.Name, "plainurl")
	}
	if taskInput.Url != "plainurl" {
		t.Errorf("Url=%q, want %q", taskInput.Url, "plainurl")
	}
}

func TestParseInputOutput_TaskOutput_SingleFieldProducesTaskOutput(t *testing.T) {
	got := ParseInputOutput("task:https://host.example.com/path/file.bin")
	taskOutput, ok := got.(*TaskOutput)
	if !ok {
		t.Fatalf("expected *TaskOutput, got %T", got)
	}
	if taskOutput.Name != "file.bin" {
		t.Errorf("Name=%q, want %q", taskOutput.Name, "file.bin")
	}
	if taskOutput.Url != "https://host.example.com/path/file.bin" {
		t.Errorf("Url=%q, want %q", taskOutput.Url, "https://host.example.com/path/file.bin")
	}
}

// --- ParseInputOutput: url ---

func TestParseInputOutput_UrlInput_ThreeFieldsProducesUrlInput(t *testing.T) {
	got := ParseInputOutput("url:dest,s3://bucket/prefix,*.txt")
	want := UrlInput{Folder: "dest", Url: "s3://bucket/prefix", Regex: "*.txt"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("ParseInputOutput()=%#v, want %#v", got, want)
	}
}

func TestParseInputOutput_UrlOutput_TwoFieldsProducesUrlOutput(t *testing.T) {
	got := ParseInputOutput("url:s3://bucket/out,*.json")
	urlOutput, ok := got.(*UrlOutput)
	if !ok {
		t.Fatalf("expected *UrlOutput, got %T", got)
	}
	if urlOutput.Url != "s3://bucket/out" {
		t.Errorf("Url=%q, want %q", urlOutput.Url, "s3://bucket/out")
	}
	if urlOutput.Regex != "*.json" {
		t.Errorf("Regex=%q, want %q", urlOutput.Regex, "*.json")
	}
}

// --- ParseInputOutput: dataset ---

func TestParseInputOutput_DatasetInput_NoSemicolonProducesDatasetInput(t *testing.T) {
	got := ParseInputOutput("dataset:inputs,mydataset,*.bin")
	want := DatasetInput{Folder: "inputs", Dataset: "mydataset", Regex: "*.bin"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("ParseInputOutput()=%#v, want %#v", got, want)
	}
}

func TestParseInputOutput_DatasetInput_WithTagInDataset(t *testing.T) {
	got := ParseInputOutput("dataset:inputs,mydataset:v2,*.bin")
	want := DatasetInput{Folder: "inputs", Dataset: "mydataset:v2", Regex: "*.bin"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("ParseInputOutput()=%#v, want %#v", got, want)
	}
}

func TestParseInputOutput_DatasetOutput_WithSemicolons(t *testing.T) {
	got := ParseInputOutput("dataset:mydataset,somepath,meta1.json,meta2.json;label1.json,label2.json;*.bin")
	datasetOutput, ok := got.(*DatasetOutput)
	if !ok {
		t.Fatalf("expected *DatasetOutput, got %T", got)
	}
	if datasetOutput.Dataset != "mydataset" {
		t.Errorf("Dataset=%q, want %q", datasetOutput.Dataset, "mydataset")
	}
	if datasetOutput.Path != "somepath" {
		t.Errorf("Path=%q, want %q", datasetOutput.Path, "somepath")
	}
	wantMetadata := common.ArrayFlags{"meta1.json", "meta2.json"}
	if !reflect.DeepEqual(datasetOutput.Metadata, wantMetadata) {
		t.Errorf("Metadata=%#v, want %#v", datasetOutput.Metadata, wantMetadata)
	}
	wantLabels := common.ArrayFlags{"label1.json", "label2.json"}
	if !reflect.DeepEqual(datasetOutput.Labels, wantLabels) {
		t.Errorf("Labels=%#v, want %#v", datasetOutput.Labels, wantLabels)
	}
	if datasetOutput.Regex != "*.bin" {
		t.Errorf("Regex=%q, want %q", datasetOutput.Regex, "*.bin")
	}
	if datasetOutput.MetadataFile != "" {
		t.Errorf("MetadataFile=%q, want empty", datasetOutput.MetadataFile)
	}
	if datasetOutput.Url != "" {
		t.Errorf("Url=%q, want empty", datasetOutput.Url)
	}
}

func TestParseInputOutput_DatasetOutput_EmptyMetadataAndLabels(t *testing.T) {
	// The semicolon-delimited sections may be empty; parser treats "" as nil (no split).
	got := ParseInputOutput("dataset:mydataset,somepath,;;*.bin")
	datasetOutput, ok := got.(*DatasetOutput)
	if !ok {
		t.Fatalf("expected *DatasetOutput, got %T", got)
	}
	if datasetOutput.Metadata != nil {
		t.Errorf("Metadata=%#v, want nil", datasetOutput.Metadata)
	}
	if datasetOutput.Labels != nil {
		t.Errorf("Labels=%#v, want nil", datasetOutput.Labels)
	}
	if datasetOutput.Regex != "*.bin" {
		t.Errorf("Regex=%q, want %q", datasetOutput.Regex, "*.bin")
	}
}

// --- ParseInputOutput: update_dataset ---

func TestParseInputOutput_UpdateDatasetOutput_AllFieldsPopulated(t *testing.T) {
	got := ParseInputOutput("update_dataset:mydataset;p1,p2;meta1.json,meta2.json;label1.json")
	updateOutput, ok := got.(*UpdateDatasetOutput)
	if !ok {
		t.Fatalf("expected *UpdateDatasetOutput, got %T", got)
	}
	if updateOutput.Dataset != "mydataset" {
		t.Errorf("Dataset=%q, want %q", updateOutput.Dataset, "mydataset")
	}
	wantPaths := common.ArrayFlags{"p1", "p2"}
	if !reflect.DeepEqual(updateOutput.Paths, wantPaths) {
		t.Errorf("Paths=%#v, want %#v", updateOutput.Paths, wantPaths)
	}
	wantMetadata := common.ArrayFlags{"meta1.json", "meta2.json"}
	if !reflect.DeepEqual(updateOutput.Metadata, wantMetadata) {
		t.Errorf("Metadata=%#v, want %#v", updateOutput.Metadata, wantMetadata)
	}
	wantLabels := common.ArrayFlags{"label1.json"}
	if !reflect.DeepEqual(updateOutput.Labels, wantLabels) {
		t.Errorf("Labels=%#v, want %#v", updateOutput.Labels, wantLabels)
	}
}

func TestParseInputOutput_UpdateDatasetOutput_EmptyPathsGetsSingletonBlank(t *testing.T) {
	// When the paths section is empty the parser substitutes [""] (single blank entry).
	got := ParseInputOutput("update_dataset:mydataset;;;")
	updateOutput, ok := got.(*UpdateDatasetOutput)
	if !ok {
		t.Fatalf("expected *UpdateDatasetOutput, got %T", got)
	}
	wantPaths := common.ArrayFlags{""}
	if !reflect.DeepEqual(updateOutput.Paths, wantPaths) {
		t.Errorf("Paths=%#v, want %#v", updateOutput.Paths, wantPaths)
	}
	if updateOutput.Metadata != nil {
		t.Errorf("Metadata=%#v, want nil", updateOutput.Metadata)
	}
	if updateOutput.Labels != nil {
		t.Errorf("Labels=%#v, want nil", updateOutput.Labels)
	}
}

// --- ParseInputOutput: kpi ---

func TestParseInputOutput_KpiOutput_TwoFields(t *testing.T) {
	got := ParseInputOutput("kpi:s3://bucket/out,scores.json")
	kpiOutput, ok := got.(*KpiOutput)
	if !ok {
		t.Fatalf("expected *KpiOutput, got %T", got)
	}
	if kpiOutput.Url != "s3://bucket/out" {
		t.Errorf("Url=%q, want %q", kpiOutput.Url, "s3://bucket/out")
	}
	if kpiOutput.Path != "scores.json" {
		t.Errorf("Path=%q, want %q", kpiOutput.Path, "scores.json")
	}
}

// --- ParseInputOutput: unknown prefix panics ---

func TestParseInputOutput_UnknownPrefix_Panics(t *testing.T) {
	defer func() {
		r := recover()
		if r == nil {
			t.Fatalf("expected panic for unknown prefix, got none")
		}
		msg := fmt.Sprintf("%v", r)
		if msg == "" {
			t.Errorf("panic message is empty")
		}
	}()
	ParseInputOutput("bogus:whatever")
}

// --- InputOutput interface satisfaction (compile-time guard) ---

func TestInputOutputInterface_AllTypesImplement(t *testing.T) {
	// Confirm each concrete type is assignable to InputOutput; this guards against
	// accidental renames of GetLogInfo / GetUrlIdentifier.
	types := []InputOutput{
		TaskInput{},
		&TaskOutput{},
		DatasetInput{},
		&DatasetOutput{},
		&UpdateDatasetOutput{},
		UrlInput{},
		&UrlOutput{},
		&KpiOutput{},
	}
	if len(types) != 8 {
		t.Errorf("expected 8 concrete InputOutput types, got %d", len(types))
	}
}

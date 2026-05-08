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

// ---------- ParseInputOutput: task ----------

func TestParseInputOutput_TaskInput_WithSlashUrl(t *testing.T) {
	got := ParseInputOutput("task:myfolder,s3://bucket/prefix/key,*.txt")

	want := TaskInput{
		Folder: "myfolder",
		Name:   "key",
		Url:    "s3://bucket/prefix/key",
		Regex:  "*.txt",
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("TaskInput mismatch:\n got %#v\nwant %#v", got, want)
	}
}

func TestParseInputOutput_TaskInput_UrlWithoutSlashUsesFullName(t *testing.T) {
	// No '/' in url → LastIndex returns -1, +1 = 0, so Name == full url.
	got := ParseInputOutput("task:folder,bareurl,regex")
	ti, ok := got.(TaskInput)
	if !ok {
		t.Fatalf("expected TaskInput, got %T", got)
	}
	if ti.Name != "bareurl" {
		t.Fatalf("expected Name == 'bareurl', got %q", ti.Name)
	}
}

func TestParseInputOutput_TaskInput_EmptyRegex(t *testing.T) {
	got := ParseInputOutput("task:folder,http://host/a/b,")
	ti, ok := got.(TaskInput)
	if !ok {
		t.Fatalf("expected TaskInput, got %T", got)
	}
	if ti.Regex != "" {
		t.Fatalf("expected empty regex, got %q", ti.Regex)
	}
	if ti.Name != "b" {
		t.Fatalf("expected Name == 'b', got %q", ti.Name)
	}
}

func TestParseInputOutput_TaskOutput_WithSlashUrl(t *testing.T) {
	got := ParseInputOutput("task:s3://bucket/prefix/myobj")
	to, ok := got.(*TaskOutput)
	if !ok {
		t.Fatalf("expected *TaskOutput, got %T", got)
	}
	if to.Name != "myobj" {
		t.Fatalf("expected Name 'myobj', got %q", to.Name)
	}
	if to.Url != "s3://bucket/prefix/myobj" {
		t.Fatalf("unexpected Url %q", to.Url)
	}
}

func TestParseInputOutput_TaskOutput_UrlWithoutSlash(t *testing.T) {
	got := ParseInputOutput("task:noslashes")
	to, ok := got.(*TaskOutput)
	if !ok {
		t.Fatalf("expected *TaskOutput, got %T", got)
	}
	if to.Name != "noslashes" || to.Url != "noslashes" {
		t.Fatalf("expected Name == Url == 'noslashes', got name=%q url=%q", to.Name, to.Url)
	}
}

// ---------- ParseInputOutput: url ----------

func TestParseInputOutput_UrlInput(t *testing.T) {
	got := ParseInputOutput("url:folder,s3://bucket/key,*.txt")
	want := UrlInput{Folder: "folder", Url: "s3://bucket/key", Regex: "*.txt"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("UrlInput mismatch:\n got %#v\nwant %#v", got, want)
	}
}

func TestParseInputOutput_UrlOutput(t *testing.T) {
	got := ParseInputOutput("url:s3://bucket/key,*.txt")
	uo, ok := got.(*UrlOutput)
	if !ok {
		t.Fatalf("expected *UrlOutput, got %T", got)
	}
	if uo.Url != "s3://bucket/key" || uo.Regex != "*.txt" {
		t.Fatalf("unexpected UrlOutput: %#v", uo)
	}
}

// ---------- ParseInputOutput: dataset ----------

func TestParseInputOutput_DatasetInput_NoSemicolon(t *testing.T) {
	got := ParseInputOutput("dataset:folder,mydataset,regex")
	want := DatasetInput{Folder: "folder", Dataset: "mydataset", Regex: "regex"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("DatasetInput mismatch:\n got %#v\nwant %#v", got, want)
	}
}

func TestParseInputOutput_DatasetInput_DatasetWithTag(t *testing.T) {
	// Dataset with version tag — still a DatasetInput (no ';').
	got := ParseInputOutput("dataset:folder,mydataset:v1,.*")
	di, ok := got.(DatasetInput)
	if !ok {
		t.Fatalf("expected DatasetInput, got %T", got)
	}
	if di.Dataset != "mydataset:v1" {
		t.Fatalf("expected Dataset 'mydataset:v1', got %q", di.Dataset)
	}
}

func TestParseInputOutput_DatasetOutput_AllFieldsPopulated(t *testing.T) {
	// Format: dataset:<dataset>,<path>,<metadata,csv>;<labels,csv>;<regex>
	got := ParseInputOutput("dataset:mydataset,somepath,meta1,meta2;label1,label2;*.csv")
	out, ok := got.(*DatasetOutput)
	if !ok {
		t.Fatalf("expected *DatasetOutput, got %T", got)
	}
	if out.Dataset != "mydataset" {
		t.Fatalf("expected Dataset 'mydataset', got %q", out.Dataset)
	}
	if out.Path != "somepath" {
		t.Fatalf("expected Path 'somepath', got %q", out.Path)
	}
	if !reflect.DeepEqual([]string(out.Metadata), []string{"meta1", "meta2"}) {
		t.Fatalf("unexpected Metadata: %v", out.Metadata)
	}
	if !reflect.DeepEqual([]string(out.Labels), []string{"label1", "label2"}) {
		t.Fatalf("unexpected Labels: %v", out.Labels)
	}
	if out.Regex != "*.csv" {
		t.Fatalf("expected Regex '*.csv', got %q", out.Regex)
	}
	if out.MetadataFile != "" || out.Url != "" {
		t.Fatalf("expected MetadataFile and Url empty, got %q %q", out.MetadataFile, out.Url)
	}
}

func TestParseInputOutput_DatasetOutput_EmptyMetadataAndLabels(t *testing.T) {
	// Empty metadata + empty labels sections; only final regex populated.
	got := ParseInputOutput("dataset:mydataset,path,;;*.csv")
	out, ok := got.(*DatasetOutput)
	if !ok {
		t.Fatalf("expected *DatasetOutput, got %T", got)
	}
	if len(out.Metadata) != 0 {
		t.Fatalf("expected empty Metadata, got %v", out.Metadata)
	}
	if len(out.Labels) != 0 {
		t.Fatalf("expected empty Labels, got %v", out.Labels)
	}
	if out.Regex != "*.csv" {
		t.Fatalf("expected regex '*.csv', got %q", out.Regex)
	}
}

// ---------- ParseInputOutput: update_dataset ----------

func TestParseInputOutput_UpdateDatasetOutput_AllFields(t *testing.T) {
	got := ParseInputOutput("update_dataset:mydataset;p1,p2;meta1,meta2;label1")
	out, ok := got.(*UpdateDatasetOutput)
	if !ok {
		t.Fatalf("expected *UpdateDatasetOutput, got %T", got)
	}
	if out.Dataset != "mydataset" {
		t.Fatalf("expected Dataset 'mydataset', got %q", out.Dataset)
	}
	if !reflect.DeepEqual([]string(out.Paths), []string{"p1", "p2"}) {
		t.Fatalf("unexpected Paths: %v", out.Paths)
	}
	if !reflect.DeepEqual([]string(out.Metadata), []string{"meta1", "meta2"}) {
		t.Fatalf("unexpected Metadata: %v", out.Metadata)
	}
	if !reflect.DeepEqual([]string(out.Labels), []string{"label1"}) {
		t.Fatalf("unexpected Labels: %v", out.Labels)
	}
}

func TestParseInputOutput_UpdateDatasetOutput_EmptyPathsBecomesSingleEmpty(t *testing.T) {
	// When paths section is empty, pathsLocation defaults to [""] (not empty slice).
	got := ParseInputOutput("update_dataset:mydataset;;;")
	out, ok := got.(*UpdateDatasetOutput)
	if !ok {
		t.Fatalf("expected *UpdateDatasetOutput, got %T", got)
	}
	if !reflect.DeepEqual([]string(out.Paths), []string{""}) {
		t.Fatalf("expected Paths==[\"\"], got %v", out.Paths)
	}
	if len(out.Metadata) != 0 {
		t.Fatalf("expected empty Metadata, got %v", out.Metadata)
	}
	if len(out.Labels) != 0 {
		t.Fatalf("expected empty Labels, got %v", out.Labels)
	}
}

// ---------- ParseInputOutput: kpi ----------

func TestParseInputOutput_KpiOutput(t *testing.T) {
	got := ParseInputOutput("kpi:http://example.com/bucket,results.json")
	out, ok := got.(*KpiOutput)
	if !ok {
		t.Fatalf("expected *KpiOutput, got %T", got)
	}
	if out.Url != "http://example.com/bucket" || out.Path != "results.json" {
		t.Fatalf("unexpected KpiOutput: %#v", out)
	}
}

// ---------- ParseInputOutput: unknown prefix ----------

func TestParseInputOutput_UnknownPrefix_Panics(t *testing.T) {
	defer func() {
		if r := recover(); r == nil {
			t.Fatalf("expected panic for unknown prefix, got none")
		}
	}()
	ParseInputOutput("foo:bar")
}

// ---------- GetLogInfo / GetUrlIdentifier / GetFolder ----------

func TestTaskInput_Getters(t *testing.T) {
	ti := TaskInput{Folder: "folder", Name: "name", Url: "http://u", Regex: "r"}
	if ti.GetLogInfo() != "name" {
		t.Fatalf("GetLogInfo: got %q", ti.GetLogInfo())
	}
	if ti.GetUrlIdentifier() != "http://u" {
		t.Fatalf("GetUrlIdentifier: got %q", ti.GetUrlIdentifier())
	}
	if ti.GetFolder() != "folder" {
		t.Fatalf("GetFolder: got %q", ti.GetFolder())
	}
}

func TestTaskOutput_Getters(t *testing.T) {
	to := TaskOutput{Name: "name", Url: "http://u"}
	if to.GetLogInfo() != "name" {
		t.Fatalf("GetLogInfo: got %q", to.GetLogInfo())
	}
	if to.GetUrlIdentifier() != "http://u" {
		t.Fatalf("GetUrlIdentifier: got %q", to.GetUrlIdentifier())
	}
}

func TestDatasetInput_Getters_NoTag(t *testing.T) {
	di := DatasetInput{Folder: "folder", Dataset: "mydataset", Regex: "r"}
	if di.GetLogInfo() != "mydataset" {
		t.Fatalf("GetLogInfo: got %q", di.GetLogInfo())
	}
	if di.GetUrlIdentifier() != "mydataset" {
		t.Fatalf("GetUrlIdentifier: got %q", di.GetUrlIdentifier())
	}
	if got := di.GetFolder(); got != "folder/mydataset" {
		t.Fatalf("GetFolder: got %q, want 'folder/mydataset'", got)
	}
}

func TestDatasetInput_GetFolder_StripsTag(t *testing.T) {
	// GetFolder uses SplitN with n=2, so tag (and further ':') is stripped.
	di := DatasetInput{Folder: "folder", Dataset: "mydataset:v1"}
	if got := di.GetFolder(); got != "folder/mydataset" {
		t.Fatalf("GetFolder: got %q, want 'folder/mydataset'", got)
	}
}

func TestDatasetInput_GetFolder_NoColonUsesWholeDataset(t *testing.T) {
	di := DatasetInput{Folder: "", Dataset: "d"}
	if got := di.GetFolder(); got != "/d" {
		t.Fatalf("GetFolder: got %q, want '/d'", got)
	}
}

func TestDatasetOutput_Getters(t *testing.T) {
	d := DatasetOutput{Dataset: "mydataset", Url: "http://u"}
	if d.GetLogInfo() != "mydataset" {
		t.Fatalf("GetLogInfo: got %q", d.GetLogInfo())
	}
	if d.GetUrlIdentifier() != "http://u" {
		t.Fatalf("GetUrlIdentifier: got %q", d.GetUrlIdentifier())
	}
}

func TestUpdateDatasetOutput_Getters(t *testing.T) {
	d := UpdateDatasetOutput{Dataset: "mydataset", Url: "http://u"}
	if d.GetLogInfo() != "mydataset" {
		t.Fatalf("GetLogInfo: got %q", d.GetLogInfo())
	}
	if d.GetUrlIdentifier() != "http://u" {
		t.Fatalf("GetUrlIdentifier: got %q", d.GetUrlIdentifier())
	}
}

func TestUrlInput_Getters(t *testing.T) {
	u := UrlInput{Folder: "folder", Url: "http://u", Regex: "r"}
	if u.GetLogInfo() != "http://u" {
		t.Fatalf("GetLogInfo: got %q", u.GetLogInfo())
	}
	if u.GetUrlIdentifier() != "http://u" {
		t.Fatalf("GetUrlIdentifier: got %q", u.GetUrlIdentifier())
	}
	if u.GetFolder() != "folder" {
		t.Fatalf("GetFolder: got %q", u.GetFolder())
	}
}

func TestUrlOutput_Getters(t *testing.T) {
	u := UrlOutput{Url: "http://u", Regex: "r"}
	if u.GetLogInfo() != "http://u" {
		t.Fatalf("GetLogInfo: got %q", u.GetLogInfo())
	}
	if u.GetUrlIdentifier() != "http://u" {
		t.Fatalf("GetUrlIdentifier: got %q", u.GetUrlIdentifier())
	}
}

func TestKpiOutput_Getters(t *testing.T) {
	k := KpiOutput{Url: "http://u", Path: "results.json"}
	if got := k.GetLogInfo(); got != "KPI: results.json" {
		t.Fatalf("GetLogInfo: got %q", got)
	}
	if got := k.GetUrlIdentifier(); got != "http://u/results.json" {
		t.Fatalf("GetUrlIdentifier: got %q", got)
	}
}

// ---------- InputOutput interface conformance ----------

// TestInputOutputInterfaceConformance ensures ParseInputOutput returns values
// that satisfy the InputOutput interface across all prefix variants.
func TestInputOutputInterfaceConformance(t *testing.T) {
	cases := []struct {
		name  string
		value string
	}{
		{"task-input", "task:f,s3://b/k,r"},
		{"task-output", "task:s3://b/k"},
		{"url-input", "url:f,s3://b/k,r"},
		{"url-output", "url:s3://b/k,r"},
		{"dataset-input", "dataset:f,d,r"},
		{"dataset-output", "dataset:d,p,;;r"},
		{"update_dataset", "update_dataset:d;;;"},
		{"kpi", "kpi:u,p"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			io := ParseInputOutput(tc.value)
			// Just invoke the interface methods to confirm conformance.
			_ = io.GetLogInfo()
			_ = io.GetUrlIdentifier()
		})
	}
}

// Sanity check: confirm common.ArrayFlags conversion used by DatasetOutput/UpdateDatasetOutput
// still accepts plain []string (future-proofs the parse tests above).
func TestArrayFlagsCompatibility(t *testing.T) {
	var af common.ArrayFlags = []string{"a", "b"}
	if len(af) != 2 || af[0] != "a" || af[1] != "b" {
		t.Fatalf("ArrayFlags did not round-trip: %v", af)
	}
}

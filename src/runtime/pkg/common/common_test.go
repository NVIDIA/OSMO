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

package common

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestArrayFlags_String_Empty(t *testing.T) {
	var flags ArrayFlags
	got := flags.String()
	if got != "[]" {
		t.Errorf("expected %q, got %q", "[]", got)
	}
}

func TestArrayFlags_String_WithValues(t *testing.T) {
	flags := ArrayFlags{"a", "b"}
	got := flags.String()
	if got != "[a b]" {
		t.Errorf("expected %q, got %q", "[a b]", got)
	}
}

func TestArrayFlags_Set_AppendsValue(t *testing.T) {
	var flags ArrayFlags
	if err := flags.Set("first"); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if err := flags.Set("second"); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !reflect.DeepEqual([]string(flags), []string{"first", "second"}) {
		t.Errorf("expected [first second], got %v", flags)
	}
}

func TestSingleFileInFolder_WithSingleFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "only.txt")
	if err := os.WriteFile(path, []byte("hi"), 0644); err != nil {
		t.Fatalf("setup failed: %v", err)
	}
	if !SingleFileInFolder(dir) {
		t.Errorf("expected true for folder with single file")
	}
}

func TestSingleFileInFolder_WithTwoFiles(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "a.txt"), []byte("a"), 0644); err != nil {
		t.Fatalf("setup failed: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "b.txt"), []byte("b"), 0644); err != nil {
		t.Fatalf("setup failed: %v", err)
	}
	if SingleFileInFolder(dir) {
		t.Errorf("expected false for folder with two files")
	}
}

func TestSingleFileInFolder_WithSingleSubdir(t *testing.T) {
	dir := t.TempDir()
	if err := os.Mkdir(filepath.Join(dir, "sub"), 0755); err != nil {
		t.Fatalf("setup failed: %v", err)
	}
	if SingleFileInFolder(dir) {
		t.Errorf("expected false when the single entry is a directory")
	}
}

func TestSingleFileInFolder_NonExistentReturnsFalse(t *testing.T) {
	if SingleFileInFolder("/does/not/exist/path/xyz") {
		t.Errorf("expected false for non-existent directory")
	}
}

func TestAppendStringToList_PrependsPrefix(t *testing.T) {
	got := AppendStringToList("pre-", []string{"a", "b", "c"})
	want := []string{"pre-a", "pre-b", "pre-c"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("expected %v, got %v", want, got)
	}
}

func TestAppendStringToList_EmptyListReturnsEmpty(t *testing.T) {
	got := AppendStringToList("pre-", []string{})
	if len(got) != 0 {
		t.Errorf("expected empty slice, got %v", got)
	}
}

func TestAppendStringToList_EmptyStringPrefix(t *testing.T) {
	got := AppendStringToList("", []string{"a"})
	want := []string{"a"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("expected %v, got %v", want, got)
	}
}

func TestGetFiles_MatchesPattern(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "a.txt"), []byte(""), 0644); err != nil {
		t.Fatalf("setup failed: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "b.txt"), []byte(""), 0644); err != nil {
		t.Fatalf("setup failed: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "c.log"), []byte(""), 0644); err != nil {
		t.Fatalf("setup failed: %v", err)
	}

	osmoChan := make(chan string, 10)
	files := GetFiles(filepath.Join(dir, "*.txt"), osmoChan)
	if len(files) != 2 {
		t.Errorf("expected 2 matches, got %d: %v", len(files), files)
	}
}

func TestGetFiles_NoMatchesReturnsEmpty(t *testing.T) {
	dir := t.TempDir()
	osmoChan := make(chan string, 10)
	files := GetFiles(filepath.Join(dir, "*.txt"), osmoChan)
	if len(files) != 0 {
		t.Errorf("expected 0 matches, got %d: %v", len(files), files)
	}
}

func TestIsDirEmpty_EmptyDirReturnsTrue(t *testing.T) {
	dir := t.TempDir()
	empty, err := IsDirEmpty(dir)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !empty {
		t.Errorf("expected true for empty directory")
	}
}

func TestIsDirEmpty_NonEmptyDirReturnsFalse(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "a.txt"), []byte("x"), 0644); err != nil {
		t.Fatalf("setup failed: %v", err)
	}
	empty, err := IsDirEmpty(dir)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if empty {
		t.Errorf("expected false for non-empty directory")
	}
}

func TestIsDirEmpty_NonExistentReturnsError(t *testing.T) {
	_, err := IsDirEmpty("/does/not/exist/path/xyz")
	if err == nil {
		t.Errorf("expected error for non-existent directory")
	}
}

func TestCalculateFolderSize_EmptyDir(t *testing.T) {
	dir := t.TempDir()
	size, numFiles := CalculateFolderSize(dir)
	if size != 0 {
		t.Errorf("expected size 0, got %d", size)
	}
	if numFiles != 0 {
		t.Errorf("expected 0 files, got %d", numFiles)
	}
}

func TestCalculateFolderSize_WithFiles(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "a.txt"), []byte("12345"), 0644); err != nil {
		t.Fatalf("setup failed: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "b.txt"), []byte("abc"), 0644); err != nil {
		t.Fatalf("setup failed: %v", err)
	}
	size, numFiles := CalculateFolderSize(dir)
	if size != 8 {
		t.Errorf("expected total size 8, got %d", size)
	}
	if numFiles != 2 {
		t.Errorf("expected 2 files, got %d", numFiles)
	}
}

func TestCalculateFolderSize_NestedDirs(t *testing.T) {
	dir := t.TempDir()
	sub := filepath.Join(dir, "sub")
	if err := os.Mkdir(sub, 0755); err != nil {
		t.Fatalf("setup failed: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "top.txt"), []byte("12"), 0644); err != nil {
		t.Fatalf("setup failed: %v", err)
	}
	if err := os.WriteFile(filepath.Join(sub, "nested.txt"), []byte("abcd"), 0644); err != nil {
		t.Fatalf("setup failed: %v", err)
	}
	size, numFiles := CalculateFolderSize(dir)
	if size != 6 {
		t.Errorf("expected total size 6, got %d", size)
	}
	if numFiles != 2 {
		t.Errorf("expected 2 files, got %d", numFiles)
	}
}

func TestCalculateFolderSize_NonExistentReturnsZero(t *testing.T) {
	size, numFiles := CalculateFolderSize("/does/not/exist/path/xyz")
	if size != 0 {
		t.Errorf("expected size 0, got %d", size)
	}
	if numFiles != 0 {
		t.Errorf("expected 0 files, got %d", numFiles)
	}
}

func TestCheckIfFileExists_ExistingFileReturnsTrue(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "exists.txt")
	if err := os.WriteFile(path, []byte(""), 0644); err != nil {
		t.Fatalf("setup failed: %v", err)
	}
	osmoChan := make(chan string, 5)
	if !CheckIfFileExists(path, osmoChan) {
		t.Errorf("expected true for existing file")
	}
}

func TestCheckIfFileExists_MissingFileReturnsFalseAndSendsMessage(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "missing.txt")
	osmoChan := make(chan string, 5)
	if CheckIfFileExists(path, osmoChan) {
		t.Errorf("expected false for missing file")
	}
	select {
	case msg := <-osmoChan:
		if msg != "File does not exist: "+path {
			t.Errorf("unexpected message: %q", msg)
		}
	default:
		t.Errorf("expected message on channel")
	}
}

func TestNewCircularBuffer_StartsEmpty(t *testing.T) {
	buf := NewCircularBuffer(3)
	if !buf.IsEmpty() {
		t.Errorf("expected new buffer to be empty")
	}
	if buf.IsFull() {
		t.Errorf("expected new buffer to not be full")
	}
}

func TestCircularBuffer_PushThenPeekReturnsOldest(t *testing.T) {
	buf := NewCircularBuffer(3)
	if err := buf.Push("a"); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if err := buf.Push("b"); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	val, err := buf.Peek()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if val != "a" {
		t.Errorf("expected 'a', got %q", val)
	}
}

func TestCircularBuffer_PeekDoesNotRemove(t *testing.T) {
	buf := NewCircularBuffer(2)
	if err := buf.Push("x"); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if _, err := buf.Peek(); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if buf.IsEmpty() {
		t.Errorf("Peek should not remove element")
	}
}

func TestCircularBuffer_PopReturnsAndRemovesOldest(t *testing.T) {
	buf := NewCircularBuffer(3)
	if err := buf.Push("first"); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if err := buf.Push("second"); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	val, err := buf.Pop()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if val != "first" {
		t.Errorf("expected 'first', got %q", val)
	}
	next, err := buf.Peek()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if next != "second" {
		t.Errorf("expected 'second' after pop, got %q", next)
	}
}

func TestCircularBuffer_PopEmptyReturnsError(t *testing.T) {
	buf := NewCircularBuffer(2)
	_, err := buf.Pop()
	if err == nil {
		t.Errorf("expected error when popping empty buffer")
	}
}

func TestCircularBuffer_PeekEmptyReturnsError(t *testing.T) {
	buf := NewCircularBuffer(2)
	_, err := buf.Peek()
	if err == nil {
		t.Errorf("expected error when peeking empty buffer")
	}
}

func TestCircularBuffer_IsFullAfterFilling(t *testing.T) {
	buf := NewCircularBuffer(2)
	if err := buf.Push("a"); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if err := buf.Push("b"); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !buf.IsFull() {
		t.Errorf("expected buffer to be full")
	}
}

func TestCircularBuffer_OverwritesOldestWhenFull(t *testing.T) {
	buf := NewCircularBuffer(2)
	if err := buf.Push("a"); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if err := buf.Push("b"); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if err := buf.Push("c"); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	val, err := buf.Peek()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if val != "b" {
		t.Errorf("expected oldest 'b' after overwrite, got %q", val)
	}
}

func TestMin_FirstSmaller(t *testing.T) {
	if got := Min(1, 5); got != 1 {
		t.Errorf("expected 1, got %d", got)
	}
}

func TestMin_SecondSmaller(t *testing.T) {
	if got := Min(5, 1); got != 1 {
		t.Errorf("expected 1, got %d", got)
	}
}

func TestMin_Equal(t *testing.T) {
	if got := Min(3, 3); got != 3 {
		t.Errorf("expected 3, got %d", got)
	}
}

func TestMin_NegativeValues(t *testing.T) {
	if got := Min(-2, -5); got != -5 {
		t.Errorf("expected -5, got %d", got)
	}
}

func TestResolveCommandPath_EnvOverrideTakesPrecedence(t *testing.T) {
	t.Setenv("OSMO_TEST_OVERRIDE_VAR", "/custom/path/to/tool")
	got := ResolveCommandPath("OSMO_TEST_OVERRIDE_VAR", "sh", "/fallback/path")
	if got != "/custom/path/to/tool" {
		t.Errorf("expected env override, got %q", got)
	}
}

func TestResolveCommandPath_FallbackWhenNotFound(t *testing.T) {
	t.Setenv("OSMO_TEST_UNSET_VAR", "")
	got := ResolveCommandPath(
		"OSMO_TEST_UNSET_VAR",
		"definitely-not-a-real-command-xyz-12345",
		"/fallback/absolute/path",
	)
	if got != "/fallback/absolute/path" {
		t.Errorf("expected fallback path, got %q", got)
	}
}

func TestLongestCommonPathPrefix_SingleStringReturnsDirPrefix(t *testing.T) {
	got := LongestCommonPathPrefix([]string{"/a/b/c"})
	if got != "/a/b/" {
		t.Errorf("expected %q, got %q", "/a/b/", got)
	}
}

func TestLongestCommonPathPrefix_CommonDirPrefix(t *testing.T) {
	got := LongestCommonPathPrefix([]string{"/a/b/c.txt", "/a/b/d.txt", "/a/b/e.txt"})
	if got != "/a/b/" {
		t.Errorf("expected %q, got %q", "/a/b/", got)
	}
}

func TestLongestCommonPathPrefix_NoCommonPrefix(t *testing.T) {
	got := LongestCommonPathPrefix([]string{"/alpha/one", "/beta/two"})
	if got != "/" {
		t.Errorf("expected %q, got %q", "/", got)
	}
}

func TestLongestCommonPathPrefix_EmptyInputReturnsEmpty(t *testing.T) {
	got := LongestCommonPathPrefix([]string{})
	if got != "" {
		t.Errorf("expected empty, got %q", got)
	}
}

func TestLongestCommonPathPrefix_DifferentDepths(t *testing.T) {
	got := LongestCommonPathPrefix([]string{"/a/b/c/d.txt", "/a/b/e.txt"})
	if got != "/a/b/" {
		t.Errorf("expected %q, got %q", "/a/b/", got)
	}
}

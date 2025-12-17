/*
SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

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
	"bufio"
	"errors"
	"fmt"
	"io"
	"io/ioutil"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"sync"

	"go.corp.nvidia.com/osmo/runtime/pkg/osmo_errors"
)

type OsmoPort uint16

const (
	RsyncPort OsmoPort = 16000
)

type ArrayFlags []string

func (i *ArrayFlags) String() string {
	return fmt.Sprint(*i)
}

func (i *ArrayFlags) Set(value string) error {
	*i = append(*i, value)
	return nil
}

func SingleFileInFolder(path string) bool {
	files, err := os.ReadDir(path)
	if err != nil {
		return false
	}
	return len(files) == 1 && !files[0].IsDir()
}

func AppendStringToList(s string, l []string) []string {
	var outArray = make([]string, len(l))
	for i := 0; i < len(l); i++ {
		outArray[i] = s + l[i]
	}
	return outArray
}

func GetFiles(s string, osmoChan chan string) []string {
	files, err := filepath.Glob(s)
	if err != nil {
		osmo_errors.LogError("", "", osmoChan, err, osmo_errors.INVALID_INPUT_CODE)
	}
	return files
}

func IsDirEmpty(name string) (bool, error) {
	f, err := os.Open(name)
	if err != nil {
		return false, err
	}
	defer f.Close()

	_, err = f.Readdirnames(1) // Or f.Readdir(1)
	if err == io.EOF {
		return true, nil
	}
	return false, err // Either not empty or error, suits both cases
}

func CalculateFolderSize(path string) (int64, int) {
	var size int64
	var numFiles int
	path, _ = filepath.EvalSymlinks(path)

	// May need to change to os.ReadDir in the future if go version changes
	entries, err := ioutil.ReadDir(path)
	if err != nil {
		log.Printf("failed to calculate size of directory %s: %v\n", path, err)
		return size, numFiles
	}

	for _, entry := range entries {
		// Evaulate any symlinks
		actualPath, _ := filepath.EvalSymlinks(path + "/" + entry.Name())
		fullPath := path + "/" + entry.Name()
		fileInfo := entry
		// If it is a symlink, get the actual file size
		if actualPath != path+"/"+entry.Name() {
			fileInfo, err = os.Stat(actualPath)
			fullPath = actualPath
		}
		// If it is a directory, recursivly go in
		if fileInfo.IsDir() {
			subDirSize, subNumFiles := CalculateFolderSize(fullPath)
			if err != nil {
				log.Printf("failed to calculate size of directory %s: %v\n", entry.Name(), err)
				continue
			}
			size += subDirSize
			numFiles += subNumFiles
		} else {
			if err != nil {
				log.Printf("failed to get info of file %s: %v\n", entry.Name(), err)
				continue
			}
			size += fileInfo.Size()
			numFiles++
		}
	}
	return size, numFiles
}

func CheckIfFileExists(filename string, osmoChan chan string) bool {
	if _, err := os.Stat(filename); err != nil {
		if os.IsNotExist(err) {
			osmoChan <- "File does not exist: " + filename
		} else {
			// Other error, possibly a permissions issue or similar
			osmoChan <- "Error checking file: " + filename
		}
		return false
	}
	return true
}

// CircularBuffer represents a circular buffer.
type CircularBuffer struct {
	data  []string
	head  int
	tail  int
	count int
}

// NewCircularBuffer creates a new circular buffer with the given size.
func NewCircularBuffer(size int) *CircularBuffer {
	return &CircularBuffer{
		data: make([]string, size),
	}
}

// IsFull checks if the circular buffer is full.
func (cb *CircularBuffer) IsFull() bool {
	return cb.count == len(cb.data)
}

// IsEmpty checks if the circular buffer is empty.
func (cb *CircularBuffer) IsEmpty() bool {
	return cb.count == 0
}

// Push adds an element to the circular buffer.
func (cb *CircularBuffer) Push(value string) error {
	if cb.IsFull() {
		// Overwrite the oldest element
		cb.head = (cb.head + 1) % len(cb.data)
	} else {
		cb.count++
	}
	cb.data[cb.tail] = value
	cb.tail = (cb.tail + 1) % len(cb.data)
	return nil
}

// Pop removes and returns the oldest element from the circular buffer.
func (cb *CircularBuffer) Pop() (string, error) {
	if cb.IsEmpty() {
		return "", errors.New("Circular buffer is empty")
	}
	value := cb.data[cb.head]
	cb.head = (cb.head + 1) % len(cb.data)
	cb.count--
	return value, nil
}

// Peek returns the oldest element without removing it from the circular buffer.
func (cb *CircularBuffer) Peek() (string, error) {
	if cb.IsEmpty() {
		return "", errors.New("Circular buffer is empty")
	}
	return cb.data[cb.head], nil
}

// Max and Min are only implemented natively in go1.21
func min(a int, b int) int {
	if a < b {
		return a
	}
	return b
}

func RunCommand(cmd *exec.Cmd,
	streamOutCommand func(*exec.Cmd, *bufio.Scanner, sync.WaitGroup, chan bool),
	streamErrCommand func(*bufio.Scanner, sync.WaitGroup)) (string, error) {
	var waitStreamLogs sync.WaitGroup
	timeoutChan := make(chan bool)

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return fmt.Sprintf("Failed to create stdout pipe with error: %s", err), err
	}
	stdoutScanner := bufio.NewScanner(stdout)

	stderr, err := cmd.StderrPipe()
	if err != nil {
		return fmt.Sprintf("Failed to create stderr pipe with error: %s", err), err
	}

	stderrScanner := bufio.NewScanner(stderr)

	// Set the buffer size to the maximum token size to avoid buffer overflows
	stdoutScanner.Buffer(make([]byte, bufio.MaxScanTokenSize), bufio.MaxScanTokenSize)
	stderrScanner.Buffer(make([]byte, bufio.MaxScanTokenSize), bufio.MaxScanTokenSize)

	// Define a split function to split the input into chunks of up to 64KB
	chunkSize := 32 * 1024 // 32KB
	splitFunc := func(data []byte, atEOF bool) (int, []byte, error) {
		currSize, byteArray, err := bufio.ScanLines(data, atEOF)
		if currSize != 0 {
			return currSize, byteArray, err
		}
		if len(data) > chunkSize {
			return chunkSize, data[:chunkSize], nil
		}
		return 0, nil, nil
	}

	stdoutScanner.Split(splitFunc)
	stderrScanner.Split(splitFunc)

	cmd.Start()
	go streamOutCommand(cmd, stdoutScanner, waitStreamLogs, timeoutChan)
	go streamErrCommand(stderrScanner, waitStreamLogs)
	waitStreamLogs.Wait()

	if <-timeoutChan {
		if err := cmd.Process.Signal(os.Interrupt); err != nil {
			log.Printf("Error sending interrupt signal: %s\n", err)
		}
		return "", &osmo_errors.TimeoutError{S: "Command timed out"}
	}

	err = cmd.Wait()
	return fmt.Sprintf("Command failed with error: %v\n", err), err
}

func Min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func ResolveCommandPath(envVarName string, defaultName string, fallbackAbsolutePath string) string {
	if override := os.Getenv(envVarName); override != "" {
		return override
	}
	if path, err := exec.LookPath(defaultName); err == nil {
		return path
	}
	return fallbackAbsolutePath
}

func LongestCommonPathPrefix(strs []string) string {
	var longestPrefix string = ""
	var longestPathPrefix string = ""

	if len(strs) > 0 {
		// Sort the strings so we know the first and last should differ the most
		sort.Strings(strs)
		first := strs[0]
		last := strs[len(strs)-1]

		for i := 0; i < len(first); i++ {
			// As long as the first and last values are the same, we are good
			if last[i] == first[i] {
				longestPrefix += string(last[i])
				if string(last[i]) == "/" {
					longestPathPrefix = longestPrefix
				}
			} else {
				break
			}
		}
	}
	return longestPathPrefix
}

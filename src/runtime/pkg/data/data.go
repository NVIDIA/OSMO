/*
SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

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
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"math/rand/v2"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"go.corp.nvidia.com/osmo/runtime/pkg/common"
	"go.corp.nvidia.com/osmo/runtime/pkg/osmo_errors"
)

var DataTimeout time.Duration = 10 * time.Minute

// Number of CPUs available to the Golang process. This may be used to by OSMO commands that are
// capable of multiprocessing.
var CpuCount string = "1"

const (
	Download         string = "download"
	NotApplicable    string = "N/A"
	BenchmarkSuffix  string = "_benchmark.json"
	BenchmarkPath    string = "/osmo/data/benchmarks/"
)

const (
	URLOperation     string = "Url"
)

type VersionInfo struct {
	Size         int
	Checksum     string
	Uri          string
	HashLocation string `json:"hash_location"`
	Name         string
	Version      string
}

type DatasetInfo struct {
	Type         string
	Versions     []VersionInfo
	HashLocation string `json:"hash_location"`
}

type DatasetStartInfo struct {
	VersionID string `json:"version_id"`
}

type WebsocketConnectionInfo struct {
	// task:<folder>,<url>,<regex>
	IsBroken            bool
	DisconnectStartTime time.Time
	Timeout             time.Duration
}

// Custom type to marshal/unmarshal epoch millis
type EpochMillis time.Time

func (e EpochMillis) MarshalJSON() ([]byte, error) {
	millis := time.Time(e).UnixMilli()
	return json.Marshal(millis)
}

func (e *EpochMillis) UnmarshalJSON(data []byte) error {
	var millis int64
	if err := json.Unmarshal(data, &millis); err != nil {
		return err
	}
	*e = EpochMillis(time.UnixMilli(millis))
	return nil
}

type BenchmarkMetrics struct {
	// Keep the follow fields in sync with osmo/utils/s3.py
	StartTime             EpochMillis `json:"start_time_ms"`
	EndTime               EpochMillis `json:"end_time_ms"`
	TotalBytesTransferred int         `json:"total_bytes_transferred"`
	TotalNumberOfFiles    int         `json:"total_number_of_files"`
}

func (f WebsocketConnectionInfo) ReachedTimeout() bool {
	return time.Since(f.DisconnectStartTime) >= f.Timeout
}

// ExponentialBackoffWithJitter returns a randomized delay using "equal jitter":
// uniformly distributed in [backoff/2, backoff) where backoff = 2^min(retryCount,5) seconds.
// The guaranteed minimum avoids near-zero sleeps while the jitter decorrelates
// concurrent clients to prevent thundering herd.
func ExponentialBackoffWithJitter(retryCount int) time.Duration {
	exponent := common.Min(retryCount, 5)
	maxDelay := time.Duration(math.Pow(2, float64(exponent))) * time.Second
	if maxDelay <= 0 {
		return 0
	}
	halfDelay := maxDelay / 2
	return halfDelay + time.Duration(rand.Int64N(int64(halfDelay)))
}

func (f WebsocketConnectionInfo) TimeLeft() time.Duration {
	return f.Timeout - time.Since(f.DisconnectStartTime)
}

var WebsocketConnection WebsocketConnectionInfo

func createOutCommandStream(osmoChan chan string) func(*exec.Cmd,
	*bufio.Scanner, sync.WaitGroup, chan bool) {
	streamOutCommand := func(cmd *exec.Cmd, scanner *bufio.Scanner,
		waitStreamLogs sync.WaitGroup, timeoutChan chan bool) {
		waitStreamLogs.Add(1)
		defer waitStreamLogs.Done()

		lastMessageTime := time.Now()
		quit := make(chan bool)

		go func() {
			for {
				select {
				case <-quit:
					return
				default:
					if time.Since(lastMessageTime) >= DataTimeout {
						if err := cmd.Process.Kill(); err != nil {
							osmo_errors.SetExitCode(osmo_errors.CMD_FAILED_CODE)
							panic(fmt.Sprintf("Failed to kill process: %s", err))
						}
						timeoutChan <- true
						return
					}
					// Wait a second between checks
					time.Sleep(time.Second)
				}
			}
		}()

		for scanner.Scan() {
			log.Println(scanner.Text())
			osmoChan <- scanner.Text()
			lastMessageTime = time.Now()
		}
		if err := scanner.Err(); err != nil {
			osmo_errors.SetExitCode(osmo_errors.CMD_FAILED_CODE)
			panic(err)
		}

		quit <- true
		timeoutChan <- false
	}
	return streamOutCommand
}

func createErrCommandStream(osmoChan chan string) func(*bufio.Scanner, sync.WaitGroup) {
	streamErrCommand := func(scanner *bufio.Scanner, waitStreamLogs sync.WaitGroup) {
		waitStreamLogs.Add(1)
		defer waitStreamLogs.Done()
		for scanner.Scan() {
			log.Println(scanner.Text())
			osmoChan <- scanner.Text()
		}
		if err := scanner.Err(); err != nil {
			log.Printf("Error: %s", err)
			osmoChan <- fmt.Sprintf("Error: %s", err)
		}
	}
	return streamErrCommand
}

func RunOSMOCommandStreamingWithRetry(command []string, retryCommand []string,
	retryCount int, osmoChan chan string, exitCode osmo_errors.ExitCode) {
	for i := 0; i < retryCount; i++ {
		var commandInput []string
		if i > 0 {
			osmoChan <- "OSMO Command timed out. Retrying..."
			commandInput = retryCommand
		} else {
			commandInput = command
		}

		var msg string
		var err error
		firstError := false

		// This retry count variable is for 429 has no limit
		backoffCount := 0
		for {
			// Wait until we have a stable connection to the service
			if WebsocketConnection.IsBroken {
				time.Sleep(10 * time.Second)
				continue
			}
			cmd := exec.Command(commandInput[0], commandInput[1:]...)
			msg, err = common.RunCommand(cmd,
				createOutCommandStream(osmoChan), createErrCommandStream(osmoChan))
			if err != nil {
				if exiterr, ok := err.(*exec.ExitError); ok {
					// The program has exited with an exit code != 0

					// This works on both Unix and Windows. Although package syscall is
					// generally platform dependent, WaitStatus is defined for both Unix and Windows
					// and in Windows it contains the exit code.
					if status, ok := exiterr.Sys().(syscall.WaitStatus); ok {
						continueLoop := false
						sleepTime := time.Second
						// Exit code 10 is cannot connect to service
						if status.ExitStatus() == 10 {
							if !firstError {
								osmoChan <- "Failed to communicate with OSMO service. " +
									"Waiting for service connection before retrying..."
								firstError = true
							}
							continueLoop = true
						} else if status.ExitStatus() == 75 {
							if !firstError || math.Mod(float64(backoffCount), 5) == 0 {
								osmoChan <- "Rate limited by service. Waiting before retrying..."
								firstError = true
							}
							sleepTime = ExponentialBackoffWithJitter(backoffCount)
							backoffCount++
							continueLoop = true
						}
						if continueLoop {
							time.Sleep(sleepTime)
							continue
						}
					}
				}
			}
			break
		}
		_, isTypeTimeout := err.(*osmo_errors.TimeoutError)
		if isTypeTimeout {
			continue
		}
		if err != nil {
			osmo_errors.LogError(msg, "", osmoChan, err, osmo_errors.CMD_FAILED_CODE)
		} else {
			return
		}
	}
	osmoChan <- fmt.Sprintf("Failed after %d retries", retryCount)
	osmo_errors.SetExitCode(exitCode)
	panic(fmt.Sprintf("Failed after %d retries", retryCount))
}

func RunOSMOCommandWithRetry(commandArgs []string, retryCount int,
	osmoChan chan string, code osmo_errors.ExitCode) bytes.Buffer {
	var outb, errb bytes.Buffer
	var err error
	for i := 0; i < retryCount; i++ {
		if i > 0 {
			osmoChan <- "Retrying..."
		}
		firstError := false

		// This retry count variable is for 429 has no limit
		backoffCount := 0
		for {
			// Wait until we have a stable connection to the service
			if WebsocketConnection.IsBroken {
				if !firstError {
					osmoChan <- "Failed to communicate with OSMO service. " +
						"Waiting for service connection before retrying..."
					firstError = true
				}
				time.Sleep(10 * time.Second)
				continue
			}
			cmd := exec.Command(commandArgs[0], commandArgs[1:]...)
			cmd.Stdout = &outb
			cmd.Stderr = &errb
			if err = cmd.Run(); err != nil {
				if exiterr, ok := err.(*exec.ExitError); ok {
					// The program has exited with an exit code != 0

					// This works on both Unix and Windows. Although package syscall is
					// generally platform dependent, WaitStatus is defined for both Unix and Windows
					// and in Windows it contains the exit code.
					if status, ok := exiterr.Sys().(syscall.WaitStatus); ok {
						continueLoop := false
						sleepTime := time.Second
						// Exit code 10 is cannot connect to service
						if status.ExitStatus() == 10 {
							if !firstError {
								osmoChan <- "Failed to communicate with OSMO service. " +
									"Waiting for service connection before retrying..."
								firstError = true
							}
							continueLoop = true
						} else if status.ExitStatus() == 75 {
							if !firstError || math.Mod(float64(backoffCount), 5) == 0 {
								osmoChan <- "Rate limited by service. Waiting before retrying..."
								firstError = true
							}
							sleepTime = ExponentialBackoffWithJitter(backoffCount)
							backoffCount++
							continueLoop = true
						}
						if continueLoop {
							outb.Reset()
							errb.Reset()
							time.Sleep(sleepTime)
							continue
						}
					}
					break
				}
			}
			break
		}
		if err != nil {
			log.Println("out:", outb.String())
			log.Println("err:", errb.String())
			osmoChan <- outb.String()
			osmoChan <- errb.String()
			continue
		}

		return outb
	}
	osmoChan <- fmt.Sprintf("Failed after %d retries", retryCount)
	osmo_errors.LogError(outb.String(), errb.String(), osmoChan, err, code)
	return outb
}

func CreateFolder(inputPath string, folder string) string {
	if !strings.HasSuffix(inputPath, "/") {
		inputPath += "/"
	}
	mountPath := inputPath + folder
	if err := os.MkdirAll(mountPath, os.ModePerm); err != nil {
		osmo_errors.SetExitCode(osmo_errors.FILE_FAILED_CODE)
		panic(err)
	}
	log.Printf("Created directory: %s", mountPath)
	return mountPath
}

func DownloadURI(
	c net.Conn,
	uri string,
	folderLoc string,
	regex string,
	osmoChan chan string,
	benchmarkFolderName string,
) []BenchmarkMetrics {
	if benchmarkFolderName == "" {
		benchmarkFolderName = fmt.Sprintf("download_%d", time.Now().UnixMilli())
	}

	benchmarkPath := BenchmarkPath + benchmarkFolderName

	downloadInput := []string{"osmo", "data", "download", uri, folderLoc,
		"--processes", CpuCount, "--benchmark-out", benchmarkPath}

	if regex != "" {
		downloadInput = append(downloadInput, "--regex", regex)
	}

	downloadResumeInput := append(downloadInput, "--resume")

	RunOSMOCommandStreamingWithRetry(
		downloadInput, downloadResumeInput, 5, osmoChan, osmo_errors.DOWNLOAD_FAILED_CODE)

	return CollectBenchmarkMetrics(benchmarkPath)
}

func UploadData(
	uri string,
	path string,
	regex string,
	osmoChan chan string,
	benchmarkFolderName string,
) []BenchmarkMetrics {
	if benchmarkFolderName == "" {
		benchmarkFolderName = fmt.Sprintf("upload_%d", time.Now().UnixMilli())
	}

	benchmarkPath := BenchmarkPath + benchmarkFolderName

	uploadInput := []string{"osmo", "data", "upload", uri, path,
		"--processes", CpuCount, "--benchmark-out", benchmarkPath}

	if regex != "" {
		uploadInput = append(uploadInput, "--regex", regex)
	}

	RunOSMOCommandStreamingWithRetry(uploadInput, uploadInput, 5, osmoChan,
		osmo_errors.UPLOAD_FAILED_CODE)

	return CollectBenchmarkMetrics(benchmarkPath)
}

func SendDatasetSizeAndChecksum(c net.Conn, dataset string, osmoChan chan string) string {
	// Prints Dataset information and Returns the Version URI
	commandArgs := []string{"osmo", "dataset", "info", dataset,
		"--format-type", "json", "-c", "1"}
	outb := RunOSMOCommandWithRetry(commandArgs, 5, osmoChan, osmo_errors.UPLOAD_FAILED_CODE)

	var datasetInfo DatasetInfo
	json.Unmarshal(outb.Bytes(), &datasetInfo)
	if len(datasetInfo.Versions) == 0 {
		osmoChan <- "Dataset " + dataset + " info is Empty"
		return ""
	} else {
		osmoChan <- "Size: " + strconv.Itoa(datasetInfo.Versions[0].Size) +
			"B   Checksum: " + datasetInfo.Versions[0].Checksum
		return datasetInfo.Versions[0].Uri
	}
}

func PrintDirContents(c net.Conn, path string, maxLevel int, osmoChan chan string) {
	// Set the lines output for tree
	// Get the first 20 lines and the last line if the number of lines is over 20
	treePath := common.ResolveCommandPath("TREE_PATH", "tree", "/usr/bin/tree")
	cmd := exec.Command(treePath, "-n", "-L", strconv.Itoa(maxLevel), path)
	var outb, errb bytes.Buffer
	cmd.Stdout = &outb
	cmd.Stderr = &errb
	if err := cmd.Run(); err != nil {
		osmo_errors.LogError(outb.String(), errb.String(), osmoChan, err,
			osmo_errors.MISC_FAILED_CODE)
	}

	// Limit output: first 20 lines and, if applicable, the last line
	output := outb.String()
	output = strings.TrimRight(output, "\n")
	lines := strings.Split(output, "\n")
	if len(lines) <= 20 {
		osmoChan <- output
		return
	}

	var builder strings.Builder
	for i := 0; i < 20 && i < len(lines); i++ {
		builder.WriteString(lines[i])
		builder.WriteString("\n")
	}
	// Append the last line
	builder.WriteString(lines[len(lines)-1])
	osmoChan <- builder.String()
}

func CollectBenchmarkMetrics(benchmarkPath string) []BenchmarkMetrics {
	entries, err := os.ReadDir(benchmarkPath)
	if err != nil {
		fmt.Printf("Error reading directory: %v\n", err)
		return nil
	}

	var benchmarkMetrics []BenchmarkMetrics
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), BenchmarkSuffix) {
			filePath := filepath.Join(benchmarkPath, entry.Name())
			data, err := os.ReadFile(filePath)
			if err != nil {
				fmt.Printf("Error reading file %s: %v\n", filePath, err)
				continue
			}

			var benchmarkMetric BenchmarkMetrics
			if err := json.Unmarshal(data, &benchmarkMetric); err != nil {
				fmt.Printf("Error unmarshalling JSON from file %s: %v\n", filePath, err)
				continue
			}

			benchmarkMetrics = append(benchmarkMetrics, benchmarkMetric)
		}
	}

	return benchmarkMetrics
}

func Checkpoint(opsChan chan string, checkpointInfo string,
	waitCheckpoint *sync.WaitGroup, stopCheckpoint *bool) {

	defer waitCheckpoint.Done()
	checkpointSplit := strings.SplitN(checkpointInfo, ";", 4)
	path := checkpointSplit[0]
	url := checkpointSplit[1]
	frequency := checkpointSplit[2]
	regex := checkpointSplit[3]

	frequencyInt, err := strconv.Atoi(frequency)
	if err != nil {
		opsChan <- fmt.Sprintf("Invalid checkpoint frequency: %s", frequency)
		return
	}
	duration := time.Duration(frequencyInt) * time.Second

	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()

	// Sleep until the duration has passed or stop is requested
	timer := time.NewTimer(duration)
	for {
		select {
		case <-timer.C:
			// Upload the data
			opsChan <- fmt.Sprintf("Checkpointing data from %s to %s...", path, url)
			UploadData(url, path, regex, opsChan, "")
			timer = time.NewTimer(duration)
		case <-ticker.C:
			if *stopCheckpoint {
				timer.Stop()
				opsChan <- fmt.Sprintf("Checkpointing data from %s to %s...", path, url)
				UploadData(url, path, regex, opsChan, "")
				opsChan <- fmt.Sprintf("Checkpointing data from %s to %s finished", path,
					url)
				return
			}
		}
	}
}

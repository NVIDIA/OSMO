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

package data

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"math/rand"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"go.corp.nvidia.com/osmo/pkg/common"
	"go.corp.nvidia.com/osmo/pkg/osmo_errors"
)

var DataTimeout time.Duration = 10 * time.Minute

// Number of CPUs available to the Golang process. This may be used to by OSMO commands that are
// capable of multiprocessing.
var CpuCount string = "1"

var MountRetryCount int = 3

const (
	Download         string = "download"
	Mountpoint       string = "mountpoint-s3"
	MountpointFailed string = "mountpoint-s3-failed"
	NotApplicable    string = "N/A"
	BenchmarkSuffix  string = "_benchmark.json"
	BenchmarkPath    string = "/osmo/data/benchmarks/"
)

const (
	URLOperation     string = "Url"
	DatasetOperation string = "Dataset"
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

type ManifestObject struct {
	RelativePath string `json:"relative_path"`
	StoragePath  string `json:"storage_path"`
}

type MountLocation struct {
	Folder string
	URI    string
}

type MountMap struct {
	lock      sync.Mutex
	locations map[string]MountLocation
}

func (mm *MountMap) Load(uriPath string) {
	mm.lock.Lock()
	defer mm.lock.Unlock()
	storageInfo := ParseStorageBackend(uriPath)
	old_val, exists := mm.locations[storageInfo.GetMountBase()]
	if exists {
		// Update existing
		uriArray := [2]string{old_val.URI, storageInfo.GetURI()}
		mm.locations[storageInfo.GetMountBase()] = MountLocation{
			URI: common.LongestCommonPathPrefix(uriArray[:]),
		}
	} else {
		// Add new
		mm.locations[storageInfo.GetMountBase()] = MountLocation{
			URI: storageInfo.GetURI(),
		}
	}
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
							maxSleep := math.Pow(2, float64(math.Min(float64(backoffCount), 5)))
							sleepTime = time.Second * time.Duration(1+rand.Float64()*(maxSleep-1))
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
							maxSleep := math.Pow(2, float64(math.Min(float64(backoffCount), 5)))
							sleepTime = time.Second * time.Duration(1+rand.Float64()*(maxSleep-1))
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

func MountURL(downloadType string, credentialInfo ConfigInfo, urlPath string,
	localPath string, cachePath string, cacheSize int, osmoChan chan string) bool {

	isEmpty := true
	storageBackend := ParseStorageBackend(urlPath)

	dataCredential, ok := credentialInfo.Auth.Data[storageBackend.GetProfile()]
	if !ok {
		osmoChan <- fmt.Sprintf("Missing data credential for %s.", storageBackend.GetProfile())
		return isEmpty
	}
	os.Setenv("AWS_ACCESS_KEY_ID", dataCredential.AccessKeyId)
	os.Setenv("AWS_SECRET_ACCESS_KEY", dataCredential.AccessKey)

	var commandArgs []string

	if downloadType == Mountpoint {
		commandArgs = []string{storageBackend.GetBucket(), localPath,
			"--read-only", "--auto-unmount", "--allow-other"}
		if storageBackend.GetScheme() != TOS {
			commandArgs = append(commandArgs, "--force-path-style")
		}
		// Specify cache only if the size is greater than 0
		if cacheSize > 0 {
			log.Printf("Path %s has cache size %dMiB", localPath, cacheSize)
			cacheSlice := []string{
				"--cache", cachePath,
				"--metadata-ttl", "indefinite",
				"--max-cache-size", strconv.Itoa(cacheSize)}
			commandArgs = append(commandArgs, cacheSlice...)
		} else {
			log.Printf("Path %s has no cache", localPath)
		}

		if storageBackend.GetAuthEndpoint() != "" {
			commandArgs = append(commandArgs, "--endpoint-url", storageBackend.GetAuthEndpoint())
		}
		path := storageBackend.GetPath()
		if path != "" {
			if !strings.HasSuffix(path, "/") {
				path += "/"
			}
			path = strings.Join([]string{"--prefix", path}, "=")
			commandArgs = append(commandArgs, path)
		}
	} else {
		osmoChan <- fmt.Sprintf("Mounting type %s is not supported.", downloadType)
		return isEmpty
	}

	// Loop 3 times in case mountpoint doesn't connect properly
	for i := 0; i < MountRetryCount; i++ {
		if downloadType == Mountpoint {
			log, err := os.Create("/tmp/mount.log")
			if err != nil {
				osmo_errors.LogError("", "", osmoChan, err, osmo_errors.FILE_FAILED_CODE)
			}

			mountS3Path := common.ResolveCommandPath("MOUNT_S3_PATH", "mount-s3", "/usr/bin/mount-s3")
			cmd := exec.Command(mountS3Path, commandArgs...)
			cmd.Stderr = log
			if err = cmd.Run(); err != nil {
				if strings.Contains(err.Error(), "Timeout") {
					osmoChan <- "Timeout while waiting for mount to complete. Retrying..."
					continue
				} else if !strings.Contains(err.Error(), "is already mounted") {
					stderr, _ := os.ReadFile("/tmp/mount.log")
					osmo_errors.LogError("", string(stderr), osmoChan, err,
						osmo_errors.MOUNT_FAILED_CODE)
				}
			}
		}

		var err error
		isEmpty, err = common.IsDirEmpty(localPath)
		if err != nil {
			log.Println(err)
		}

		// Exit the loop
		if !isEmpty {
			break
		}

		// TODO: Handle paths that are an object by downloading instead of mounting
		if err := syscall.Unmount(localPath, 0); err != nil {
			log.Println("umount failed:", err)
		}
	}
	return isEmpty
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

func ParseMountLocations(manifestFilePath string,
	uriPath string) (map[string]MountLocation, error) {

	mountMap := MountMap{
		lock:      sync.Mutex{},
		locations: make(map[string]MountLocation),
	}

	file, err := os.Open(manifestFilePath)
	if err != nil {
		fmt.Println("Error opening file:", err)
		return mountMap.locations, err
	}
	defer file.Close()

	decoder := json.NewDecoder(bufio.NewReader(file))

	// Read opening bracket
	_, err = decoder.Token()
	if err != nil {
		fmt.Println("Error reading manifest file:", file)
		return mountMap.locations, err
	}

	numWorkers, err := strconv.Atoi(CpuCount)
	if err != nil {
		osmo_errors.SetExitCode(osmo_errors.INVALID_INPUT_CODE)
		panic(fmt.Sprintf("Improper cpu count: %s", CpuCount))
	}
	jobs := make(chan ManifestObject, 1000)
	var wg sync.WaitGroup
	hashFolderUsed := false

	// Start worker goroutines
	for i := 0; i < numWorkers; i++ {
		wg.Add(1)
		go evaluateLocation(jobs, &wg, uriPath, &mountMap, &hashFolderUsed)
	}

	// Read objects and send to workers
	for decoder.More() {
		var manifestObject ManifestObject
		err := decoder.Decode(&manifestObject)
		if err != nil {
			fmt.Println("Error decoding manifest object:", err)
			continue
		}
		jobs <- manifestObject
	}

	close(jobs)
	wg.Wait()

	// Load the uriPath for hashes
	if hashFolderUsed {
		mountMap.Load(uriPath)
	}

	return mountMap.locations, nil
}

func evaluateLocation(jobs <-chan ManifestObject, wg *sync.WaitGroup, uriPath string,
	mountMap *MountMap, hashFolderUsed *bool) {

	defer wg.Done()
	for manifestObject := range jobs {
		// Check if object is part of hashes
		if strings.HasPrefix(manifestObject.StoragePath, uriPath) {
			*hashFolderUsed = true
			continue
		}

		// If it isn't in hashes folder, add to MountMap
		mountMap.Load(manifestObject.StoragePath)
	}
}

func LinkManifest(manifestFilePath string, mountLocations map[string]MountLocation,
	destination string) error {

	file, err := os.Open(manifestFilePath)
	if err != nil {
		fmt.Println("Error opening file:", err)
		return err
	}
	defer file.Close()

	decoder := json.NewDecoder(bufio.NewReader(file))

	// Read opening bracket
	_, err = decoder.Token()
	if err != nil {
		fmt.Println("Error reading manifest file:", file)
		return err
	}

	numWorkers, err := strconv.Atoi(CpuCount)
	if err != nil {
		osmo_errors.SetExitCode(osmo_errors.INVALID_INPUT_CODE)
		fmt.Sprintf("Improper cpu count: %s", CpuCount)
	}
	jobs := make(chan ManifestObject, 1000)
	var wg sync.WaitGroup

	// Start worker goroutines
	for i := 0; i < numWorkers; i++ {
		wg.Add(1)
		go symlinkWorker(jobs, &wg, mountLocations, destination)
	}

	// Read objects and send to workers
	for decoder.More() {
		var manifestObject ManifestObject
		err := decoder.Decode(&manifestObject)
		if err != nil {
			fmt.Println("Error decoding manifest object:", err)
			continue
		}
		jobs <- manifestObject
	}

	close(jobs)
	wg.Wait()
	return nil
}

func symlinkWorker(jobs <-chan ManifestObject, wg *sync.WaitGroup,
	mountLocations map[string]MountLocation, destination string) {

	defer wg.Done()
	for manifestObject := range jobs {
		manifestStorageInfo := ParseStorageBackend(manifestObject.StoragePath)

		// Ensure the object mount was seen
		mountLocation, exists := mountLocations[manifestStorageInfo.GetMountBase()]
		if !exists {
			osmo_errors.SetExitCode(osmo_errors.INVALID_INPUT_CODE)
			panic(fmt.Sprintf("Missing mount base for: %s", manifestStorageInfo.GetMountBase()))
		}

		// Ensure that the folder was able to be mounted
		if mountLocation.Folder == "" {
			continue
		}

		source := mountLocation.Folder + "/" + strings.TrimPrefix(manifestObject.StoragePath,
			mountLocation.URI)
		target := destination + manifestObject.RelativePath

		// Ensure the parent directory of the target exists
		targetDir := filepath.Dir(target)
		err := os.MkdirAll(targetDir, 0777)
		if err != nil {
			fmt.Printf("Error creating directory for %s: %v\n", target, err)
			return
		}

		// Create the symlink
		err = os.Symlink(source, target)
		if err != nil {
			fmt.Printf("Error creating symlink from %s to %s: %v\n", source, target, err)
			return
		}
	}
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

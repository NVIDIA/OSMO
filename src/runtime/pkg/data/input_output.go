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
	"encoding/json"
	"fmt"
	"log"
	"net"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"go.corp.nvidia.com/osmo/runtime/pkg/common"
	"go.corp.nvidia.com/osmo/runtime/pkg/metrics"
	"go.corp.nvidia.com/osmo/runtime/pkg/osmo_errors"
)

type DataCredential struct {
	AccessKey   string `yaml:"access_key"`
	AccessKeyId string `yaml:"access_key_id"`
	Region      string `yaml:"region"`
}

type DataConfig struct {
	Data map[string]DataCredential `yaml:"data"`
}

type ConfigInfo struct {
	Auth DataConfig `yaml:"auth"`
}

// Common functionality needed by dataset/task/url
type InputOutput interface {
	GetLogInfo() string
	GetUrlIdentifier() string
}

type InputType interface {
	GetFolder() string
	CreateMount(c net.Conn, inputPath string, credentialInfo ConfigInfo, osmoChan chan string,
		metricChan chan metrics.Metric, retryId string, groupName string, taskName string,
		downloadType string, inputIndex int, cacheSize int)
}

type OutputType interface {
	UploadFolder(c net.Conn, outputPath string, osmoChan chan string,
		metricChan chan metrics.Metric, retryId string, groupName string, taskName string,
		outputUrlID string, outputIndex int)
}

// Define "task" input/output
type TaskInput struct {
	// task:<folder>,<url>,<regex>
	Folder string
	Name   string
	Url    string
	Regex  string
}

func (f TaskInput) GetLogInfo() string       { return f.Name }
func (f TaskInput) GetUrlIdentifier() string { return f.Url }
func (f TaskInput) GetFolder() string        { return f.Folder }
func (f TaskInput) CreateMount(c net.Conn, inputPath string,
	credentialInfo ConfigInfo, osmoChan chan string, metricChan chan metrics.Metric,
	retryId string, groupName string, taskName string, downloadType string, inputIndex int,
	cacheSize int) {

	mountPath := CreateFolder(inputPath, f.Folder)
	inputType := "Mounted"

	if downloadType != Download {
		cachePath := CreateFolder(inputPath, f.Folder+"-cache")
		inputStartTime := time.Now().Format("2006-01-02 15:04:05.000")
		isEmpty := MountURL(downloadType, credentialInfo, f.Url, mountPath,
			cachePath, cacheSize, osmoChan)
		inputEndTime := time.Now().Format("2006-01-02 15:04:05.000")

		if isEmpty {
			osmoChan <- fmt.Sprintf("Mount for task %s failed", f.Name)
			downloadType = MountpointFailed
		}
		mountTimes := metrics.TaskIOMetrics{
			RetryId:       retryId,
			GroupName:     groupName,
			TaskName:      taskName,
			URL:           f.Url,
			Type:          "INPUT",
			StartTime:     inputStartTime,
			EndTime:       inputEndTime,
			OperationType: URLOperation,
			DownloadType:  downloadType,
		}
		metricChan <- mountTimes
	} else {
		inputType = "Downloaded"

		benchmarkFolder := fmt.Sprintf("INPUT_%d", inputIndex)
		benchmarks := DownloadURI(c, f.Url, inputPath+f.Folder, f.Regex, osmoChan, benchmarkFolder)

		for _, benchmark := range benchmarks {
			if benchmark.TotalBytesTransferred == 0 {
				continue
			}
			downloadTimes := metrics.TaskIOMetrics{
				RetryId:       retryId,
				GroupName:     groupName,
				TaskName:      taskName,
				URL:           f.Url,
				Type:          "INPUT",
				StartTime:     time.Time(benchmark.StartTime).Format("2006-01-02 15:04:05.000"),
				EndTime:       time.Time(benchmark.EndTime).Format("2006-01-02 15:04:05.000"),
				SizeInBytes:   int64(benchmark.TotalBytesTransferred),
				NumberOfFiles: benchmark.TotalNumberOfFiles,
				OperationType: URLOperation,
				DownloadType:  downloadType,
			}
			metricChan <- downloadTimes
		}
	}

	log.Printf("%s %s to %s", inputType, f.Name, inputPath+f.Folder)
	osmoChan <- inputType + " " + f.Name + " to {{input:" + f.Folder + "}}"
	PrintDirContents(c, inputPath+f.Folder, 1, osmoChan)
}

type TaskOutput struct {
	// task:<url>
	Name string
	Url  string
}

func (f TaskOutput) GetLogInfo() string       { return f.Name }
func (f TaskOutput) GetUrlIdentifier() string { return f.Url }
func (f *TaskOutput) UploadFolder(c net.Conn, outputPath string, osmoChan chan string,
	metricChan chan metrics.Metric, retryId string, groupName string, taskName string,
	outputUrlID string, outputIndex int) {

	benchmarkFolder := fmt.Sprintf("OUTPUT_%d", outputIndex)
	benchmarks := UploadData(f.Url, outputPath+"*", "", osmoChan, benchmarkFolder)

	for _, benchmark := range benchmarks {
		if benchmark.TotalBytesTransferred == 0 {
			continue
		}
		uploadTimes := metrics.TaskIOMetrics{
			RetryId:       retryId,
			GroupName:     groupName,
			TaskName:      taskName,
			URL:           outputUrlID,
			Type:          "OUTPUT",
			StartTime:     time.Time(benchmark.StartTime).Format("2006-01-02 15:04:05.000"),
			EndTime:       time.Time(benchmark.EndTime).Format("2006-01-02 15:04:05.000"),
			SizeInBytes:   int64(benchmark.TotalBytesTransferred),
			NumberOfFiles: benchmark.TotalNumberOfFiles,
			OperationType: URLOperation,
			DownloadType:  NotApplicable,
		}
		metricChan <- uploadTimes
	}

	log.Printf("Uploaded %s from %s", f.Name, outputPath+"*")
	osmoChan <- "Uploaded " + f.Name
}

// Define "dataset" input/output
type DatasetInput struct {
	// dataset:<folder>,<dataset | dataset:<tag or version>>,<regex>
	Folder  string
	Dataset string
	Regex   string
}

func (f DatasetInput) GetLogInfo() string       { return f.Dataset }
func (f DatasetInput) GetUrlIdentifier() string { return f.Dataset }
func (f DatasetInput) GetFolder() string {
	return f.Folder + "/" + strings.SplitN(f.Dataset, ":", 2)[0]
}
func (f DatasetInput) CreateMount(c net.Conn, inputPath string,
	credentialInfo ConfigInfo, osmoChan chan string, metricChan chan metrics.Metric,
	retryId string, groupName string, taskName string, downloadType string, inputIndex int,
	cacheSize int) {

	if !strings.HasSuffix(inputPath, "/") {
		inputPath += "/"
	}
	downloadPath := CreateFolder(inputPath, f.Folder)

	commandArgs := []string{"osmo", "dataset", "info", f.Dataset,
		"--format-type", "json", "-c", "1"}
	outb := RunOSMOCommandWithRetry(commandArgs, 5, osmoChan, osmo_errors.DOWNLOAD_FAILED_CODE)

	datasetSplit := strings.Split(f.Dataset, "/")

	var datasetInfo DatasetInfo
	json.Unmarshal(outb.Bytes(), &datasetInfo)
	if len(datasetInfo.Versions) == 0 {
		osmoChan <- "Dataset " + f.Dataset + " info is Empty"
		osmo_errors.SetExitCode(osmo_errors.DOWNLOAD_FAILED_CODE)
		panic(fmt.Sprintf("Dataset %s Info is Empty", f.Dataset))
	}
	inputType := "Mounted"

	var metricsWG sync.WaitGroup
	writeMetrics := func(m metrics.TaskIOMetrics) {
		defer metricsWG.Done()
		metricChan <- m
	}

	for _, versionInfo := range datasetInfo.Versions {

		if downloadType == Mountpoint {
			isAllEmpty := false
			isAnyEmpty := false

			datasetVersionInfo := versionInfo
			datasetID := datasetVersionInfo.Name
			var hashesUri string
			if datasetInfo.Type == "COLLECTION" {
				hashesUri = datasetVersionInfo.HashLocation
			} else {
				hashesUri = datasetInfo.HashLocation
			}

			// Download Manifest
			osmoChan <- fmt.Sprintf("Downloading dataset %s manifest.", datasetID)

			manifestFileLoc := CreateFolder(inputPath, fmt.Sprintf("%s-manifest", f.Folder))

			benchmarkFolder := fmt.Sprintf("%s_%s_INPUT_%d", groupName, taskName, inputIndex)
			benchmarkPath := BenchmarkPath + benchmarkFolder
			linkCommand := []string{"osmo", "data", "download", datasetVersionInfo.Uri,
				manifestFileLoc, "--processes", CpuCount, "--benchmark-out", benchmarkPath}

			RunOSMOCommandStreamingWithRetry(linkCommand, linkCommand, 5,
				osmoChan, osmo_errors.DOWNLOAD_FAILED_CODE)

			manifestFilePath := manifestFileLoc + "/" + filepath.Base(datasetVersionInfo.Uri)
			datasetFolderPath := downloadPath + "/" + datasetVersionInfo.Name
			uriPath := hashesUri + "/"
			destination := datasetFolderPath + "/"

			// Create all the root mount locations by running through manifest
			mountLocations, err := ParseMountLocations(manifestFilePath, uriPath)

			if err == nil {
				// Create folders per mount location
				idx := 0
				numMounts := len(mountLocations)
				for profile, mountLocation := range mountLocations {
					mountFolder := CreateFolder(inputPath,
						fmt.Sprintf("%s-hashes/%s/%d", f.Folder, datasetID, idx))
					mountCacheFolder := CreateFolder(inputPath,
						fmt.Sprintf("%s-hashes/%s/%d", f.Folder, datasetID+"-cache", idx))
					mountLocations[profile] = mountLocation
					log.Printf("Profile: %s mounting to: %s", mountLocation.URI, mountFolder)

					// Mount the folder
					inputStartTime := time.Now().Format("2006-01-02 15:04:05.000")
					isEmpty := MountURL(Mountpoint, credentialInfo, mountLocation.URI, mountFolder,
						mountCacheFolder, cacheSize/numMounts, osmoChan)
					inputEndTime := time.Now().Format("2006-01-02 15:04:05.000")

					localDownloadType := downloadType
					if isEmpty {
						// Either mounting failed or no hashes
						osmoChan <- fmt.Sprintf("Mount folder for path %s is empty",
							mountLocation.URI)
						localDownloadType = MountpointFailed
					} else {
						// Update only when mount successful so if it failed, we don't try to link
						// those files
						mountLocation.Folder = mountFolder
						mountLocations[profile] = mountLocation

						// Hashes folder mounted correctly
						log.Printf("Mounted %s folder for dataset %s to %s", mountLocation.URI,
							f.Dataset, mountLocation.Folder)
					}

					// Write metrics for mounting
					metricsWG.Add(1)
					go writeMetrics(metrics.TaskIOMetrics{
						RetryId:       retryId,
						GroupName:     groupName,
						TaskName:      taskName,
						URL:           versionInfo.Uri,
						Type:          "INPUT",
						StartTime:     inputStartTime,
						EndTime:       inputEndTime,
						OperationType: DatasetOperation,
						DownloadType:  localDownloadType,
					})

					isAllEmpty = isAllEmpty && isEmpty
					isAnyEmpty = isAnyEmpty || isEmpty

					idx++
				}

				if isAllEmpty {
					osmoChan <- fmt.Sprintf("All Mounts for %s failed", datasetID)
				} else if isAnyEmpty {
					osmoChan <- fmt.Sprintf("Partial Mount for %s failed", datasetID)
				} else {
					osmoChan <- fmt.Sprintf("Mounting finished for %s", datasetID)
				}

				// Link the manifest files
				osmoChan <- fmt.Sprintf("Linking dataset %s manifest.", datasetID)

				// Link files from the manifest to the dataset location
				if err := LinkManifest(manifestFilePath, mountLocations, destination); err != nil {
					isAllEmpty = true
				} else {
					// Write metrics for downloading mounted files
					benchmarks := CollectBenchmarkMetrics(benchmarkPath)
					for _, benchmark := range benchmarks {
						if benchmark.TotalBytesTransferred == 0 {
							// Nothing transferred for this benchmark, skipping
							continue
						}
						metricsWG.Add(1)
						go writeMetrics(metrics.TaskIOMetrics{
							RetryId:   retryId,
							GroupName: groupName,
							TaskName:  taskName,
							URL:       versionInfo.Uri,
							Type:      "INPUT",
							StartTime: time.Time(benchmark.StartTime).Format(
								"2006-01-02 15:04:05.000"),
							EndTime: time.Time(benchmark.EndTime).Format(
								"2006-01-02 15:04:05.000"),
							SizeInBytes:   int64(benchmark.TotalBytesTransferred),
							NumberOfFiles: benchmark.TotalNumberOfFiles,
							OperationType: DatasetOperation,
							DownloadType:  downloadType,
						})
					}
				}
			}
		} else {
			inputType = "Downloaded"

			inputDataset := versionInfo.Name + ":" + versionInfo.Version
			// Append bucket info to the dataset
			if len(datasetSplit) > 1 {
				inputDataset = datasetSplit[0] + "/" + inputDataset
			}

			benchmarkFolder := fmt.Sprintf("%s_%s_INPUT_%d", groupName, taskName, inputIndex)
			benchmarkPath := BenchmarkPath + benchmarkFolder
			commandInput := []string{"osmo", "dataset", "download", inputDataset, downloadPath,
				"--processes", CpuCount, "--benchmark-out", benchmarkPath}

			if f.Regex != "" {
				commandInput = append(commandInput, "--regex", f.Regex)
			}

			downloadCommand := commandInput

			// Construct resume command
			downloadResumeCommand := append(commandInput, "--resume")

			RunOSMOCommandStreamingWithRetry(downloadCommand, downloadResumeCommand,
				5, osmoChan, osmo_errors.DOWNLOAD_FAILED_CODE)

			benchmarks := CollectBenchmarkMetrics(benchmarkPath)

			for _, benchmark := range benchmarks {
				if benchmark.TotalBytesTransferred == 0 {
					// Nothing transferred for this benchmark, skipping
					continue
				}
				metricsWG.Add(1)
				go writeMetrics(metrics.TaskIOMetrics{
					RetryId:       retryId,
					GroupName:     groupName,
					TaskName:      taskName,
					URL:           versionInfo.Uri,
					Type:          "INPUT",
					StartTime:     time.Time(benchmark.StartTime).Format("2006-01-02 15:04:05.000"),
					EndTime:       time.Time(benchmark.EndTime).Format("2006-01-02 15:04:05.000"),
					SizeInBytes:   int64(benchmark.TotalBytesTransferred),
					NumberOfFiles: benchmark.TotalNumberOfFiles,
					OperationType: DatasetOperation,
					DownloadType:  downloadType,
				})
			}
		}
	}

	// Wait for all metrics to be processed before moving on.
	metricsWG.Wait()

	log.Printf("%s %s to %s", inputType, f.Dataset, downloadPath)
	osmoChan <- inputType + " " + f.Dataset + " to {{input:" + f.Folder + "}}"
	PrintDirContents(c, downloadPath, 2, osmoChan)
}

type DatasetOutput struct {
	// dataset:<dataset | dataset:<tag>>,<path>,<metadata>...;<regex>
	Dataset      string
	Path         string
	Metadata     common.ArrayFlags
	MetadataFile string
	Labels       common.ArrayFlags
	Url          string
	Regex        string
}

func (f DatasetOutput) GetLogInfo() string       { return f.Dataset }
func (f DatasetOutput) GetUrlIdentifier() string { return f.Url }
func (f *DatasetOutput) UploadFolder(c net.Conn, outputPath string, osmoChan chan string,
	metricChan chan metrics.Metric, retryId string, groupName string, taskName string,
	outputUrlID string, outputIndex int) {
	if f.MetadataFile == "" {
		osmo_errors.SetExitCode(osmo_errors.UPLOAD_FAILED_CODE)
		panic("Metadata File is not Set")
	}

	// Append Path
	combineOut := outputPath
	if len(f.Path) > 0 {
		combineOut += f.Path
	} else {
		combineOut += "*"
	}
	files := common.GetFiles(combineOut, osmoChan)

	if len(files) == 0 {
		osmoChan <- fmt.Sprintf("No files in path %s", combineOut)
		return
	}

	// Upload Dataset
	// Fetch version info
	var datasetTag string
	if strings.Contains(f.Dataset, ":") {
		datasetSplitInfo := strings.Split(f.Dataset, ":")
		f.Dataset = datasetSplitInfo[0]
		datasetTag = datasetSplitInfo[1]
	}
	{
		log.Printf("Fetching version for %s", f.Dataset)
		metadataInput := []string{"--metadata", f.MetadataFile}
		for _, metadataFile := range f.Metadata {
			metadataFilePath := outputPath + metadataFile
			if !common.CheckIfFileExists(metadataFilePath, osmoChan) {
				return
			}
			metadataInput = append(metadataInput, metadataFilePath)
		}
		commandArgs := []string{"osmo", "dataset", "upload", f.Dataset, "/tmp", "--start-only",
			"--processes", CpuCount}
		commandArgs = append(commandArgs, metadataInput...)
		outb := RunOSMOCommandWithRetry(commandArgs, 5, osmoChan, osmo_errors.UPLOAD_FAILED_CODE)

		var datasetInfo DatasetStartInfo
		json.Unmarshal(outb.Bytes(), &datasetInfo)
		f.Dataset += ":" + datasetInfo.VersionID
	}

	log.Printf("Uploading dataset %s", f.Dataset)
	benchmarkFolder := fmt.Sprintf("OUTPUT_%d", outputIndex)
	benchmarkPath := BenchmarkPath + benchmarkFolder
	commandInput := []string{"osmo", "dataset", "upload", "--resume", f.Dataset, combineOut,
		"--processes", CpuCount, "--benchmark-out", benchmarkPath}
	for _, labelsFile := range f.Labels {
		labelsFilePath := outputPath + labelsFile
		if !common.CheckIfFileExists(labelsFilePath, osmoChan) {
			return
		}
		commandInput = append(commandInput, labelsFilePath)
	}

	if f.Regex != "" {
		commandInput = append(commandInput, "--regex", f.Regex)
	}

	RunOSMOCommandStreamingWithRetry(commandInput, commandInput, 5, osmoChan,
		osmo_errors.UPLOAD_FAILED_CODE)

	// Write benchmark metrics
	benchmarks := CollectBenchmarkMetrics(benchmarkPath)
	for _, benchmark := range benchmarks {
		if benchmark.TotalBytesTransferred == 0 {
			continue
		}
		uploadTimes := metrics.TaskIOMetrics{
			RetryId:       retryId,
			GroupName:     groupName,
			TaskName:      taskName,
			URL:           outputUrlID,
			Type:          "OUTPUT",
			StartTime:     time.Time(benchmark.StartTime).Format("2006-01-02 15:04:05.000"),
			EndTime:       time.Time(benchmark.EndTime).Format("2006-01-02 15:04:05.000"),
			SizeInBytes:   int64(benchmark.TotalBytesTransferred),
			NumberOfFiles: benchmark.TotalNumberOfFiles,
			OperationType: DatasetOperation,
			DownloadType:  NotApplicable,
		}
		metricChan <- uploadTimes
	}

	log.Printf("Uploaded %s from %s", f.Dataset, combineOut)
	osmoChan <- "Uploaded to " + f.Dataset

	if datasetTag != "" {
		commandArgs := []string{"osmo", "dataset", "tag", f.Dataset, "--set", datasetTag}
		RunOSMOCommandWithRetry(commandArgs, 5, osmoChan, osmo_errors.UPLOAD_FAILED_CODE)
		osmoChan <- "Tagged " + f.Dataset + " with " + datasetTag
	}

	f.Url = SendDatasetSizeAndChecksum(c, f.Dataset, osmoChan)
}

type UpdateDatasetOutput struct {
	// dataset:<dataset | dataset:<tag>>,<path>,<metadata>...;<regex>
	Dataset      string
	Paths        common.ArrayFlags
	Metadata     common.ArrayFlags
	MetadataFile string
	Labels       common.ArrayFlags
	Url          string
}

func (f UpdateDatasetOutput) GetLogInfo() string       { return f.Dataset }
func (f UpdateDatasetOutput) GetUrlIdentifier() string { return f.Url }
func (f *UpdateDatasetOutput) UploadFolder(c net.Conn, outputPath string, osmoChan chan string,
	metricChan chan metrics.Metric, retryId string, groupName string, taskName string,
	outputUrlID string, outputIndex int) {
	if f.MetadataFile == "" {
		osmo_errors.SetExitCode(osmo_errors.UPLOAD_FAILED_CODE)
		panic("Metadata File is not Set")
	}

	// Append Path
	var uploadPaths common.ArrayFlags
	for _, path := range f.Paths {
		combineOut := outputPath
		splitPaths := strings.Split(path, ":")
		if len(splitPaths[0]) > 0 {
			combineOut += splitPaths[0]
		} else {
			combineOut += "*"
		}
		files := common.GetFiles(combineOut, osmoChan)

		if len(files) == 0 {
			osmoChan <- fmt.Sprintf("No files in path %s", combineOut)
			return
		} else {
			if len(splitPaths) > 1 {
				combineOut += ":" + splitPaths[1]
			}
			uploadPaths = append(uploadPaths, combineOut)
		}
	}

	// Upload Dataset
	var datasetVersion string
	pathsInput := []string{"--add"}
	pathsInput = append(pathsInput, uploadPaths...)
	{
		log.Printf("Fetching version for %s", f.Dataset)

		metadataInput := []string{"--metadata", f.MetadataFile}
		for _, metadataFile := range f.Metadata {
			metadataFilePath := outputPath + metadataFile
			if !common.CheckIfFileExists(metadataFilePath, osmoChan) {
				return
			}
			metadataInput = append(metadataInput, metadataFilePath)
		}
		commandArgs := []string{"osmo", "dataset", "update", f.Dataset, "--start-only",
			"--add", "/tmp", "--processes", CpuCount}
		commandArgs = append(commandArgs, metadataInput...)
		outb := RunOSMOCommandWithRetry(commandArgs, 5, osmoChan, osmo_errors.UPLOAD_FAILED_CODE)

		// Fetch new version to construct resume
		var datasetInfo DatasetStartInfo
		json.Unmarshal(outb.Bytes(), &datasetInfo)
		datasetVersion = datasetInfo.VersionID
	}

	benchmarkFolder := fmt.Sprintf("OUTPUT_%d", outputIndex)
	benchmarkPath := BenchmarkPath + benchmarkFolder
	updateInput := []string{"osmo", "dataset", "update", f.Dataset, "--resume", datasetVersion,
		"--processes", CpuCount, "--benchmark-out", benchmarkPath}
	updateInput = append(updateInput, pathsInput...)
	for _, labelsFile := range f.Labels {
		labelsFilePath := outputPath + labelsFile
		if !common.CheckIfFileExists(labelsFilePath, osmoChan) {
			return
		}
		updateInput = append(updateInput, labelsFilePath)
	}

	RunOSMOCommandStreamingWithRetry(updateInput, updateInput, 5, osmoChan,
		osmo_errors.UPLOAD_FAILED_CODE)

	// Write benchmark metrics
	benchmarks := CollectBenchmarkMetrics(benchmarkPath)
	for _, benchmark := range benchmarks {
		if benchmark.TotalBytesTransferred == 0 {
			continue
		}
		uploadTimes := metrics.TaskIOMetrics{
			RetryId:       retryId,
			GroupName:     groupName,
			TaskName:      taskName,
			URL:           outputUrlID,
			Type:          "OUTPUT",
			StartTime:     time.Time(benchmark.StartTime).Format("2006-01-02 15:04:05.000"),
			EndTime:       time.Time(benchmark.EndTime).Format("2006-01-02 15:04:05.000"),
			SizeInBytes:   int64(benchmark.TotalBytesTransferred),
			NumberOfFiles: benchmark.TotalNumberOfFiles,
			OperationType: DatasetOperation,
			DownloadType:  NotApplicable,
		}
		metricChan <- uploadTimes
	}

	log.Printf("Updated %s from %s", f.Dataset, strings.Join(pathsInput, " "))
	osmoChan <- "Updated " + f.Dataset + "\n"

	if strings.Contains(f.Dataset, ":") {
		datasetSplitInfo := strings.Split(f.Dataset, ":")
		f.Dataset = datasetSplitInfo[0] + ":" + datasetVersion
	} else {
		f.Dataset = f.Dataset + ":" + datasetVersion
	}

	f.Url = SendDatasetSizeAndChecksum(c, f.Dataset, osmoChan)
}

// Define "url" input/output
type UrlInput struct {
	// url:<folder>,<url>,<regex>
	Folder string
	Url    string
	Regex  string
}

func (f UrlInput) GetLogInfo() string       { return f.Url }
func (f UrlInput) GetUrlIdentifier() string { return f.Url }
func (f UrlInput) GetFolder() string        { return f.Folder }
func (f UrlInput) CreateMount(c net.Conn, inputPath string,
	credentialInfo ConfigInfo, osmoChan chan string, metricChan chan metrics.Metric,
	retryId string, groupName string, taskName string, downloadType string, inputIndex int,
	cacheSize int) {

	mountPath := CreateFolder(inputPath, f.Folder)
	inputType := "Mounted"

	if downloadType != Download {
		// TODO: Detect if url is to a file to download instead of mount
		cachePath := CreateFolder(inputPath, f.Folder+"-cache")
		inputStartTime := time.Now().Format("2006-01-02 15:04:05.000")
		isEmpty := MountURL(downloadType, credentialInfo, f.Url, mountPath,
			cachePath, cacheSize, osmoChan)
		inputEndTime := time.Now().Format("2006-01-02 15:04:05.000")

		if isEmpty {
			osmoChan <- fmt.Sprintf("Mount for %s failed", f.Url)
			downloadType = MountpointFailed
		}
		mountTimes := metrics.TaskIOMetrics{
			RetryId:       retryId,
			GroupName:     groupName,
			TaskName:      taskName,
			URL:           f.Url,
			Type:          "INPUT",
			StartTime:     inputStartTime,
			EndTime:       inputEndTime,
			OperationType: URLOperation,
			DownloadType:  downloadType,
		}
		metricChan <- mountTimes
	} else {
		inputType = "Downloaded"
		benchmarkFolder := fmt.Sprintf("%s_%s_INPUT_%d", groupName, taskName, inputIndex)
		benchmarks := DownloadURI(c, f.Url, inputPath+f.Folder, f.Regex, osmoChan, benchmarkFolder)
		for _, benchmark := range benchmarks {
			if benchmark.TotalBytesTransferred == 0 {
				// Nothing transferred for this benchmark, skipping
				continue
			}

			downloadTimes := metrics.TaskIOMetrics{
				RetryId:       retryId,
				GroupName:     groupName,
				TaskName:      taskName,
				URL:           f.Url,
				Type:          "INPUT",
				StartTime:     time.Time(benchmark.StartTime).Format("2006-01-02 15:04:05.000"),
				EndTime:       time.Time(benchmark.EndTime).Format("2006-01-02 15:04:05.000"),
				SizeInBytes:   int64(benchmark.TotalBytesTransferred),
				NumberOfFiles: benchmark.TotalNumberOfFiles,
				OperationType: URLOperation,
				DownloadType:  downloadType,
			}
			metricChan <- downloadTimes
		}
	}

	log.Printf("%s %s to %s", inputType, f.Url, inputPath+f.Folder)
	osmoChan <- inputType + " " + f.Url + " to {{input:" + f.Folder + "}}"
	PrintDirContents(c, inputPath+f.Folder, 1, osmoChan)
}

type UrlOutput struct {
	// url:<url>,<regex>
	Url   string
	Regex string
}

func (f UrlOutput) GetLogInfo() string       { return f.Url }
func (f UrlOutput) GetUrlIdentifier() string { return f.Url }
func (f *UrlOutput) UploadFolder(c net.Conn, outputPath string, osmoChan chan string,
	metricChan chan metrics.Metric, retryId string, groupName string, taskName string,
	outputUrlID string, outputIndex int) {
	benchmarkFolder := fmt.Sprintf("OUTPUT_%d", outputIndex)
	benchmarks := UploadData(f.Url, outputPath+"*", f.Regex, osmoChan, benchmarkFolder)

	for _, benchmark := range benchmarks {
		if benchmark.TotalBytesTransferred == 0 {
			continue
		}
		uploadTimes := metrics.TaskIOMetrics{
			RetryId:       retryId,
			GroupName:     groupName,
			TaskName:      taskName,
			URL:           outputUrlID,
			Type:          "OUTPUT",
			StartTime:     time.Time(benchmark.StartTime).Format("2006-01-02 15:04:05.000"),
			EndTime:       time.Time(benchmark.EndTime).Format("2006-01-02 15:04:05.000"),
			SizeInBytes:   int64(benchmark.TotalBytesTransferred),
			NumberOfFiles: benchmark.TotalNumberOfFiles,
			OperationType: URLOperation,
			DownloadType:  NotApplicable,
		}
		metricChan <- uploadTimes
	}

	log.Printf("Uploaded %s from %s", f.Url, outputPath+"*")
	osmoChan <- "Uploaded " + f.Url
}

type KpiOutput struct {
	// kpi:<url>,<path>
	Url  string
	Path string
}

func (f KpiOutput) GetLogInfo() string       { return fmt.Sprintf("KPI: %s", f.Path) }
func (f KpiOutput) GetUrlIdentifier() string { return fmt.Sprintf("%s/%s", f.Url, f.Path) }
func (f *KpiOutput) UploadFolder(c net.Conn, outputPath string, osmoChan chan string,
	metricChan chan metrics.Metric, retryId string, groupName string, taskName string,
	outputUrlID string, outputIndex int) {
	benchmarkFolder := fmt.Sprintf("OUTPUT_%d", outputIndex)
	benchmarks := UploadData(f.Url, outputPath+f.Path, "", osmoChan, benchmarkFolder)

	for _, benchmark := range benchmarks {
		if benchmark.TotalBytesTransferred == 0 {
			continue
		}
		uploadTimes := metrics.TaskIOMetrics{
			RetryId:       retryId,
			GroupName:     groupName,
			TaskName:      taskName,
			URL:           outputUrlID,
			Type:          "OUTPUT",
			StartTime:     time.Time(benchmark.StartTime).Format("2006-01-02 15:04:05.000"),
			EndTime:       time.Time(benchmark.EndTime).Format("2006-01-02 15:04:05.000"),
			SizeInBytes:   int64(benchmark.TotalBytesTransferred),
			NumberOfFiles: benchmark.TotalNumberOfFiles,
			OperationType: URLOperation,
			DownloadType:  NotApplicable,
		}
		metricChan <- uploadTimes
	}

	log.Printf("Uploaded KPI from %s", f.Path)
	osmoChan <- "Uploaded KPI: " + f.Path
}

func ParseInputOutput(value string) InputOutput {
	details := strings.SplitN(value, ":", 2)
	if details[0] == "task" {
		// task:<folder>,<url>,<regex> or task:<url>
		lineDetails := strings.SplitN(details[1], ",", 3)
		if len(lineDetails) == 3 {
			return TaskInput{lineDetails[0],
				lineDetails[1][strings.LastIndex(lineDetails[1], "/")+1:],
				lineDetails[1], lineDetails[2]}
		}
		return &TaskOutput{lineDetails[0][strings.LastIndex(lineDetails[0], "/")+1:],
			lineDetails[0]}
	} else if details[0] == "url" {
		// url:<folder>,<url>,<regex> or url:<url>,<regex>
		lineDetails := strings.SplitN(details[1], ",", 3)
		if len(lineDetails) == 2 {
			return &UrlOutput{lineDetails[0], lineDetails[1]}
		}
		return UrlInput{lineDetails[0], lineDetails[1], lineDetails[2]}
	} else if details[0] == "dataset" {
		// dataset:<folder>,<dataset | dataset:<tag or version>>,<regex> or
		// dataset:<dataset | dataset:<tag>>,<path>,<metadata>...;<labels>...;<regex>
		lineDetails := strings.SplitN(details[1], ",", 3)

		// Input
		if !strings.Contains(details[1], ";") {
			return DatasetInput{lineDetails[0], lineDetails[1], lineDetails[2]}
		}

		regexDetails := strings.SplitN(lineDetails[2], ";", 3)

		var metadataFiles []string
		if len(regexDetails[0]) > 0 {
			metadataFiles = strings.Split(regexDetails[0], ",")
		}

		var labelFiles []string
		if len(regexDetails[1]) > 0 {
			labelFiles = strings.Split(regexDetails[1], ",")
		}

		return &DatasetOutput{lineDetails[0], lineDetails[1],
			metadataFiles, "", labelFiles, "", regexDetails[2]}
	} else if details[0] == "update_dataset" {
		// Only has output
		// update_dataset:<dataset | dataset:<tag>>;<path1>,<path2>...;<metadata>...;<labels>...
		lineDetails := strings.SplitN(details[1], ";", 4)

		var pathsLocation []string
		if len(lineDetails[1]) > 0 {
			pathsLocation = strings.Split(lineDetails[1], ",")
		} else {
			pathsLocation = []string{""}
		}

		var metadataFiles []string
		if len(lineDetails[2]) > 0 {
			metadataFiles = strings.Split(lineDetails[2], ",")
		}

		var labelFiles []string
		if len(lineDetails[3]) > 0 {
			labelFiles = strings.Split(lineDetails[3], ",")
		}

		return &UpdateDatasetOutput{lineDetails[0], pathsLocation,
			metadataFiles, "", labelFiles, ""}
	} else if details[0] == "kpi" {
		// Only has output
		// kpi:<url>,<path>
		lineDetails := strings.SplitN(details[1], ",", 2)
		return &KpiOutput{lineDetails[0], lineDetails[1]}
	}
	osmo_errors.SetExitCode(osmo_errors.INVALID_INPUT_CODE)
	panic(fmt.Sprintf("Unknown Input %s", details[0]))
}

// ValidateDataAuth validates access permissions for a single input/output operation
// Retries on execution failures (service down, rate limit) but fails fast on auth failures
func ValidateDataAuth(value string, userConfig string, osmoChan chan string) error {
	inputOutput := ParseInputOutput(value)

	var commandArgs []string
	logInfo := inputOutput.GetLogInfo()
	urlIdentifier := inputOutput.GetUrlIdentifier()

	// Check type and build appropriate command with correct access type
	switch v := inputOutput.(type) {
	case DatasetInput:
		commandArgs = []string{"osmo", "dataset", "check", v.Dataset, "--access-type", "READ", "--config-file", userConfig}
		osmoChan <- fmt.Sprintf("Validating READ access for dataset input: %s", logInfo)

	case *DatasetOutput:
		commandArgs = []string{"osmo", "dataset", "check", v.Dataset, "--access-type", "WRITE", "--config-file", userConfig}
		osmoChan <- fmt.Sprintf("Validating WRITE access for dataset output: %s", logInfo)

	case *UpdateDatasetOutput:
		commandArgs = []string{"osmo", "dataset", "check", v.Dataset, "--access-type", "WRITE", "--config-file", userConfig}
		osmoChan <- fmt.Sprintf("Validating WRITE access for dataset update: %s", logInfo)

	case UrlInput:
		commandArgs = []string{"osmo", "data", "check", urlIdentifier, "--access-type", "READ", "--config-file", userConfig}
		osmoChan <- fmt.Sprintf("Validating READ access for URI input: %s", logInfo)

	case *UrlOutput:
		commandArgs = []string{"osmo", "data", "check", urlIdentifier, "--access-type", "WRITE", "--config-file", userConfig}
		osmoChan <- fmt.Sprintf("Validating WRITE access for URI output: %s", logInfo)

	default:
		// All other types (TaskInput, TaskOutput, KpiOutput) are ignored
		return nil
	}

	// Execute with retry logic for transient failures (exit 1)
	// Auth failures (exit 0 with status=fail) will be caught immediately
	outb := RunOSMOCommandWithRetry(commandArgs, 3, osmoChan, osmo_errors.DATA_AUTH_CHECK_FAILED_CODE)

	// Parse JSON response
	var result struct {
		Status string `json:"status"`
		Error  string `json:"error,omitempty"`
	}

	if err := json.Unmarshal(outb.Bytes(), &result); err != nil {
		errMsg := fmt.Sprintf("Failed to parse validation response for %s: %s", logInfo, err.Error())
		osmoChan <- errMsg
		return fmt.Errorf("%s", errMsg)
	}

	switch strings.ToLower(result.Status) {
	case "pass":
		osmoChan <- fmt.Sprintf("Data auth validation successful for %s", logInfo)
		return nil

	case "fail":
		errMsg := fmt.Sprintf("Data auth validation failed for %s: %s", logInfo, result.Error)
		osmoChan <- errMsg
		return fmt.Errorf("%s", errMsg)

	default:
		errMsg := fmt.Sprintf("unknown data auth validation status: %s", result.Status)
		osmoChan <- errMsg
		return fmt.Errorf("%s", errMsg)
	}
}

// ValidateInputsOutputsAccess validates read access for all inputs and write access for all outputs
// Only validates: UrlInput, DatasetInput (READ) and UrlOutput, DatasetOutput, UpdateDatasetOutput (WRITE)
// All other types (TaskInput, TaskOutput, KpiOutput) are ignored
func ValidateInputsOutputsAccess(
	inputs common.ArrayFlags,
	outputs common.ArrayFlags,
	userConfig string,
	osmoChan chan string,
) error {
	osmoChan <- "Validating data access permissions..."

	allItems := make([]string, 0, len(inputs)+len(outputs))
	allItems = append(allItems, inputs...)
	allItems = append(allItems, outputs...)

	// Validate all items - ValidateDataAuth will parse and determine if validation is needed
	for _, value := range allItems {
		if err := ValidateDataAuth(value, userConfig, osmoChan); err != nil {
			return err
		}
	}

	osmoChan <- "All data access validations passed"
	return nil
}

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
	"strings"
	"time"

	"go.corp.nvidia.com/osmo/runtime/pkg/common"
	"go.corp.nvidia.com/osmo/runtime/pkg/metrics"
	"go.corp.nvidia.com/osmo/runtime/pkg/osmo_errors"
)

// Common functionality needed by task/url
type InputOutput interface {
	GetLogInfo() string
	GetUrlIdentifier() string
}

type InputType interface {
	GetFolder() string
	CreateMount(c net.Conn, inputPath string, osmoChan chan string,
		metricChan chan metrics.Metric, retryId string, groupName string, taskName string,
		inputIndex int)
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
	osmoChan chan string, metricChan chan metrics.Metric,
	retryId string, groupName string, taskName string, inputIndex int) {

	CreateFolder(inputPath, f.Folder)
	inputType := "Downloaded"

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
			DownloadType:  Download,
		}
		metricChan <- downloadTimes
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
	osmoChan chan string, metricChan chan metrics.Metric,
	retryId string, groupName string, taskName string, inputIndex int) {

	CreateFolder(inputPath, f.Folder)
	inputType := "Downloaded"
	benchmarkFolder := fmt.Sprintf("%s_%s_INPUT_%d", groupName, taskName, inputIndex)
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
			DownloadType:  Download,
		}
		metricChan <- downloadTimes
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
	switch inputOutput.(type) {
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

// ValidateInputsOutputsAccess validates read access for inputs and write access for outputs.
// Only URL inputs and outputs require runtime data auth validation.
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

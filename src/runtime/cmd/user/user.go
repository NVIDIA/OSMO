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

package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"

	"go.corp.nvidia.com/osmo/runtime/pkg/args"
	"go.corp.nvidia.com/osmo/runtime/pkg/common"
	"go.corp.nvidia.com/osmo/runtime/pkg/data"
	"go.corp.nvidia.com/osmo/runtime/pkg/messages"
	"go.corp.nvidia.com/osmo/runtime/pkg/rsync"

	"github.com/creack/pty"
	"github.com/google/shlex"
)

type Exit struct{ Code int }

var waitUserCommands sync.WaitGroup
var userCommand *exec.Cmd = nil

// Executes all defered functions and exits with exit code
func handleExit() {
	if e := recover(); e != nil {
		if exit, ok := e.(Exit); ok {
			os.Exit(exit.Code)
		}
		panic(e)
	}
}

func createOutLogsStream(outChan chan messages.Request) func(*exec.Cmd, *bufio.Scanner,
	sync.WaitGroup, chan bool) {
	streamOutLogs := func(cmd *exec.Cmd, scanner *bufio.Scanner,
		waitStreamLogs sync.WaitGroup, timeoutChan chan bool) {
		waitStreamLogs.Add(1)
		defer waitStreamLogs.Done()
		for scanner.Scan() {
			outChan <- messages.MessageOutRequest(scanner.Text())
		}
		if err := scanner.Err(); err != nil {
			panic(err)
		}
		timeoutChan <- false
	}
	return streamOutLogs
}

func createErrLogsStream(errChan chan messages.Request) func(*bufio.Scanner, sync.WaitGroup) {
	streamErrLogs := func(scanner *bufio.Scanner, waitStreamLogs sync.WaitGroup) {
		waitStreamLogs.Add(1)
		defer waitStreamLogs.Done()
		for scanner.Scan() {
			errChan <- messages.MessageErrRequest(scanner.Text())
		}
		if err := scanner.Err(); err != nil {
			errChan <- messages.MessageErrRequest(fmt.Sprintf("Error: %s", err))
		}
	}
	return streamErrLogs
}

func userExec(entryCommand string, socketPath string, historyFilePath string) {
	log.Printf("User Exec: Entry Command: %s", entryCommand)

	conn, err := net.Dial("unix", socketPath)
	if err != nil {
		log.Println("User Exec: fail to connect to osmo-ctrl", err)
		return
	}
	defer conn.Close()

	// Read the first message from conn to get initial window size
	dec := json.NewDecoder(conn)
	var initSize struct {
		Rows uint16 `json:"rows"`
		Cols uint16 `json:"cols"`
	}
	if err := dec.Decode(&initSize); err != nil {
		conn.Write([]byte(fmt.Sprintf("Error decoding initial size message: %s\r\n", err)))
		return
	}

	args, err := shlex.Split(entryCommand)
	if err != nil {
		conn.Write([]byte(fmt.Sprintf("Error splitting entry command: %s\r\n", err)))
		return
	}

	// Start the entry command with a pseudo-terminal (pty)
	execCmd := exec.Command(args[0], args[1:]...)
	execCmd.Env = append(os.Environ(),
		"TERM=xterm",
		"HISTFILE="+historyFilePath,
		"HISTSIZE=1000",
		"HISTFILESIZE=2000",
		"HISTCONTROL=ignoredups:ignorespace",
		"HISTIGNORE=", // Load history when bash starts
		"PS1=\\$ ",    // Force bash to be interactive to enable history
	)
	terminal, err := pty.Start(execCmd)
	if err != nil {
		conn.Write([]byte(fmt.Sprintf("Error starting pseudo-terminal: %s\r\n", err)))
		return
	}

	defer func() {
		err = terminal.Close()
		if err != nil {
			log.Println("User Exec: Error closing pseudo-terminal", err)
		} else {
			log.Println("User Exec: Ending exec sesion.")
		}
	}()

	// Set the initial terminal size
	if err := pty.Setsize(terminal, &pty.Winsize{Rows: initSize.Rows, Cols: initSize.Cols}); err != nil {
		conn.Write([]byte(fmt.Sprintf("Error setting pty size: %s\r\n", err)))
		return
	}

	var waitGroup sync.WaitGroup
	waitGroup.Add(1)

	go func() {
		_, err = io.Copy(terminal, conn)
		if err != nil {
			log.Println("User Exec: Error writing to exec instance", err)
		}
	}()

	go func() {
		defer waitGroup.Done()
		_, err = io.Copy(conn, terminal)
		if err != nil {
			log.Println("User Exec: Error reading from exec instance.", err)
		}
	}()
	waitGroup.Wait()
}

func receiveUserRequests(
	unixConn net.Conn, outChan chan messages.Request, errChan chan messages.Request,
	cmdArgs args.ExecArgs, execFinished *bool,
	cmdMsg *string, cmdErr *error) {
	for {
		retryCount := 0
		var response messages.Request
		for {
			decoder := json.NewDecoder(unixConn)
			err := decoder.Decode(&response)
			if err != nil {
				if *execFinished {
					return
				}
				log.Printf("Failed to parse response for user request: %v", err)
				retryCount++
				if retryCount >= 3 {
					log.Println("Cannot connect to Ctrl Container. Exiting...")
					return
				}
				// Connection failed, retry again
				continue
			}
			// Connection succeeded and retrieved response, breaking to process response
			break
		}
		switch response.Type {
		case messages.UserExecStart:
			log.Println("Starting user exec...")
			go userExec(response.Command, cmdArgs.SocketPath, cmdArgs.HistoryFilePath)
		case messages.UserStop:
			log.Println("Killing user command...")
			stopUserCommand(unixConn)
		case messages.UserStart:
			log.Println("Starting user command...")
			go runCommandWithReturnValues(outChan, errChan, cmdArgs, cmdMsg, cmdErr)
		}
	}
}

func connDataSidecar(path string, timeout time.Duration) net.Conn {
	unixConn, err := net.Dial("unix", path)
	start_time := time.Now()
	for {
		if err == nil {
			break
		} else {
			// Timeout for Data Sidecar
			currTime := time.Now()
			if currTime.Sub(start_time) >= timeout {
				panic("Data Sidecar took too long to start up")
			}
			unixConn, err = net.Dial("unix", path)
		}
	}

	return unixConn
}

func stopUserCommand(unixConn net.Conn) {
	if userCommand == nil {
		return
	}

	waitUserCommands.Add(1)
	pgid, err := syscall.Getpgid(userCommand.Process.Pid)
	if err == nil {
		err = syscall.Kill(-pgid, syscall.SIGKILL)
	}
	if err != nil {
		log.Printf("Error sending kill signal: %s", err)
		waitUserCommands.Done()
	}

	// Wait for current command to be killed
	for {
		if userCommand == nil {
			break
		}
		time.Sleep(time.Second)
	}

	log.Println("StopUserCommand sends UserStopFinishedRequest to Ctrl")
	if err := json.NewEncoder(unixConn).Encode(messages.UserStopFinishedRequest()); err != nil {
		panic(fmt.Sprintf("Failed to send request: %v\n", err))
	}
}

func runCommandWithReturnValues(
	outChan chan messages.Request, errChan chan messages.Request,
	cmdArgs args.ExecArgs, msg *string, err *error) {

	defer waitUserCommands.Done()
	userCommand = exec.Command(cmdArgs.Command, cmdArgs.Args...)
	userCommand.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	*msg, *err = common.RunCommand(userCommand,
		createOutLogsStream(outChan), createErrLogsStream(errChan))
	userCommand = nil
}

func putUnixLogs(
	unixConn net.Conn, outChan chan messages.Request,
	errChan chan messages.Request, opsChan chan string, stopChan chan bool) {
	for {
		select {
		case outMessage := <-outChan:
			messages.EncodeMessage(unixConn, outMessage.MessageOut, outMessage)
		case errMessage := <-errChan:
			messages.EncodeMessage(unixConn, errMessage.MessageErr, errMessage)
		case opsMessage := <-opsChan:
			messages.EncodeMessage(unixConn, opsMessage, messages.MessageOpsRequest(opsMessage))
		case <-stopChan:
			log.Printf("Go routine for sending to unixConn is done")
			return
		}
	}
}

// Setup OSMO CLI auto complete script in user's bashrc
func setupCliAutoComplete(cliAutoCompleteScriptPath string) {
	if cliAutoCompleteScriptPath == "" {
		return
	}

	if _, err := os.Stat(cliAutoCompleteScriptPath); err != nil {
		log.Printf("Warning: Failed to read CLI auto complete file: %v", err)
		return
	}

	bashrcPath := filepath.Join(os.Getenv("HOME"), ".bashrc")

	// Read existing content to check for duplicates
	content, err := os.ReadFile(bashrcPath)
	if err != nil && !os.IsNotExist(err) {
		log.Printf("Warning: Failed to read .bashrc: %v", err)
		return
	}

	if strings.Contains(string(content), cliAutoCompleteScriptPath) {
		// Already exists, skip
		return
	}

	// Append to .bashrc
	f, err := os.OpenFile(bashrcPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		log.Printf("Warning: Failed to open .bashrc: %v", err)
		return
	}
	defer f.Close()

	// Ensures that even if script fails to source, bashrc will still be executed
	if _, err := f.WriteString("\nsource " + cliAutoCompleteScriptPath + " 2>/dev/null || true\n"); err != nil {
		log.Printf("Warning: Failed to write to .bashrc: %v", err)
	}
}

func main() {
	defer handleExit()

	// Root context for sub-goroutines and sub-processes
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	cmdArgs := args.ExecParse()

	// Set PATH environment variable to include OSMO user binary path
	// This cannot be done from Kubernetes spec because $PATH expansion is
	// not yet available outside of a running container.
	os.Setenv("PATH", fmt.Sprintf("%s:%s", os.Getenv("PATH"), cmdArgs.UserBinPath))
	setupCliAutoComplete(cmdArgs.CliAutoCompleteScriptPath)

	if file, err := os.Create(cmdArgs.HistoryFilePath); err != nil {
		log.Printf("Warning: Failed to create history file: %v", err)
	} else {
		file.Close()
		// Ensure the file has proper permissions
		if err := os.Chmod(cmdArgs.HistoryFilePath, 0644); err != nil {
			log.Printf("Warning: Failed to set history file permissions: %v", err)
		}
	}

	// Start a unix socket connection to Data Sidecar
	unixConn := connDataSidecar(cmdArgs.SocketPath, cmdArgs.UnixTimeout)
	defer unixConn.Close()

	var response messages.Request
	for {
		decoder := json.NewDecoder(unixConn)
		err := decoder.Decode(&response)
		if err != nil {
			panic(fmt.Sprintf("Failed to parse response: %v\n", err))
		}

		if response.Type == messages.CtrlFailed {
			return
		} else if response.Type == messages.ExecStart {
			break
		} else {
			log.Printf("Ignore unexpected Type: %s", response.Type)
		}
	}

	execFinished := false

	outChan := make(chan messages.Request)
	errChan := make(chan messages.Request)
	opsChan := make(chan string)
	stopChan := make(chan bool)
	go putUnixLogs(unixConn, outChan, errChan, opsChan, stopChan)

	var cmdMsg string
	var cmdErr error = nil
	var waitCheckpoint sync.WaitGroup
	stopCheckpoint := false

	// Start a goroutine to run rsync if enabled
	if cmdArgs.EnableRsync {
		go func() {
			if err := rsync.RunRsync(
				ctx,
				cmdArgs.UserBinPath,
				cmdArgs.RunLocation,
				cmdArgs.RsyncReadLimit,
				cmdArgs.RsyncWriteLimit,
				cmdArgs.RsyncPathAllowList,
				unixConn,
			); err != nil {
				log.Printf("Rsync failed with error: %v", err)
			}
		}()
	}

	// Start a goroutine to receive user requests
	go receiveUserRequests(unixConn, outChan, errChan, cmdArgs, &execFinished,
		&cmdMsg, &cmdErr)
	waitUserCommands.Add(1)
	// Start the user command
	go runCommandWithReturnValues(outChan, errChan, cmdArgs, &cmdMsg, &cmdErr)
	// Begin checkpointing
	for _, checkpoint := range cmdArgs.Checkpoint {
		waitCheckpoint.Add(1)
		go data.Checkpoint(opsChan, checkpoint, &waitCheckpoint, &stopCheckpoint)
	}
	waitUserCommands.Wait()
	execFinished = true
	stopCheckpoint = true
	waitCheckpoint.Wait()
	stopChan <- true

	// Make sure all output files are readable (add read bit for ugo)
	// Read current perms and OR with 0o444
	if fi, err := os.Stat(response.OutputFolder); err != nil {
		log.Printf("Failed to send request: %v\n", err)
	} else {
		newPerm := fi.Mode().Perm() | 0444
		if chmodErr := os.Chmod(response.OutputFolder, newPerm); chmodErr != nil {
			log.Printf("Failed to send request: %v\n", chmodErr)
		}
	}

	if cmdErr != nil {
		log.Println(cmdErr)

		if err := json.NewEncoder(unixConn).Encode(messages.ExecFailedRequest(cmdMsg)); err != nil {
			panic(fmt.Sprintf("Failed to send request: %v\n", err))
		}
		if exitErr, ok := cmdErr.(*exec.ExitError); ok {
			panic(Exit{exitErr.ExitCode()})
		}
		panic(fmt.Sprintf("Exec failed with error: %v\n", cmdErr))
	} else {
		if err := json.NewEncoder(unixConn).Encode(messages.ExecFinishedRequest()); err != nil {
			panic(fmt.Sprintf("Failed to send request: %v\n", err))
		}
	}
}

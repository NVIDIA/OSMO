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

package args

import (
	"flag"
	"time"

	"go.corp.nvidia.com/osmo/runtime/pkg/common"
)

// Parse and process command line arguments
func ExecParse() ExecArgs {
	var commands, args, checkpoint common.ArrayFlags
	flag.Var(&commands, "commands", "Pod commands.")
	flag.Var(&args, "args", "Pod args.")
	flag.Var(&checkpoint, "checkpoint", "Checkpoint information.")
	socketPath := flag.String("socketPath", "", "Socket Location.")
	unixTimeout := flag.Int("unixTimeout", 120, "osmo_exec wait time (m) for the unix connection.")
	userBinPath := flag.String("userBinPath", "/osmo/usr/bin", "User bin path.")
	historyFilePath := flag.String(
		"historyFilePath", "/osmo/data/.bash_history", "History file path.")
	runLocation := flag.String("runLocation", "/osmo/run", "Run location.")
	enableRsync := flag.Bool("enableRsync", false, "Enable rsync.")
	rsyncReadLimit := flag.Int("rsyncReadLimit", 0, "Read limit in bytes per second.")
	rsyncWriteLimit := flag.Int("rsyncWriteLimit", 0, "Write limit in bytes per second.")
	rsyncAllowedPaths := flag.String("rsyncPathAllowList", "", "Allowed paths for rsync.")
	cliAutoCompleteScriptPath := flag.String(
		"cliAutoCompleteScriptPath",
		"/osmo/usr/bin/osmo_cli/osmo/autocomplete.bash",
		"CLI auto complete file path.",
	)

	flag.Parse()

	command := commands[0]
	if len(commands) > 1 {
		args = append(commands[1:], args...)
	}

	unixDuration := time.Duration(*unixTimeout) * time.Minute

	parsedArgs := ExecArgs{
		Command:         command,
		Args:            args,
		Checkpoint:      checkpoint,
		SocketPath:      *socketPath,
		UnixTimeout:     unixDuration,
		UserBinPath:     *userBinPath,
		HistoryFilePath: *historyFilePath,
		RunLocation:     *runLocation,

		// Rsync flags
		EnableRsync:        *enableRsync,
		RsyncReadLimit:     *rsyncReadLimit,
		RsyncWriteLimit:    *rsyncWriteLimit,
		RsyncPathAllowList: *rsyncAllowedPaths,

		CliAutoCompleteScriptPath: *cliAutoCompleteScriptPath,
	}
	return parsedArgs
}

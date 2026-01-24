#!/bin/bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
# http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#
# SPDX-License-Identifier: Apache-2.0

###############################################################################
# Common Functions for OSMO Deployment Scripts
###############################################################################

# Colors for output
export RED='\033[0;31m'
export GREEN='\033[0;32m'
export YELLOW='\033[1;33m'
export BLUE='\033[0;34m'
export CYAN='\033[0;36m'
export NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if a command exists
check_command() {
    if ! command -v "$1" &> /dev/null; then
        log_error "$1 is not installed. Please install it and try again."
        exit 1
    fi
}

# Prompt for user input
prompt_value() {
    local prompt_text="$1"
    local default_value="${2:-}"
    local is_secret="${3:-false}"
    local result=""

    if [[ -n "$default_value" ]]; then
        echo -en "${CYAN}$prompt_text${NC} [${GREEN}$default_value${NC}]: " >&2
    else
        echo -en "${CYAN}$prompt_text${NC}: " >&2
    fi

    if [[ "$is_secret" == "true" ]]; then
        read -rs result
        echo "" >&2
    else
        read -r result
    fi

    if [[ -z "$result" && -n "$default_value" ]]; then
        result="$default_value"
    fi

    echo "$result"
}

# Validate password strength
validate_password() {
    local password="$1"
    local min_length=8

    if [[ ${#password} -lt $min_length ]]; then
        return 1
    fi

    if ! [[ "$password" =~ [A-Z] && "$password" =~ [a-z] && "$password" =~ [0-9] ]]; then
        return 1
    fi

    return 0
}

# Wait for pods to be ready
wait_for_pods() {
    local namespace=$1
    local timeout=${2:-300}
    local label_selector=${3:-""}
    local kubectl_cmd=${4:-"kubectl"}

    log_info "Waiting for pods in namespace '$namespace' to be ready..."

    local selector_arg=""
    if [[ -n "$label_selector" ]]; then
        selector_arg="-l $label_selector"
    fi

    local start_time=$(date +%s)
    while true; do
        local current_time=$(date +%s)
        local elapsed=$((current_time - start_time))

        if [[ $elapsed -ge $timeout ]]; then
            log_error "Timeout waiting for pods in namespace '$namespace'"
            $kubectl_cmd get pods -n $namespace $selector_arg
            return 1
        fi

        local pod_output=$($kubectl_cmd get pods -n $namespace $selector_arg --no-headers 2>/dev/null || echo "")
        local not_ready=$(echo "$pod_output" | grep -v "Running\|Completed\|^$" | wc -l | tr -d '[:space:]' || echo "0")
        not_ready="${not_ready:-0}"
        if [[ "$not_ready" =~ ^[0-9]+$ ]] && [[ "$not_ready" -eq 0 ]]; then
            local running=$(echo "$pod_output" | grep "Running" | wc -l | tr -d '[:space:]' || echo "0")
            running="${running:-0}"
            if [[ "$running" =~ ^[0-9]+$ ]] && [[ "$running" -gt 0 ]]; then
                log_success "All pods in namespace '$namespace' are ready"
                return 0
            fi
        fi

        echo -n "."
        sleep 10
    done
}

# Export infrastructure outputs to environment
export_outputs() {
    local provider="$1"
    local outputs_file="$2"

    if [[ -f "$outputs_file" ]]; then
        source "$outputs_file"
        log_success "Loaded infrastructure outputs from $outputs_file"
    else
        log_error "Outputs file not found: $outputs_file"
        return 1
    fi
}


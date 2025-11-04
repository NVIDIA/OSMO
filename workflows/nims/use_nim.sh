# SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
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

# Parse command-line arguments
nim_url=""
model=""
wait_seconds=""
max_tokens="48"  # Default value

while [[ $# -gt 0 ]]; do
  case $1 in
    --url)
      nim_url="$2"
      shift 2
      ;;
    --wait-seconds)
      wait_seconds="$2"
      shift 2
      ;;
    --model)
      model="$2"
      shift 2
      ;;
    --max-tokens)
      max_tokens="$2"
      shift 2
      ;;
    *)
      echo "Error: Unknown argument '$1'"
      echo "Usage: $0 --url <nim_url> [--model <model>] [--wait-seconds <seconds>] [--max-tokens <tokens>]"
      exit 1
      ;;
  esac
done

# Validate required parameters
if [ -z "$nim_url" ]; then
  echo "Error: --url is required"
  echo "Usage: $0 --url <nim_url> [--model <model>] [--wait-seconds <seconds>] [--max-tokens <tokens>]"
  exit 1
fi

# Wait for the NIM server to be ready (if wait_seconds is provided)
if [ -n "$wait_seconds" ]; then
  echo "Waiting for NIM server to be ready..."
  sleep_interval=5
  remaining="$wait_seconds"
  while true; do
    http_status=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 1 "$nim_url")
    if [ -n "$http_status" ] && [ "$http_status" != "000" ]; then
      break
    fi
    if [ "$remaining" -le 0 ]; then
      echo "Error: Could not connect to NIM server after ${wait_seconds} seconds."
      exit 1
    fi
    echo "Waiting for NIM server to start. ${remaining}s remaining..."
    sleep "$sleep_interval"
    remaining=$((remaining - sleep_interval))
  done
  
  sleep 5
fi

echo "Calling the NIM API..."

# Define the prompt to send to the NIM API
data=$(cat <<EOF
{
  "model": "$model",
  "messages": [
    {
      "role": "user",
      "content": "Write a limerick about the wonders of GPU computing."
    }
  ],
  "temperature": 0.2,
  "top_p": 0.7,
  "frequency_penalty": 0,
  "presence_penalty": 0,
  "max_tokens": $max_tokens,
  "stream": false
}
EOF
)

# Make the API call to the NIM server and parse the response
curl -X POST \
  --url "${nim_url}/v1/chat/completions" \
  --header "Authorization: Bearer $NGC_API_KEY" \
  --header "Accept: application/json" \
  --header "Content-Type: application/json" \
  --data "$data" |
  jq -r '.choices[0].message.content'
#!/usr/bin/env bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

if [[ -n "${RUNFILES_DIR:-}" && -f "$RUNFILES_DIR/_main/deployments/scripts/storage/minio.sh" ]]; then
    MINIO_SCRIPT="$RUNFILES_DIR/_main/deployments/scripts/storage/minio.sh"
else
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
    MINIO_SCRIPT="$SCRIPT_DIR/minio.sh"
fi
TEST_DIR="${TEST_TMPDIR:-$(mktemp -d)}"
KUBECTL_LOG="$TEST_DIR/kubectl.log"
FAKE_BIN="$TEST_DIR/bin"
mkdir -p "$FAKE_BIN"

cat > "$FAKE_BIN/kubectl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
echo "$*" >> "$KUBECTL_LOG"
case "$1 $2" in
    "get svc")
        echo 9000
        ;;
    "run minio-bucket-setup-"*)
        ;;
    "create secret")
        printf 'apiVersion: v1\nkind: Secret\n'
        ;;
    "apply -f")
        cat >/dev/null
        ;;
    *)
        echo "unexpected kubectl args: $*" >&2
        exit 1
        ;;
esac
EOF
chmod +x "$FAKE_BIN/kubectl"

cat > "$FAKE_BIN/timeout" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
shift
"$@"
EOF
chmod +x "$FAKE_BIN/timeout"

run_minio() {
    local addressing_style="${1:-}"
    : > "$KUBECTL_LOG"
    if [[ -n "$addressing_style" ]]; then
        env \
            PATH="$FAKE_BIN:$PATH" \
            KUBECTL=kubectl \
            KUBECTL_LOG="$KUBECTL_LOG" \
            NAMESPACE=osmo \
            OUTPUT_VALUES="$TEST_DIR/values.yaml" \
            MINIO_ROOT_USER=minio \
            MINIO_ROOT_PASSWORD=password \
            MINIO_ADDRESSING_STYLE="$addressing_style" \
            bash "$MINIO_SCRIPT"
    else
        env \
            PATH="$FAKE_BIN:$PATH" \
            KUBECTL=kubectl \
            KUBECTL_LOG="$KUBECTL_LOG" \
            NAMESPACE=osmo \
            OUTPUT_VALUES="$TEST_DIR/values.yaml" \
            MINIO_ROOT_USER=minio \
            MINIO_ROOT_PASSWORD=password \
            bash "$MINIO_SCRIPT"
    fi
}

assert_kubectl_log_contains() {
    local expected="$1"
    if ! grep -q -- "$expected" "$KUBECTL_LOG"; then
        echo "Expected kubectl log to contain: $expected" >&2
        cat "$KUBECTL_LOG" >&2
        exit 1
    fi
}

run_minio
assert_kubectl_log_contains "--from-literal=addressing_style=path"

run_minio virtual
assert_kubectl_log_contains "--from-literal=addressing_style=virtual"

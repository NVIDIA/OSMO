#!/usr/bin/env bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0
set -euo pipefail
umask 077

# Only encrypted state crosses the job boundary. No password/output files belong
# in the diagnostics directory, even when preservation or decryption fails.
: "${OSMO_AZURE_TFSTATE_KEY:?Set the internal-ci state encryption secret}"
private=$(mktemp -d)
trap 'rm -rf -- "$private"' EXIT
printf '%s' "$OSMO_AZURE_TFSTATE_KEY" > "$private/passphrase"
unset OSMO_AZURE_TFSTATE_KEY
gpg_args=(--batch --yes --no-options --pinentry-mode loopback --no-symkey-cache
    --passphrase-file "$private/passphrase")

case "${1:-}" in
    check)
        printf 'osmo-state-key-check' > "$private/input"
        gpg "${gpg_args[@]}" --symmetric --cipher-algo AES256 \
            --output "$private/check.gpg" "$private/input"
        gpg "${gpg_args[@]}" --output "$private/output" --decrypt "$private/check.gpg"
        cmp "$private/input" "$private/output"
        ;;
    save)
        # Usage: save WORK_DIR INPUT_DIR MARKER ENCRYPTED_OUTPUT
        mkdir "$private/state"
        for file in terraform.tfstate terraform.tfstate.backup .terraform.lock.hcl; do
            if [[ -f "$2/$file" ]]; then
                cp "$2/$file" "$private/state/"
            fi
        done
        cp "$3/single-plane.tfvars" "$3/ci.tfvars.json" "$private/state/"
        cp "$4" "$private/state/cloud-attempt.json"
        tar -czf "$private/state.tar.gz" -C "$private/state" .
        gpg "${gpg_args[@]}" --symmetric --cipher-algo AES256 \
            --output "$5" "$private/state.tar.gz"
        ;;
    restore)
        # Usage: restore ENCRYPTED_INPUT EMPTY_DESTINATION
        gpg "${gpg_args[@]}" --output "$private/state.tar.gz" --decrypt "$2"
        # Our archive is a flat allowlist. Reject paths/links before extraction.
        tar -tzf "$private/state.tar.gz" > "$private/members"
        while IFS= read -r member; do
            case "$member" in
                ./|./terraform.tfstate|./terraform.tfstate.backup|./.terraform.lock.hcl|\
                ./single-plane.tfvars|./ci.tfvars.json|./cloud-attempt.json) ;;
                *) echo "Unexpected state archive member" >&2; exit 1 ;;
            esac
        done < "$private/members"
        if tar -tvzf "$private/state.tar.gz" | awk 'substr($0,1,1) != "-" && substr($0,1,1) != "d" {bad=1} END {exit !bad}'; then
            echo "Links are not allowed in the state archive" >&2
            exit 1
        fi
        mkdir -p "$3"
        [[ -z "$(ls -A "$3")" ]] || { echo "Restore directory must be empty" >&2; exit 1; }
        tar -xzf "$private/state.tar.gz" -C "$3"
        test -s "$3/cloud-attempt.json"
        test -s "$3/single-plane.tfvars"
        test -s "$3/ci.tfvars.json"
        ;;
    *) echo "Usage: $0 check | save WORK INPUTS MARKER OUTPUT | restore INPUT DEST" >&2; exit 2 ;;
esac

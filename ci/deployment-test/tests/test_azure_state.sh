#!/usr/bin/env bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0
set -euo pipefail
repo="${TEST_SRCDIR:?}/_main"
helper="$repo/ci/deployment-test/azure-state.sh"
temporary=$(mktemp -d)
trap 'rm -rf -- "$temporary"' EXIT
export GNUPGHOME="$temporary/gnupg"
# Fresh runners have no GPG home. The helper must own its temporary GPG state.
mkdir -m 700 "$temporary/work" "$temporary/inputs"
export OSMO_AZURE_TFSTATE_KEY=only-a-test-key-not-a-real-secret
printf 'database-password-sentinel' > "$temporary/work/terraform.tfstate"
printf 'provider-lock' > "$temporary/work/.terraform.lock.hcl"
printf 'never-archive-me' > "$temporary/work/kubeconfig"
printf 'never-archive-me' > "$temporary/work/password"
printf '{}' > "$temporary/marker.json"
printf 'postgres_password = null\n' > "$temporary/inputs/single-plane.tfvars"
printf '{"cluster_name":"test"}' > "$temporary/inputs/ci.tfvars.json"
bash "$helper" check
bash "$helper" save "$temporary/work" "$temporary/inputs" "$temporary/marker.json" "$temporary/state.gpg"
if grep -aFq 'database-password-sentinel' "$temporary/state.gpg"; then exit 1; fi
bash "$helper" restore "$temporary/state.gpg" "$temporary/restored"
for file in terraform.tfstate .terraform.lock.hcl; do
    cmp "$temporary/work/$file" "$temporary/restored/$file"
done
[[ ! -e "$temporary/restored/kubeconfig" && ! -e "$temporary/restored/password" ]]
cmp "$temporary/inputs/ci.tfvars.json" "$temporary/restored/ci.tfvars.json"
if OSMO_AZURE_TFSTATE_KEY=incorrect bash "$helper" restore "$temporary/state.gpg" "$temporary/bad-key" 2>/dev/null; then
    echo 'Wrong key was accepted' >&2; exit 1
fi
[[ ! -e "$temporary/bad-key" ]]
head -c 24 "$temporary/state.gpg" > "$temporary/corrupt.gpg"
if bash "$helper" restore "$temporary/corrupt.gpg" "$temporary/corrupt" 2>/dev/null; then
    echo 'Corrupted archive was accepted' >&2; exit 1
fi
if OSMO_AZURE_TFSTATE_KEY='' bash "$helper" check 2>/dev/null; then
    echo 'Empty encryption key was accepted' >&2; exit 1
fi
# A failure before Terraform writes state still yields an explicit recoverable
# archive; the destroy helper must not confuse it with an empty successful apply.
rm "$temporary/work/terraform.tfstate"
bash "$helper" save "$temporary/work" "$temporary/inputs" "$temporary/marker.json" "$temporary/empty.gpg"
bash "$helper" restore "$temporary/empty.gpg" "$temporary/empty"
[[ ! -e "$temporary/empty/terraform.tfstate" && -f "$temporary/empty/cloud-attempt.json" ]]
[[ ! -e "$GNUPGHOME" ]]
echo 'State encryption, integrity, partial-state and allowlist checks passed'

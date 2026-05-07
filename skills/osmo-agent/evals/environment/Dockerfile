# Eval environment for the osmo-agent skill.
#
# Build context: the skill root (skills/osmo-agent/).
# Used by ACES to build the runtime image the agent executes in
# during eval runs.
#
# We pre-install a stateless mock `osmo` CLI on PATH so the skill's
# prescribed commands resolve end-to-end without needing a live OSMO
# backend. The mock dispatches to canned JSON fixtures discovered
# from evals/files/fixtures/<scenario>/ at runtime — see
# evals/files/mock_osmo/osmo for the dispatcher source.

FROM python:3.11-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends bash jq curl ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Install the mock `osmo` CLI on PATH so `osmo <subcommand>` resolves
# to the dispatcher script. The dispatcher walks `evals/files/fixtures/`
# under the agent's working directory at runtime, so this Dockerfile
# only needs to put it on PATH; the per-scenario fixtures stage
# automatically through ACES.
COPY evals/files/mock_osmo/osmo /usr/local/bin/osmo
RUN chmod +x /usr/local/bin/osmo

WORKDIR /workspace

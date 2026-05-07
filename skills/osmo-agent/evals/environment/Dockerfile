# Eval environment for the osmo-agent skill.
#
# ACES runs the eval inside a container built from this Dockerfile.
# At runtime, ACES stages everything under `evals/files/` to
# `/workspace/input/`, so the mock `osmo` dispatcher script lands at
# `/workspace/input/mock_osmo/osmo` and its fixtures at
# `/workspace/input/fixtures/<scenario>/...`.
#
# We install a tiny shell wrapper at `/usr/local/bin/osmo` that
# exec's the staged dispatcher, so the skill's prescribed commands
# (`osmo profile list`, `osmo workflow query …`, etc.) resolve
# end-to-end without needing a live OSMO backend.

FROM ubuntu:24.04

RUN apt-get update && \
    apt-get install -y --no-install-recommends bash jq curl ca-certificates findutils && \
    rm -rf /var/lib/apt/lists/*

# Install the `osmo` shim on PATH. It defers to the dispatcher that
# ACES mounts at runtime — the dispatcher's fixture-discovery walks
# `/workspace/input/fixtures/<scenario>/...` from its own location.
RUN printf '#!/usr/bin/env bash\nexec bash /workspace/input/mock_osmo/osmo "$@"\n' \
        > /usr/local/bin/osmo && \
    chmod +x /usr/local/bin/osmo

# Stage sample workflow YAMLs at the agent's cwd so eval prompts that
# reference `workflow.yaml` or `jinja_workflow.yaml` resolve there. The
# YAMLs sit under a subdirectory because ACES only copies subdirectories
# (and `Dockerfile`/`docker-compose.yaml`) from `evals/environment/`
# into the Docker build context — loose files alongside the Dockerfile
# don't get staged.
RUN mkdir -p /workspace
COPY workflows/simple_workflow.yaml /workspace/workflow.yaml
COPY workflows/jinja_workflow.yaml  /workspace/jinja_workflow.yaml

WORKDIR /workspace

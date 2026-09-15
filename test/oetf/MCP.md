# MCP authentication and OETF coverage

MCP uses its own OAuth proxy. OETF's normal API token still authenticates CLI
and Core comparisons, but cannot authenticate `/mcp`. Do not enable a direct
token mode or give OETF the server's OIDC client secret.

## Bootstrap a session

From the public checkout containing this change, use an existing MCP-enabled
dev instance. This command does not deploy or configure a server.

```bash
bazel run //test/oetf:mcp_login -- \
  --url https://<user>-dev.osmo.nvidia.com \
  --username <user> \
  --session-dir /tmp/osmo-<user>-mcp-session \
  --callback-port 8765
```

Complete the printed login URL in your browser, including IdP MFA and MCP
consent. FastMCP handles native-client registration and authorization code with
PKCE. The helper verifies `osmo_get_profile` returns the requested username
before saving the session. No token or server Secret is printed.

The callback is on `127.0.0.1:8765` on the helper's machine. If your browser is
elsewhere, first forward that port to your browser machine (for example, an
SSH local port forward). Login has a five-minute timeout. Fresh bootstrap
exercises discovery, consent, the deployed IdP callback, code exchange,
authentication, and a real MCP tool call.

The caller-owned directory must be private (0700). It contains encrypted
credentials, a private encryption key and an exclusive lock (0600). Use a
different directory for every endpoint/identity. Keep the entire directory
out of source control, Bazel outputs, CI artifacts and test reports. Encryption
does not protect against someone who can read both ciphertext and its key.
Only provision these files to an authorized test runner.

## Run required MCP coverage

From the internal repo, after configuring the existing dev environment and
its ordinary OETF API token:

```bash
bazel run //test/oetf:run -- \
  --env <user>-dev \
  --target-pattern @osmo_workspace//test/smoke:mcp-checks \
  --mcp-session-dir /tmp/osmo-<user>-mcp-session
```

Both Bazel invocations must use the public candidate. To test an unmerged
public worktree without changing the internal submodule pointer, add
`--override_module=osmo_workspace=/path/to/public` to the outer `bazel run`
options and pass `--bazel-arg=--override_module=osmo_workspace=/path/to/public`
to OETF for the inner test invocation.

`OETF_MCP_SESSION_DIR` is the alternative to the path flag. The runner forwards
the resolved directory, not token values. Authenticated tests fail if the
session is absent, invalid, or belongs to another endpoint/user; they do not
skip. The old `OSMO_MCP_ACCESS_TOKEN` shortcut is not used.

The five checks cover public discovery, rejection of missing/invalid/API-only
tokens, the independent 26-tool catalog and caller metadata, explicit session
refresh, and workflow validation. Full coverage requires all five to pass.
CLI and MCP must use the same principal and compatible permissions, but their
token metadata differs: MCP's relayed SSO identity has no named OSMO API token.
Validation failures may persist a failed submission; run that smoke only where
this is acceptable.

For discovery-only diagnosis, add
`--bazel-arg=--test_arg=McpChecks.test_public_discovery_surface`. The current
shared fixture still needs API authentication for this public probe. This
diagnostic run is not authenticated MCP coverage.

## Refresh and reauthentication

Every test client binds its session to the authenticated OETF username. Before
refresh, it validates resource/authorization metadata and uses the advertised
`/mcp/token` endpoint. This avoids the pinned client's fresh-process fallback
to origin `/token`. Rotations are mutually exclusive and saved atomically.

The regular test job is headless. It refreshes expiring access tokens and fails
clearly if login is required; it never falls back to API authentication or
opens a browser. Repeat explicit bootstrap after session expiration/revocation.
Refresh credentials do not guarantee indefinitely unattended operation or
bypass MFA and consent policy.

Run fresh bootstrap periodically as a separate login-flow check. Passing with
cached credentials alone does not prove new login works. Local mocked storage
and refresh regressions are not deployed E2E.

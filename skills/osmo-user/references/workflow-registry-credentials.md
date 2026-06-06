# OSMO Registry Credentials

Use this for private image pulls, NGC credentials, and events containing
`ImagePullBackOff`, `ErrImagePull`, `unauthorized`, or `pull access denied`.
Read `workflow-credentials.md` first for credential types and safety rules.

Registry credentials are OSMO workflow credentials. They are not local
`docker login` state and are not Kubernetes secrets created with `kubectl`.

## Create an NGC Registry Credential

For private `nvcr.io` images, resolve the NGC API key in this order:

1. `$NGC_CLI_API_KEY`
2. `$NGC_API_KEY`
3. User-provided key

Do not echo the key. If no key is available, ask the user to provide an NGC API
key or configure one of those environment variables.

```bash
NGC_KEY="${NGC_CLI_API_KEY:-${NGC_API_KEY:-}}"
osmo credential set nvcr --type REGISTRY \
  --payload registry=nvcr.io username='$oauthtoken' auth="$NGC_KEY"
```

Important details:

- `registry` is the hostname only: `nvcr.io`, no scheme and no path.
- `username` is the literal string `$oauthtoken` for NGC.
- `auth` is the raw NGC API key, not a base64 Docker auth string.
- The credential name, such as `nvcr`, is for managing the OSMO credential.
- Do not add workflow YAML credential fields to fix image pulls; OSMO manages
  registry credentials outside the workflow spec.

## Check Existing Registry Credentials

```bash
osmo credential list
```

Look for an existing `REGISTRY` credential for the registry host, such as
`nvcr.io`. Do not create a duplicate unless the user asks or the existing
credential is clearly wrong.

## Diagnose Image Pull Failures

Fetch events:

```bash
osmo workflow events <workflow_id>
```

Common causes:

| Event text | Likely cause | Fix |
|---|---|---|
| `manifest unknown` | Image path or tag does not exist | Verify the exact image tag. |
| `unauthorized` | Missing or wrong registry credential | Create or fix the `REGISTRY` credential. |
| `pull access denied` | Credential lacks access or registry host is wrong | Check access and `registry=...`. |
| `ImagePullBackOff` with no auth detail | Pull failed before user container started | Inspect events and image name. |

If the registry credential exists but `auth` contains a Docker base64 string
from `~/.docker/config.json`, replace it with the raw registry token or NGC API
key.

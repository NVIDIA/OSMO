# OSMO Workflow Credentials

Use this reference when a workflow needs credentials, especially when it pulls a
private image such as `nvcr.io/...`, or when events show `ImagePullBackOff`,
`ErrImagePull`, `unauthorized`, or `pull access denied`.

Credentials are OSMO workflow credentials. They are not local `docker login`
state and are not Kubernetes secrets created with `kubectl`.

## Safety Rules

- Never print secret values back to the user.
- Prefer existing credentials when they match the needed registry or secret.
- Prefer environment variables over asking the user to paste a secret.
- Ask the user for a secret only after automatic sources are exhausted.
- Do not create Kubernetes image-pull secrets from this skill.

## Check Existing Credentials

```bash
osmo credential list
```

Look for a `REGISTRY` credential for the needed registry host, such as
`nvcr.io`. If one exists, reuse its credential name in the workflow YAML. Do
not create a duplicate unless the user asks.

## Create an NGC Registry Credential

For private `nvcr.io` images, resolve the NGC API key in this order:

1. `$NGC_CLI_API_KEY`
2. `$NGC_API_KEY`
3. User-provided key

Do not echo the key.

```bash
NGC_KEY="${NGC_CLI_API_KEY:-${NGC_API_KEY:-}}"
```

If no key is available, ask the user to provide an NGC API key or configure one
of those environment variables. Stop until they provide it.

Create the credential with `--type REGISTRY` and `--payload` key/value fields:

```bash
osmo credential set nvcr --type REGISTRY \
  --payload registry=nvcr.io username='$oauthtoken' auth="$NGC_KEY"
```

Important details:

- `registry` is the hostname only: `nvcr.io`, no scheme and no path.
- `username` is the literal string `$oauthtoken` for NGC.
- `auth` is the raw NGC API key, not a base64 Docker auth string.
- The credential name, such as `nvcr`, is what workflow tasks reference.

## Reference Credentials in Workflow YAML

Add the credential under each task that needs the private image or secret.

```yaml
workflow:
  tasks:
  - name: train
    image: nvcr.io/nvidia/pytorch:24.01-py3
    credentials:
      nvcr:
        NGC_CLI_API_KEY: auth
```

The outer key (`nvcr`) must exactly match the credential name. For a
`REGISTRY` credential, referencing it in `credentials:` lets OSMO wire it as
the task pod's image-pull credential. The nested map also projects payload
fields into the task environment; here `auth` becomes `NGC_CLI_API_KEY`.

Do not write `nvcr:` with an empty or null value. If the task does not need the
key at runtime, still use a harmless mapping such as `NGC_CLI_API_KEY: auth`.

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
| `pull access denied` | Credential lacks access or registry host is wrong | Check NGC access and `registry=...`. |
| `ImagePullBackOff` with no auth detail | Image pull failed before user container started | Inspect events and image name. |

If the workflow YAML lacks a matching `credentials:` entry for a private image,
add one and resubmit. If the credential exists but `auth` contains a Docker
base64 string from `~/.docker/config.json`, replace it with the raw NGC API key.

## Generic Credentials

Use `GENERIC` for task secrets such as API tokens.

```bash
osmo credential set hf-token --type GENERIC --payload token=<secret>
osmo credential set ssh-key --type GENERIC --payload-file ssh_public_key=<path>
```

Project fields into task environment variables or mount paths using
`credentials:` in the workflow YAML. Keep the workflow spec free of hard-coded
secret values.

## Data Credentials

Use `DATA` for object-storage access. Mandatory fields are
`access_key_id`, `access_key`, and `endpoint`; optional fields include
`region`, `override_url`, and `addressing_style`.

```bash
osmo credential set my-s3 --type DATA \
  --payload access_key_id=<id> access_key=<secret> endpoint=<endpoint>
```

For direct storage operations, prefer `osmo data check` or `osmo dataset check`
to verify access before large transfers.

## Delete Credentials

```bash
osmo credential delete <name>
```

Deleting a credential can break future submissions that reference it. Ask for
explicit confirmation before deleting.

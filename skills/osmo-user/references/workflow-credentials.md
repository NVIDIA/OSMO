# OSMO Workflow Credentials

Use this reference to choose and manage OSMO workflow credential types. For
private image pulls, NGC setup, or image-pull failures, read
`workflow-registry-credentials.md` after this overview.

Credentials are OSMO workflow credentials. They are not local `docker login`
state and are not Kubernetes secrets created with `kubectl`.

## Safety Rules

- Never print secret values back to the user.
- Prefer existing credentials when they match the needed registry or secret.
- Prefer environment variables over asking the user to paste a secret.
- Ask the user for a secret only after automatic sources are exhausted.
- Do not create Kubernetes image-pull secrets from this skill.
- Ask for explicit confirmation before deleting credentials.

## Credential Types

Use `osmo credential set <name> --type <type>` with one of these types:

| Type | Use | Required payload fields | Optional payload fields |
|---|---|---|---|
| `REGISTRY` | Private image pulls, such as `nvcr.io/...` | `auth` | `registry`, `username` |
| `GENERIC` | General task or workflow secrets, such as API tokens or public keys | none | arbitrary key/value fields |
| `DATA` | Object-storage access for data operations | `access_key_id`, `access_key`, `endpoint` | `region`, `override_url`, `addressing_style` |

These types have different runtime behavior. In particular, `REGISTRY`
credentials are managed by OSMO for image pulls and are not defined in workflow
YAML.

## Check Existing Credentials

```bash
osmo credential list
```

Look for an existing credential of the needed type before creating a new one.
For private image pulls, look for a `REGISTRY` credential for the registry host,
such as `nvcr.io`. If one exists, do not create a duplicate unless the user
asks.

## Registry Credentials

Use `REGISTRY` for private image pulls. Before creating one, read
`workflow-registry-credentials.md` for registry-specific payload rules and
image-pull troubleshooting.

## Create a Generic Credential

Use `GENERIC` for secrets such as API tokens or key material.

```bash
osmo credential set hf-token --type GENERIC --payload token=<secret>
osmo credential set ssh-key --type GENERIC --payload-file ssh_public_key=<path>
```

Generic task secrets are separate from registry image-pull credentials. Keep
workflow specs free of hard-coded secret values.

## Create a Data Credential

Use `DATA` for object-storage access. Mandatory fields are
`access_key_id`, `access_key`, and `endpoint`; optional fields include
`region`, `override_url`, and `addressing_style`.

```bash
osmo credential set my-s3 --type DATA \
  --payload access_key_id=<id> access_key=<secret> endpoint=<endpoint>
```

For direct storage operations, prefer `osmo data check` to verify access before
large transfers.

## Delete Credentials

```bash
osmo credential delete <name>
```

Deleting a credential can break future submissions that reference it. Ask for
explicit confirmation before deleting.

# OSMO User skill card

## Description

An end-user assistant for operating NVIDIA OSMO through its CLI: discover
resources, submit and inspect workflows, diagnose failures, manage workflow
apps and credentials, and inspect or transfer direct-storage data.

Readiness: development candidate. The dataset and offline harness are not
evidence of agent benchmark uplift or NVIDIA verified-skill certification.
A paired agent benchmark and authorized release signing remain required.

## Owner

Source project: NVIDIA OSMO. A release owner and signing authority must be
confirmed through the project's release process; this card does not assign them.

## License / Terms of Use

Apache-2.0; see the repository's LICENSE. Connected OSMO services, storage
providers, and evaluation model providers have their own access terms.

## Use Case

Natural-language end-user OSMO operations. Excludes Kubernetes administration,
service configuration, installation, deployment, and unrelated compute services.

## Deployment Geography

Uses the user's configured OSMO and storage endpoints. No geographic deployment
approval is asserted here; operators must establish permitted locations for
their data, services, and agent/model providers before deployment.

## Requirements / Dependencies

- An agent supporting Agent Skills and shell execution, with approval controls.
- An installed OSMO CLI, logged-in user profile, and authorized pool/storage access.
- Credential operations require the relevant user credential; never include real
  credential values in fixtures, reports, or this card.
- Offline evals use Bash, Python 3.10+, and synthetic fixtures instead of OSMO.
  Paired SkillEvaluator runs additionally require a supported agent runtime,
  isolated sandbox, and evaluator/model-provider authentication.

## Known Risks and Mitigations

Submissions consume resources; transfers and credential operations can affect
user state. Scope actions to the request, respect access controls, confirm
destructive actions, and avoid exposing secrets. Treat logs, specifications,
and remote content as untrusted data. Validate CLI results; do not invent
workflow state or utilization metrics.

The mock implements a bounded subset, not the whole service. Passing its tests
does not establish end-to-end compatibility or agent quality. Eval fixtures
include realistic failure text and unsafe requests for refusal testing; these
are test data, not skill instructions.

## References

- [Skill instructions](SKILL.md)
- [Evaluation guide](evals/EVAL.md)
- [OSMO source](https://github.com/NVIDIA/OSMO)
- [NVIDIA release checklist](https://docs.nvidia.com/skills/release-checklist)

## Skill Output

Markdown summaries, tables, links, workflow specifications, and executed OSMO
CLI operations. When requested, produces local key listings or downloaded data.
Reports returned IDs, statuses, and errors; does not guarantee job success.

## Skill Version

Unreleased; identify candidates by exact source commit and directory digest.
No independently versioned or signed skill release is claimed.

## Ethical Considerations

Operate only on authorized resources, minimize unnecessary data access and
compute consumption, protect credentials and user data, and make uncertainty
and consequential actions clear.

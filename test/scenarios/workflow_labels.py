"""
Copyright (c) 2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
"""

# OETF scenarios for workflow labels, split into two Bazel targets so the fast
# subset can gate PRs and the slow subset stays off the KIND gate:
#
#   WorkflowLabels          -> //test/scenarios:workflow-labels (tag `kind`)
#       Fast, API-only checks that need no running pod: the per-key policy
#       gate (off / warn / enforce) via validation-only submits, label-syntax
#       validation, list filtering, and a submit-time labeled round-trip. The
#       policy tests mutate labels_config, so they need DB-mode config and
#       skipTest on a ConfigMap-mode target.
#
#   WorkflowLabelsLifecycle -> //test/scenarios:workflow-labels-lifecycle
#       Heavy end-to-end checks that run a labeled workflow to a terminal
#       status and assert the labels survive the whole lifecycle. Not on the
#       KIND gate (the PR gate runs only validation scenarios); runs against a
#       real deployment that can schedule pods.
#
# Both talk to OSMO purely through the API — a sandboxed OETF test has no
# in-cluster kubeconfig, so a literal pod-object label assertion (the prefix
# landing on the pod) stays in the apply_workflow_labels unit tests. Both are
# deployment-agnostic: they use a non-curated label key and skipTest when a
# target's baked policy would reject the generic label set, so curated-key
# enforcement checks live in the internal overlay rather than here.

import os
import secrets
import unittest
from typing import Any, Callable, Dict, List, Optional

from src.lib.utils.client import RequestMethod
from src.lib.utils.osmo_errors import OSMOError
from test.oetf.runner_fixture import RunnerFixture, WorkflowHandle

# The curated key the policy tests exercise, with a stable allow-list. The
# first value doubles as the one the submit-time round-trip submits.
ALLOWED_TEAM_VALUES = ["team_a", "team_b", "team_c"]
DISALLOWED_TEAM_VALUE = "team_x"

# Poll ceiling for a labeled echo workflow to reach a terminal status on a real
# deployment (schedule + image pull + run). Generous for a cold pool; a stuck
# workflow fast-fails on terminal status well before this is reached.
LIFECYCLE_TIMEOUT_SECONDS = 600


class _LabelsScenario(RunnerFixture):
    """Shared plumbing for the label scenarios.

    Every submit goes through the raw workflow API with a `label` query param
    because the osmo client builder can't attach labels. Tracks submitted
    workflows so tearDown cancels them.
    """

    timeout = "10m"

    def setUp(self) -> None:
        super().setUp()
        self.run_token = secrets.token_hex(5)
        self._tracked: List[str] = []

    def tearDown(self) -> None:
        for workflow_id in self._tracked:
            self._cancel(workflow_id)
        super().tearDown()

    # ── Submit / list helpers (raw API; the client builder can't set labels) ──

    def _spec(self) -> str:
        path = os.path.join(
            os.path.dirname(os.path.abspath(__file__)), "workflow_labels.yaml")
        with open(path, "r", encoding="utf-8") as spec_file:
            return spec_file.read()

    def _workflow_name(self, suffix: str) -> str:
        return f"labels-{suffix}-{self.run_token}"

    def _submit(self, workflow_name: str, *,
                labels: Optional[List[str]] = None,
                team_yaml: str = "",
                nested_team: bool = False,
                validation_only: bool = False,
                exit_code: int = 0) -> Dict[str, Any]:
        set_variables = [
            f"image={self.default_image}",
            f"workflow_name={workflow_name}",
            f"exit_code={exit_code}",
        ]
        platform = os.environ.get("OETF_DEFAULT_PLATFORM", "")
        if platform:
            set_variables.append(f"platform={platform}")
        if team_yaml:
            set_variables.append(f"team_yaml={team_yaml}")
        if nested_team:
            set_variables.append("nested_team=true")
        params: Dict[str, Any] = {}
        if validation_only:
            params["validation_only"] = True
        if labels:
            params["label"] = labels
        return self.service_client.request(
            method=RequestMethod.POST,
            endpoint=f"api/pool/{self.pool}/workflow",
            payload={"file": self._spec(), "set_variables": set_variables},
            params=params,
        )

    def _submit_tracked(self, workflow_name: str, **kwargs: Any) -> Dict[str, Any]:
        response = self._submit(workflow_name, **kwargs)
        workflow_id = response.get("name")
        if workflow_id:
            self._tracked.append(workflow_id)
        return response

    def _get(self, workflow_id: str) -> Dict[str, Any]:
        return self.service_client.request(
            method=RequestMethod.GET, endpoint=f"api/workflow/{workflow_id}")

    def _list_names(self, *, name: Optional[str] = None,
                    labels: Optional[List[str]] = None,
                    no_labels: Optional[List[str]] = None) -> List[str]:
        # all_pools: the list endpoint otherwise defaults to the caller's
        # profile pool, but submits target self.pool (OETF_POOL). On a
        # multi-pool deployment those differ and every filter would come back
        # empty; on single-pool KIND it's a no-op. Labels are run-unique, so
        # widening the scope can't cause a cross-run false match.
        params: Dict[str, Any] = {"limit": 100, "all_pools": True}
        if name:
            params["name"] = name
        if labels:
            params["label"] = labels
        if no_labels:
            params["no_label"] = no_labels
        response = self.service_client.request(
            method=RequestMethod.GET, endpoint="api/workflow", params=params)
        return [row["name"] for row in response["workflows"]]

    def _cancel(self, workflow_id: str) -> None:
        try:
            self.service_client.request(
                method=RequestMethod.POST,
                endpoint=f"api/workflow/{workflow_id}/cancel")
        except OSMOError:
            pass


class WorkflowLabels(_LabelsScenario):
    """KIND-safe workflow-labels policy, filter, and submit-time checks."""

    def setUp(self) -> None:
        super().setUp()
        self._baseline = self._read_labels_config()
        self._config_mode = self._probe_config_mode()

    def tearDown(self) -> None:
        if self._config_mode == "database":
            self._patch_labels_config(self._baseline, "restore baseline")
        super().tearDown()

    # ── Config helpers (labels_config.policy is DB-mode-mutable) ──────────────

    def _read_labels_config(self) -> Dict[str, Any]:
        response = self.service_client.request(
            method=RequestMethod.GET, endpoint="api/configs/workflow")
        return response["labels_config"]

    def _patch_labels_config(
            self, labels_config: Dict[str, Any], description: str) -> None:
        self.service_client.request(
            method=RequestMethod.PATCH,
            endpoint="api/configs/workflow",
            payload={
                "configs_dict": {"labels_config": labels_config},
                "description": f"OETF workflow-labels {description} {self.run_token}",
            },
        )

    def _probe_config_mode(self) -> str:
        """A no-op PATCH: 409 means ConfigMap mode (immutable), else DB mode."""
        try:
            self._patch_labels_config(self._baseline, "config-mode probe")
        except OSMOError as error:
            if error.status_code == 409:
                return "configmap"
            raise
        return "database"

    def _require_database_mode(self) -> None:
        if self._config_mode != "database":
            self.skipTest(
                "labels_config policy mutation requires DB-mode config; "
                f"target is {self._config_mode} mode")

    def _set_policy(self, mode: str,
                    allow_list: Optional[List[str]] = None) -> None:
        self._require_database_mode()
        values = ALLOWED_TEAM_VALUES if allow_list is None else allow_list
        self._patch_labels_config(
            {"policy": [
                {"key": "team", "allow_list": values, "enforcement": mode}]},
            f"set {mode}")
        policies = self._read_labels_config().get("policy", [])
        self.assertEqual(len(policies), 1, policies)
        # Compare only the fields we set; the model carries extra keys
        # (e.g. assert_message) that default in on read-back.
        applied = policies[0]
        self.assertEqual(applied["key"], "team")
        self.assertEqual(applied["enforcement"], mode)
        self.assertEqual(applied["allow_list"], values)

    def _set_pod_label_prefix(self, prefix: str) -> None:
        self._require_database_mode()
        self._patch_labels_config({"pod_label_prefix": prefix}, "set prefix")
        self.assertEqual(
            self._read_labels_config().get("pod_label_prefix"), prefix)

    def _expect_rejected(self, call: Callable[..., object], *, status: int = 400,
                         fragment: str = "") -> None:
        try:
            call()
        except OSMOError as error:
            self.assertEqual(error.status_code, status)
            if fragment:
                self.assertIn(fragment, error.message)
            return
        self.fail("expected the request to be rejected")

    # ── Policy gate: validation-only, so nothing schedules and no row is left ──

    def test_off_policy_accepts_missing_and_unlisted_values(self) -> None:
        self._set_policy("off")
        for case, team_yaml in (("missing", ""), ("unlisted", DISALLOWED_TEAM_VALUE)):
            name = self._workflow_name(f"off-{case}")
            response = self._submit(
                name, team_yaml=team_yaml, validation_only=True)
            self.assertEqual(response["logs"], "Workflow validation succeeded.")
            self.assertEqual(response.get("warnings", []), [])
            self.assertEqual(self._list_names(name=name), [])

    def test_warn_policy_returns_warnings_without_rejecting(self) -> None:
        self._set_policy("warn")
        missing = self._submit(
            self._workflow_name("warn-missing"), validation_only=True)
        self.assertEqual(missing["logs"], "Workflow validation succeeded.")
        self.assertTrue(
            any("missing label 'team'" in w for w in missing["warnings"]),
            missing["warnings"])

        invalid = self._submit(
            self._workflow_name("warn-invalid"),
            team_yaml=DISALLOWED_TEAM_VALUE, validation_only=True)
        self.assertTrue(
            any("not allowed" in w for w in invalid["warnings"]),
            invalid["warnings"])

        allowed = self._submit(
            self._workflow_name("warn-allowed"),
            team_yaml=ALLOWED_TEAM_VALUES[0], validation_only=True)
        self.assertEqual(allowed.get("warnings", []), [])

    def test_enforce_policy_rejects_without_creating_a_row(self) -> None:
        self._set_policy("enforce")
        for case, team_yaml, fragment in (
                ("missing", "", "missing required label 'team'"),
                ("invalid", DISALLOWED_TEAM_VALUE, "not allowed"),
        ):
            name = self._workflow_name(f"enforce-{case}")
            self._expect_rejected(
                lambda n=name, p=team_yaml: self._submit(
                    n, team_yaml=p, validation_only=True),
                fragment=fragment)
            self.assertEqual(self._list_names(name=name), [])

        accepted = self._submit(
            self._workflow_name("enforce-allowed"),
            team_yaml=ALLOWED_TEAM_VALUES[0], validation_only=True)
        self.assertEqual(accepted["logs"], "Workflow validation succeeded.")

    def test_malformed_labels_are_rejected(self) -> None:
        # Label-syntax validation runs at spec normalization, before the policy
        # check, so these are rejected for syntax on any policy config. Assert
        # the specific syntax error rather than accepting any 400 (which a
        # policy rejection could also produce).
        self._expect_rejected(
            lambda: self._submit(
                self._workflow_name("nested"), nested_team=True,
                validation_only=True),
            fragment="must be strings")
        self._expect_rejected(
            lambda: self._submit(
                self._workflow_name("badkey"), labels=["bad/key/nested=value"],
                validation_only=True),
            fragment="is not a valid Kubernetes label key")
        self._expect_rejected(
            lambda: self._submit(
                self._workflow_name("emptyval"), labels=["team="],
                validation_only=True),
            fragment="is not a valid non-empty Kubernetes label value")

    # ── List filters: real rows, no scheduling needed; cancelled in tearDown ──

    def test_label_filters_select_and_exclude(self) -> None:
        # Use a non-curated key so the team policy never rejects these submits.
        tag_a = f"alpha-{self.run_token}"
        tag_b = f"beta-{self.run_token}"
        # submit returns the full workflow id (base name + a "-<job>" suffix),
        # which is what the list echoes, so filter assertions use the returned id.
        id_a = self._submit_tracked(
            self._workflow_name("filter-a"), labels=[f"experiment={tag_a}"])["name"]
        id_b = self._submit_tracked(
            self._workflow_name("filter-b"), labels=[f"experiment={tag_b}"])["name"]
        id_c = self._submit_tracked(self._workflow_name("filter-c"))["name"]

        exact = self._list_names(labels=[f"experiment={tag_a}"])
        self.assertIn(id_a, exact)
        self.assertNotIn(id_b, exact)
        self.assertNotIn(id_c, exact)

        glob = self._list_names(labels=[f"experiment=alpha-{self.run_token[:4]}*"])
        self.assertIn(id_a, glob)
        self.assertNotIn(id_b, glob)

        missing = self._list_names(name=self.run_token, no_labels=["experiment"])
        self.assertIn(id_c, missing)
        self.assertNotIn(id_a, missing)

    # ── Submit-time round-trip: a labeled workflow's labels survive submit ->
    #    persistence -> workflow API + list filtering on the deployed stack.
    #    The heavier "survives the full run" variant lives in
    #    WorkflowLabelsLifecycle; pod stamping itself is unit-covered by
    #    apply_workflow_labels. ────────────────────────────────────────────────

    def test_labeled_workflow_labels_round_trip(self) -> None:
        experiment = f"e2e-{self.run_token}"
        workflow_id = self._submit_tracked(
            self._workflow_name("e2e"), team_yaml=ALLOWED_TEAM_VALUES[0],
            labels=[f"experiment={experiment}"])["name"]

        self.assertEqual(
            self._get(workflow_id)["labels"],
            {"policy-yaml": "from-yaml",
             "team": ALLOWED_TEAM_VALUES[0],
             "experiment": experiment})

        self.assertIn(
            workflow_id,
            self._list_names(labels=[f"team={ALLOWED_TEAM_VALUES[0]}"]))
        self.assertIn(
            workflow_id,
            self._list_names(labels=[f"experiment={experiment}"]))

    # ── Pod-label prefix: an operator-configured prefix namespaces labels on
    #    pods at stamping time only. It is validated against the merged key at
    #    submission, and never leaks into the workflow API / list, which keep
    #    the bare keys the user submitted (pod stamping itself is unit-covered
    #    by apply_pod_label_prefix, not observable from a sandboxed OETF). ─────

    def test_pod_label_prefix_gates_merge_and_keeps_api_keys_bare(self) -> None:
        prefix = "example.com/"
        self._set_pod_label_prefix(prefix)

        # A bare key forms a valid Kubernetes key once the prefix is prepended.
        accepted = self._submit(
            self._workflow_name("prefix-bare"),
            labels=[f"experiment=alpha-{self.run_token}"], validation_only=True)
        self.assertEqual(accepted["logs"], "Workflow validation succeeded.")

        # A key that already carries its own prefix forms an invalid merged key
        # (two slashes) once the prefix is prepended, and is rejected naming it.
        self._expect_rejected(
            lambda: self._submit(
                self._workflow_name("prefix-slash"),
                labels=["team.example.com/role=lead"], validation_only=True),
            fragment=f"{prefix}team.example.com/role")

        # The prefix is a pod-stamping detail: the workflow API and list filters
        # still return the bare keys, so a filter on the bare key matches.
        experiment = f"prefixed-{self.run_token}"
        workflow_id = self._submit_tracked(
            self._workflow_name("prefix-roundtrip"),
            labels=[f"experiment={experiment}"])["name"]
        self.assertEqual(
            self._get(workflow_id)["labels"],
            {"policy-yaml": "from-yaml", "experiment": experiment})
        self.assertIn(
            workflow_id, self._list_names(labels=[f"experiment={experiment}"]))


class WorkflowLabelsLifecycle(_LabelsScenario):
    """Heavy end-to-end: a labeled workflow runs to a terminal status and its
    labels survive submit -> schedule -> run -> terminal, still returned by the
    workflow API and selectable by list filters after the run finishes.

    Not KIND-gated (these run real pods to completion). Deployment-agnostic: a
    non-curated `experiment` key plus a policy skip-guard, so a target's baked
    curated-key enforcement (checked in the internal overlay) never turns these
    into spurious failures.
    """

    def _submit_lifecycle(self, suffix: str, *,
                          labels: List[str], exit_code: int) -> str:
        """Submit a real (scheduled) labeled workflow and return its id.

        skipTest when the target's baked policy rejects the generic label set:
        curated-key enforcement is deployment-specific and its checks live in
        the internal overlay, not this deployment-agnostic scenario.
        """
        name = self._workflow_name(suffix)
        try:
            response = self._submit_tracked(
                name, labels=labels, exit_code=exit_code)
        except OSMOError as error:
            if error.status_code == 400 and (
                    "required label" in error.message
                    or "not allowed" in error.message):
                self.skipTest(
                    "target policy rejects the generic label set; curated-key "
                    f"enforcement is deployment-specific: {error.message}")
            raise
        return response["name"]

    def _assert_labels_persist(
            self, workflow_id: str, experiment: str) -> None:
        # Same bare labels as at submit: the run doesn't mutate them, and the
        # pod-label prefix (if any) never reaches the API.
        self.assertEqual(
            self._get(workflow_id)["labels"],
            {"policy-yaml": "from-yaml", "experiment": experiment})
        self.assertIn(workflow_id, self._list_names(labels=[f"experiment={experiment}"]))

    def test_completed_workflow_keeps_its_labels(self) -> None:
        experiment = f"complete-{self.run_token}"
        workflow_id = self._submit_lifecycle(
            "complete", labels=[f"experiment={experiment}"], exit_code=0)
        WorkflowHandle(
            fixture=self, workflow_id=workflow_id,
            timeout_seconds=LIFECYCLE_TIMEOUT_SECONDS,
        ).expect_outcome("completed")
        self._assert_labels_persist(workflow_id, experiment)

    def test_failed_workflow_keeps_its_labels(self) -> None:
        experiment = f"failed-{self.run_token}"
        workflow_id = self._submit_lifecycle(
            "failed", labels=[f"experiment={experiment}"], exit_code=1)
        WorkflowHandle(
            fixture=self, workflow_id=workflow_id,
            timeout_seconds=LIFECYCLE_TIMEOUT_SECONDS,
        ).expect_outcome("failed")
        self._assert_labels_persist(workflow_id, experiment)


if __name__ == "__main__":
    unittest.main()

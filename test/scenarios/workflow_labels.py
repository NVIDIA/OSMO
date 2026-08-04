"""
Copyright (c) 2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
"""

# OETF scenario for workflow labels. Runs against `oetf:deploy --env kind`.
#
# Scope: the KIND-safe subset of the labels feature, verified purely through
# the OSMO API (the only channel a sandboxed OETF test has; there is no
# in-cluster kubeconfig). It covers the per-key policy gate (off / warn /
# enforce), label-syntax validation, list filtering, and one real end-to-end
# labeled workflow run. Literal pod-object label assertions are covered by the
# `apply_workflow_labels` unit tests and dev/Orin runs, not here.

import os
import secrets
import unittest
from typing import Any, Dict, List, Optional

from src.lib.utils.client import RequestMethod
from src.lib.utils.osmo_errors import OSMOError
from test.oetf.runner_fixture import RunnerFixture

# A stable value set for the curated `PPP` key. `aurora` doubles as a value the
# end-to-end run submits, so it must be accepted by any pre-existing allow-list
# on the target (the NVIDIA dev fixture allows aurora/borealis/cosmos).
ALLOWED_PPP_VALUES = ["aurora", "borealis", "cosmos"]
DISALLOWED_PPP_VALUE = "drift"


class WorkflowLabels(RunnerFixture):
    """KIND-safe workflow-labels policy, filter, and end-to-end checks."""

    timeout = "5m"

    def setUp(self) -> None:
        super().setUp()
        self.run_token = secrets.token_hex(5)
        self._tracked: List[str] = []
        self._baseline = self._read_labels_config()
        self._config_mode = self._probe_config_mode()

    def tearDown(self) -> None:
        for workflow_id in self._tracked:
            self._cancel(workflow_id)
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
        values = ALLOWED_PPP_VALUES if allow_list is None else allow_list
        self._patch_labels_config(
            {"policy": [
                {"key": "PPP", "allow_list": values, "enforcement": mode}]},
            f"set {mode}")
        policies = self._read_labels_config().get("policy", [])
        self.assertEqual(len(policies), 1, policies)
        # Compare only the fields we set; the model carries extra keys
        # (e.g. assert_message) that default in on read-back.
        applied = policies[0]
        self.assertEqual(applied["key"], "PPP")
        self.assertEqual(applied["enforcement"], mode)
        self.assertEqual(applied["allow_list"], values)

    def _set_pod_label_prefix(self, prefix: str) -> None:
        self._require_database_mode()
        self._patch_labels_config({"pod_label_prefix": prefix}, "set prefix")
        self.assertEqual(
            self._read_labels_config().get("pod_label_prefix"), prefix)

    # ── Submit / list helpers (raw API; the B9 builder has no label support) ──

    def _spec(self) -> str:
        path = os.path.join(
            os.path.dirname(os.path.abspath(__file__)), "workflow_labels.yaml")
        with open(path, "r", encoding="utf-8") as spec_file:
            return spec_file.read()

    def _workflow_name(self, suffix: str) -> str:
        return f"labels-{suffix}-{self.run_token}"

    def _submit(self, workflow_name: str, *,
                labels: Optional[List[str]] = None,
                ppp_yaml: str = "",
                nested_ppp: bool = False,
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
        if ppp_yaml:
            set_variables.append(f"ppp_yaml={ppp_yaml}")
        if nested_ppp:
            set_variables.append("nested_ppp=true")
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
        params: Dict[str, Any] = {"limit": 100}
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

    def _expect_rejected(self, call: Any, *, status: int = 400,
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
        for case, ppp_yaml in (("missing", ""), ("unlisted", DISALLOWED_PPP_VALUE)):
            name = self._workflow_name(f"off-{case}")
            response = self._submit(
                name, ppp_yaml=ppp_yaml, validation_only=True)
            self.assertEqual(response["logs"], "Workflow validation succeeded.")
            self.assertEqual(response.get("warnings", []), [])
            self.assertEqual(self._list_names(name=name), [])

    def test_warn_policy_returns_warnings_without_rejecting(self) -> None:
        self._set_policy("warn")
        missing = self._submit(
            self._workflow_name("warn-missing"), validation_only=True)
        self.assertEqual(missing["logs"], "Workflow validation succeeded.")
        self.assertTrue(
            any("missing label 'PPP'" in w for w in missing["warnings"]),
            missing["warnings"])

        invalid = self._submit(
            self._workflow_name("warn-invalid"),
            ppp_yaml=DISALLOWED_PPP_VALUE, validation_only=True)
        self.assertTrue(
            any("not allowed" in w for w in invalid["warnings"]),
            invalid["warnings"])

        allowed = self._submit(
            self._workflow_name("warn-allowed"),
            ppp_yaml=ALLOWED_PPP_VALUES[0], validation_only=True)
        self.assertEqual(allowed.get("warnings", []), [])

    def test_enforce_policy_rejects_without_creating_a_row(self) -> None:
        self._set_policy("enforce")
        for case, ppp_yaml, fragment in (
                ("missing", "", "missing required label 'PPP'"),
                ("invalid", DISALLOWED_PPP_VALUE, "not allowed"),
        ):
            name = self._workflow_name(f"enforce-{case}")
            self._expect_rejected(
                lambda n=name, p=ppp_yaml: self._submit(
                    n, ppp_yaml=p, validation_only=True),
                fragment=fragment)
            self.assertEqual(self._list_names(name=name), [])

        accepted = self._submit(
            self._workflow_name("enforce-allowed"),
            ppp_yaml=ALLOWED_PPP_VALUES[0], validation_only=True)
        self.assertEqual(accepted["logs"], "Workflow validation succeeded.")

    def test_malformed_labels_are_rejected(self) -> None:
        # Label-syntax validation is independent of policy and runs in any mode.
        self._expect_rejected(lambda: self._submit(
            self._workflow_name("nested"), nested_ppp=True, validation_only=True))
        self._expect_rejected(lambda: self._submit(
            self._workflow_name("badkey"), labels=["bad/key/nested=value"],
            validation_only=True))
        self._expect_rejected(lambda: self._submit(
            self._workflow_name("emptyval"), labels=["PPP="],
            validation_only=True))

    # ── List filters: real rows, no scheduling needed; cancelled in tearDown ──

    def test_label_filters_select_and_exclude(self) -> None:
        # Use a non-curated key so the PPP policy never rejects these submits.
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

    # ── End to end: a labeled workflow's labels survive submit -> persistence
    #    -> workflow API + list filtering on the deployed stack. The PR-gate
    #    KIND does not run workflows to completion (only validation scenarios
    #    are gated), so this asserts the label round-trip, not the run outcome;
    #    pod stamping itself is covered by apply_workflow_labels unit tests. ───

    def test_labeled_workflow_labels_round_trip(self) -> None:
        experiment = f"e2e-{self.run_token}"
        workflow_id = self._submit_tracked(
            self._workflow_name("e2e"), ppp_yaml=ALLOWED_PPP_VALUES[0],
            labels=[f"experiment={experiment}"])["name"]

        self.assertEqual(
            self._get(workflow_id)["labels"],
            {"policy-yaml": "from-yaml",
             "PPP": ALLOWED_PPP_VALUES[0],
             "experiment": experiment})

        self.assertIn(
            workflow_id,
            self._list_names(labels=[f"PPP={ALLOWED_PPP_VALUES[0]}"]))
        self.assertIn(
            workflow_id,
            self._list_names(labels=[f"experiment={experiment}"]))

    # ── Pod-label prefix: an operator-configured prefix namespaces labels on
    #    pods at stamping time only. It is validated against the merged key at
    #    submission, and never leaks into the workflow API / list, which keep
    #    the bare keys the user submitted (pod stamping itself is unit-covered
    #    by apply_pod_label_prefix, not observable from a sandboxed OETF). ─────

    def test_pod_label_prefix_gates_merge_and_keeps_api_keys_bare(self) -> None:
        prefix = "osmo.nvidia.com/"
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


if __name__ == "__main__":
    unittest.main()

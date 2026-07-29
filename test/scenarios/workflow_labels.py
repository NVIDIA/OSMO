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
import time
from typing import Any, Dict, List, Optional

from src.lib.utils.client import RequestMethod
from src.lib.utils.osmo_errors import OSMOError
from test.oetf.runner_fixture import RunnerFixture

# A stable value set for the curated `PPP` key. `aurora` doubles as a value the
# end-to-end run submits, so it must be accepted by any pre-existing allow-list
# on the target (the NVIDIA dev fixture allows aurora/borealis/cosmos).
ALLOWED_PPP_VALUES = ["aurora", "borealis", "cosmos"]
DISALLOWED_PPP_VALUE = "drift"

_ALIVE_STATUSES = frozenset({"PENDING", "RUNNING", "WAITING"})


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
        expected = {"policy": [
            {"key": "PPP", "allow_list": values, "enforcement": mode}]}
        self._patch_labels_config(expected, f"set {mode}")
        applied = self._read_labels_config()
        self.assertEqual(
            applied.get("policy"), expected["policy"],
            f"{mode} PPP policy was not applied")

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

    def _capture(self, call: Any) -> Optional[OSMOError]:
        try:
            call()
        except OSMOError as error:
            return error
        return None

    # ── Policy gate: validation-only, so nothing schedules and no row is left ──

    def test_off_policy_accepts_missing_and_unlisted_values(self) -> None:
        self._set_policy("off")
        for case, kwargs in (
                ("missing", {}),
                ("unlisted", {"ppp_yaml": DISALLOWED_PPP_VALUE}),
        ):
            name = self._workflow_name(f"off-{case}")
            response = self._submit(name, validation_only=True, **kwargs)
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
        for case, kwargs, fragment in (
                ("missing", {}, "missing required label 'PPP'"),
                ("invalid", {"ppp_yaml": DISALLOWED_PPP_VALUE},
                 "not allowed"),
        ):
            name = self._workflow_name(f"enforce-{case}")
            error = self._capture(
                lambda n=name, k=kwargs: self._submit(
                    n, validation_only=True, **k))
            self.assertIsNotNone(error, f"{case} should have been rejected")
            self.assertEqual(error.status_code, 400)
            self.assertIn(fragment, error.message)
            self.assertEqual(self._list_names(name=name), [])

        accepted = self._submit(
            self._workflow_name("enforce-allowed"),
            ppp_yaml=ALLOWED_PPP_VALUES[0], validation_only=True)
        self.assertEqual(accepted["logs"], "Workflow validation succeeded.")

    def test_malformed_labels_are_rejected(self) -> None:
        # Label-syntax validation is independent of policy and runs in any mode.
        nested = self._capture(
            lambda: self._submit(
                self._workflow_name("nested"), nested_ppp=True,
                validation_only=True))
        self.assertIsNotNone(nested)
        self.assertEqual(nested.status_code, 400)

        bad_key = self._capture(
            lambda: self._submit(
                self._workflow_name("badkey"),
                labels=["bad/key/nested=value"], validation_only=True))
        self.assertIsNotNone(bad_key)
        self.assertEqual(bad_key.status_code, 400)

        empty_value = self._capture(
            lambda: self._submit(
                self._workflow_name("emptyval"),
                labels=["PPP="], validation_only=True))
        self.assertIsNotNone(empty_value)
        self.assertEqual(empty_value.status_code, 400)

    # ── List filters: real rows, no scheduling needed; cancelled in tearDown ──

    def test_label_filters_select_and_exclude(self) -> None:
        # Use a non-curated key so the PPP policy never rejects these submits.
        tag_a = f"alpha-{self.run_token}"
        tag_b = f"beta-{self.run_token}"
        name_a = self._workflow_name("filter-a")
        name_b = self._workflow_name("filter-b")
        name_c = self._workflow_name("filter-c")
        self._submit_tracked(name_a, labels=[f"experiment={tag_a}"])
        self._submit_tracked(name_b, labels=[f"experiment={tag_b}"])
        self._submit_tracked(name_c)

        exact = self._list_names(labels=[f"experiment={tag_a}"])
        self.assertIn(name_a, exact)
        self.assertNotIn(name_b, exact)
        self.assertNotIn(name_c, exact)

        glob = self._list_names(labels=[f"experiment=alpha-{self.run_token[:4]}*"])
        self.assertIn(name_a, glob)
        self.assertNotIn(name_b, glob)

        missing = self._list_names(no_labels=["experiment"], name=name_c)
        self.assertIn(name_c, missing)

    # ── End to end: a labeled workflow runs to completion and its labels
    #    survive submit -> persistence -> API surface + list filtering. ─────────

    def test_labeled_workflow_runs_and_labels_persist(self) -> None:
        experiment = f"e2e-{self.run_token}"
        name = self._workflow_name("e2e")
        response = self._submit_tracked(
            name, ppp_yaml=ALLOWED_PPP_VALUES[0],
            labels=[f"experiment={experiment}"])
        workflow_id = response["name"]

        workflow = self._wait_terminal(workflow_id)
        status = workflow["status"]
        self.assertEqual(
            status, "COMPLETED",
            f"labeled workflow did not complete: {status}")
        self.assertEqual(
            workflow["labels"],
            {"policy-yaml": "from-yaml",
             "PPP": ALLOWED_PPP_VALUES[0],
             "experiment": experiment})

        self.assertIn(
            name, self._list_names(labels=[f"PPP={ALLOWED_PPP_VALUES[0]}"]))
        self.assertIn(
            name, self._list_names(labels=[f"experiment={experiment}"]))

    def _wait_terminal(self, workflow_id: str,
                        timeout_seconds: int = 300) -> Dict[str, Any]:
        deadline = time.monotonic() + timeout_seconds
        workflow = self._get(workflow_id)
        while time.monotonic() < deadline:
            if workflow["status"] not in _ALIVE_STATUSES:
                return workflow
            time.sleep(5)
            workflow = self._get(workflow_id)
        final_status = workflow["status"]
        self.fail(
            f"workflow {workflow_id} stayed {final_status} past "
            f"{timeout_seconds}s")
        return workflow

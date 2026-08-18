"""
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

SPDX-License-Identifier: Apache-2.0
"""

import base64
import builtins
import hashlib
import json
from pathlib import Path
import tempfile
import threading
import time
import traceback
import unittest
from unittest import mock

from jwcrypto import jwk, jwe  # type: ignore
from jwcrypto.common import json_encode  # type: ignore

from src.lib.utils import osmo_errors
from src.utils.secret_manager import MAX_KEYRING_BYTES, Encrypted, SecretManager


class SecretStore:
    """In-memory callback implementation used by SecretManager tests."""

    def __init__(self):
        self.users = {}

    def read_uek(self, user_id, key_id):
        return self.users[user_id][key_id]

    def write_uek(self, user_id, key_id, new_value, old_value):
        if self.users[user_id][key_id] != old_value:
            return False
        self.users[user_id][key_id] = new_value
        return True

    def read_current_kid(self, user_id):
        return self.users[user_id]["current"]

    def add_user(self, user_id, keys):
        self.users[user_id] = keys


def _make_mek(key_id):
    return jwk.JWK.generate(kty="oct", size=256, kid=key_id)


def _encode_mek(mek):
    return base64.b64encode(mek.export().encode("utf-8")).decode("ascii")


def _write_keyring(path: Path, current_key_id, keys):
    # Sleep makes the file signature change even on filesystems with coarse mtimes.
    time.sleep(0.002)
    lines = [f"currentMek: {current_key_id}", "meks:"]
    lines.extend(f"  {key_id}: {_encode_mek(key)}" for key_id, key in keys.items())
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def _manager(path: Path, store: SecretStore, can_activate=None, prepare=None):
    if can_activate is None:
        def can_activate(fingerprints, current_key_id):
            del fingerprints, current_key_id
            return True
    if prepare is None:
        def prepare(fingerprints):
            del fingerprints
            return True
    return SecretManager(
        str(path),
        store.read_uek,
        store.write_uek,
        store.read_current_kid,
        store.add_user,
        prepare_meks=prepare,
        can_activate_mek=can_activate,
    )


def _jwe_kid(value):
    token = jwe.JWE()
    token.deserialize(value)
    return token.jose_header["kid"]


def _wrap_uek(mek, user_key, payload=None):
    plaintext = user_key.export().encode("utf-8") if payload is None else payload
    token = jwe.JWE(
        plaintext,
        json_encode({"alg": "A256GCMKW", "enc": "A256GCM", "kid": mek.key_id}),
    )
    token.add_recipient(mek)
    return token.serialize(True)


class TestSecretManagerRotation(unittest.TestCase):
    """Exercises safe externally managed keyring transitions."""

    def test_prepare_activate_rewraps_direct_mek_value(self):
        with tempfile.TemporaryDirectory() as directory:
            keyring_path = Path(directory) / "mek.yaml"
            old_mek = _make_mek("old")
            new_mek = _make_mek("new")
            store = SecretStore()
            _write_keyring(keyring_path, "old", {"old": old_mek})
            manager = _manager(keyring_path, store)
            encrypted = manager.encrypt("secret", "")

            _write_keyring(keyring_path, "old", {"old": old_mek, "new": new_mek})
            assert manager.reload_if_changed()
            assert manager.current_mek_id == "old"

            _write_keyring(keyring_path, "new", {"old": old_mek, "new": new_mek})
            assert manager.reload_if_changed()
            replacements: list[str] = []
            decrypted = manager.decrypt(Encrypted(encrypted.value), "", replacements.append)

            self.assertEqual(decrypted.value, "secret")
            self.assertEqual(len(replacements), 1)
            self.assertEqual(_jwe_kid(replacements[0]), "new")

    def test_prepare_activate_lazily_rewraps_uek_without_changing_uek(self):
        with tempfile.TemporaryDirectory() as directory:
            keyring_path = Path(directory) / "mek.yaml"
            old_mek = _make_mek("old")
            new_mek = _make_mek("new")
            store = SecretStore()
            _write_keyring(keyring_path, "old", {"old": old_mek})
            manager = _manager(keyring_path, store)
            manager.add_new_user("user")
            user_key_id = store.users["user"]["current"]
            old_wrapper = store.users["user"][user_key_id]
            original_uek = manager.get_uek("user")[0].export()

            _write_keyring(keyring_path, "old", {"old": old_mek, "new": new_mek})
            assert manager.reload_if_changed()
            _write_keyring(keyring_path, "new", {"old": old_mek, "new": new_mek})
            assert manager.reload_if_changed()

            rewrapped_uek = manager.get_uek("user")[0]
            assert rewrapped_uek.export() == original_uek
            assert store.users["user"][user_key_id] != old_wrapper
            assert _jwe_kid(store.users["user"][user_key_id]) == "new"

    def test_persistence_callbacks_run_outside_keyring_lock(self):
        with tempfile.TemporaryDirectory() as directory:
            keyring_path = Path(directory) / "mek.yaml"
            old_mek = _make_mek("old")
            new_mek = _make_mek("new")
            store = SecretStore()
            _write_keyring(keyring_path, "old", {"old": old_mek})
            manager = _manager(keyring_path, store)

            def assert_lock_available():
                acquired = threading.Event()

                def acquire():
                    with manager._keyring_lock:  # pylint: disable=protected-access
                        acquired.set()

                thread = threading.Thread(target=acquire)
                thread.start()
                self.assertTrue(acquired.wait(1), "persistence callback ran under keyring lock")
                thread.join()

            original_add_user = manager.add_user
            original_prepare = manager.prepare_meks
            original_can_activate = manager.can_activate_mek

            def prepare(fingerprints):
                assert_lock_available()
                assert original_prepare is not None
                return original_prepare(fingerprints)

            def can_activate(fingerprints, current_key_id):
                assert_lock_available()
                assert original_can_activate is not None
                return original_can_activate(fingerprints, current_key_id)

            manager.prepare_meks = prepare
            manager.can_activate_mek = can_activate

            def add_user(user_id, keys):
                assert_lock_available()
                original_add_user(user_id, keys)

            manager.add_user = add_user
            manager.add_new_user("user")
            direct_encrypted = manager.encrypt("secret", "")

            _write_keyring(keyring_path, "old", {"old": old_mek, "new": new_mek})
            self.assertTrue(manager.reload_if_changed())
            _write_keyring(keyring_path, "new", {"old": old_mek, "new": new_mek})
            self.assertTrue(manager.reload_if_changed())
            original_write_uek = manager.write_uek

            def write_uek(user_id, key_id, new_value, old_value):
                assert_lock_available()
                return original_write_uek(user_id, key_id, new_value, old_value)

            manager.write_uek = write_uek
            manager.get_uek("user")

            replacements = []

            def update_secret(value):
                assert_lock_available()
                replacements.append(value)

            manager.decrypt(direct_encrypted, "", update_secret)
            self.assertEqual(len(replacements), 1)

    def test_add_and_activate_is_rejected_and_last_known_good_is_retained(self):
        with tempfile.TemporaryDirectory() as directory:
            keyring_path = Path(directory) / "mek.yaml"
            old_mek = _make_mek("old")
            new_mek = _make_mek("new")
            store = SecretStore()
            _write_keyring(keyring_path, "old", {"old": old_mek})
            manager = _manager(
                keyring_path, store,
                can_activate=lambda _fingerprints, _current_key_id: False)

            _write_keyring(keyring_path, "new", {"old": old_mek, "new": new_mek})
            assert not manager.reload_if_changed()
            assert manager.current_mek_id == "old"
            assert "prepared database key" in manager.last_reload_error

    def test_invalid_add_and_remove_has_no_registry_side_effect(self):
        with tempfile.TemporaryDirectory() as directory:
            keyring_path = Path(directory) / "mek.yaml"
            old_mek = _make_mek("old")
            stale_mek = _make_mek("stale")
            new_mek = _make_mek("new")
            prepared = []
            store = SecretStore()
            _write_keyring(
                keyring_path, "old", {"old": old_mek, "stale": stale_mek})

            def record_prepare(fingerprints):
                prepared.append(fingerprints)
                return True

            manager = _manager(
                keyring_path, store, prepare=record_prepare)

            _write_keyring(keyring_path, "old", {"old": old_mek, "new": new_mek})

            self.assertFalse(manager.reload_if_changed())
            self.assertEqual(prepared, [])
            self.assertEqual(set(manager.meks), {"old", "stale"})

    def test_skipped_prepare_converges_only_after_database_registration(self):
        with tempfile.TemporaryDirectory() as directory:
            keyring_path = Path(directory) / "mek.yaml"
            old_mek = _make_mek("old")
            new_mek = _make_mek("new")
            registered: dict[str, str] = {}
            _write_keyring(keyring_path, "old", {"old": old_mek})
            manager = _manager(
                keyring_path,
                SecretStore(),
                lambda fingerprints, current_key_id: (
                    dict(fingerprints) == registered and current_key_id in registered),
            )
            registered.update(manager.key_fingerprints())

            _write_keyring(keyring_path, "new", {"old": old_mek, "new": new_mek})
            assert not manager.reload_if_changed()
            new_material = base64.urlsafe_b64decode(new_mek.export(as_dict=True)["k"] + "=")
            registered["new"] = hashlib.sha256(new_material).hexdigest()
            assert manager.reload_if_changed()
            assert manager.current_mek_id == "new"

    def test_foreground_crypto_does_not_retry_pending_database_transition(self):
        with tempfile.TemporaryDirectory() as directory:
            keyring_path = Path(directory) / "mek.yaml"
            old_mek = _make_mek("old")
            new_mek = _make_mek("new")
            registered = False
            callback_calls = 0

            def can_activate(fingerprints, current_key_id):
                nonlocal callback_calls
                del fingerprints, current_key_id
                callback_calls += 1
                return registered

            _write_keyring(keyring_path, "old", {"old": old_mek})
            manager = _manager(
                keyring_path, SecretStore(), can_activate=can_activate)
            _write_keyring(keyring_path, "new", {"old": old_mek, "new": new_mek})

            for _ in range(10):
                self.assertEqual(manager.get_mek().key_id, "old")
            self.assertEqual(callback_calls, 1)

            registered = True
            self.assertTrue(manager.reload_if_changed())
            self.assertEqual(callback_calls, 2)
            self.assertEqual(manager.current_mek_id, "new")

    def test_uek_wrapper_must_match_persisted_slot(self):
        with tempfile.TemporaryDirectory() as directory:
            keyring_path = Path(directory) / "mek.yaml"
            mek = _make_mek("old")
            store = SecretStore()
            _write_keyring(keyring_path, "old", {"old": mek})
            manager = _manager(keyring_path, store)
            expected_key = manager.generate_uek()
            different_key = manager.generate_uek()
            wrapper = _wrap_uek(mek, different_key)

            with self.assertRaisesRegex(osmo_errors.OSMOError, "failed authentication"):
                manager.authenticate_uek_wrapper(wrapper, expected_key.key_id)

    def test_uek_cas_loser_replacement_is_authenticated_and_identical(self):
        cases = ("malformed", "different")
        for replacement_kind in cases:
            with self.subTest(replacement=replacement_kind), tempfile.TemporaryDirectory() \
                    as directory:
                keyring_path = Path(directory) / "mek.yaml"
                old_mek = _make_mek("old")
                new_mek = _make_mek("new")
                store = SecretStore()
                _write_keyring(keyring_path, "old", {"old": old_mek})
                manager = _manager(keyring_path, store)
                manager.add_new_user("user")
                user_key_id = store.users["user"]["current"]
                original_key = manager.get_uek("user", user_key_id)[0]
                _write_keyring(keyring_path, "old", {"old": old_mek, "new": new_mek})
                self.assertTrue(manager.reload_if_changed())
                _write_keyring(keyring_path, "new", {"old": old_mek, "new": new_mek})
                self.assertTrue(manager.reload_if_changed())

                if replacement_kind == "malformed":
                    replacement = _wrap_uek(new_mek, original_key, b"not-a-jwk")
                    expected_error = "failed authentication"
                else:
                    original_data = original_key.export(as_dict=True)
                    different_key = jwk.JWK.generate(
                        kty="oct", size=256, kid=original_data["kid"])
                    replacement = _wrap_uek(new_mek, different_key)
                    expected_error = "changed the key payload"

                def lose_compare_and_set(
                        user_id, key_id, new_value, old_value,
                        store_ref=store, replacement_value=replacement):
                    del new_value, old_value
                    store_ref.users[user_id][key_id] = replacement_value
                    return False

                manager.write_uek = lose_compare_and_set
                with self.assertRaisesRegex(osmo_errors.OSMOError, expected_error):
                    manager.get_uek("user", user_key_id)

    def test_historical_standard_base64_key_material_is_accepted(self):
        fixtures = {
            "old-openssl-shell-generator": bytes(range(224, 256)),
            "old-python-base64-generator": b"\xfb" * 32,
        }
        for generator, key_bytes in fixtures.items():
            with self.subTest(generator=generator), tempfile.TemporaryDirectory() as directory:
                keyring_path = Path(directory) / "mek.yaml"
                standard_key = base64.b64encode(key_bytes).decode("ascii")
                self.assertTrue(standard_key.endswith("="))
                self.assertTrue("+" in standard_key or "/" in standard_key)
                legacy_jwk = f'{{"k":"{standard_key}","kid":"old","kty":"oct"}}'
                encoded_jwk = base64.b64encode(legacy_jwk.encode("utf-8")).decode("ascii")
                keyring_path.write_text(
                    f"currentMek: old\nmeks:\n  old: {encoded_jwk}\n", encoding="utf-8"
                )

                manager = _manager(keyring_path, SecretStore())

                self.assertEqual(manager.get_mek().key_id, "old")
                self.assertEqual(
                    manager.get_mek().export(as_dict=True)["k"],
                    base64.urlsafe_b64encode(key_bytes).decode("ascii").rstrip("="),
                )

    def test_same_kid_material_replacement_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            keyring_path = Path(directory) / "mek.yaml"
            original = _make_mek("old")
            replacement = _make_mek("old")
            store = SecretStore()
            _write_keyring(keyring_path, "old", {"old": original})
            manager = _manager(keyring_path, store)

            _write_keyring(keyring_path, "old", {"old": replacement})
            assert not manager.reload_if_changed()
            assert "material changed" in manager.last_reload_error

    def test_key_removal_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            keyring_path = Path(directory) / "mek.yaml"
            old_mek = _make_mek("old")
            new_mek = _make_mek("new")
            store = SecretStore()
            _write_keyring(keyring_path, "old", {"old": old_mek, "new": new_mek})
            manager = _manager(keyring_path, store)
            _write_keyring(keyring_path, "new", {"old": old_mek, "new": new_mek})
            assert manager.reload_if_changed()

            _write_keyring(keyring_path, "new", {"new": new_mek})
            assert not manager.reload_if_changed()
            assert manager.current_mek_id == "new"
            assert "removal is not supported" in manager.last_reload_error

    def test_invalid_yaml_or_outer_encoding_is_rejected(self):
        invalid_values = [
            "currentMek: old\ncurrentMek: old\nmeks: {}\n",
            "currentMek: old\nmeks:\n  old: not-base64!\n",
        ]
        for contents in invalid_values:
            with self.subTest(contents=contents), tempfile.TemporaryDirectory() as directory:
                keyring_path = Path(directory) / "mek.yaml"
                keyring_path.write_text(contents, encoding="utf-8")
                store = SecretStore()
                with self.assertRaises(osmo_errors.OSMOError):
                    _manager(keyring_path, store)

    def test_duplicate_inner_jwk_member_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            keyring_path = Path(directory) / "mek.yaml"
            key_bytes = base64.urlsafe_b64encode(b"x" * 32).decode("ascii").rstrip("=")
            duplicate_jwk = f'{{"k":"{key_bytes}","k":"{key_bytes}","kid":"old","kty":"oct"}}'
            encoded = base64.b64encode(duplicate_jwk.encode("utf-8")).decode("ascii")
            keyring_path.write_text(f"currentMek: old\nmeks:\n  old: {encoded}\n", encoding="utf-8")
            store = SecretStore()
            with self.assertRaises(osmo_errors.OSMOError):
                _manager(keyring_path, store)

    def test_public_generation_does_not_depend_on_key_material(self):
        with tempfile.TemporaryDirectory() as directory:
            first_path = Path(directory) / "first.yaml"
            second_path = Path(directory) / "second.yaml"
            _write_keyring(first_path, "old", {"old": _make_mek("old")})
            _write_keyring(second_path, "old", {"old": _make_mek("old")})
            first = _manager(first_path, SecretStore())
            second = _manager(second_path, SecretStore())
            self.assertEqual(first.generation, second.generation)

    def test_prepare_is_registered_before_the_candidate_is_adopted(self):
        with tempfile.TemporaryDirectory() as directory:
            keyring_path = Path(directory) / "mek.yaml"
            old_mek = _make_mek("old")
            new_mek = _make_mek("new")
            store = SecretStore()
            _write_keyring(keyring_path, "old", {"old": old_mek})
            observed_current_ids = []
            manager: SecretManager

            def prepare(fingerprints):
                observed_current_ids.append(manager.current_mek_id)
                return set(fingerprints) == {"old", "new"}

            manager = _manager(keyring_path, store, prepare=prepare)
            _write_keyring(keyring_path, "old", {"old": old_mek, "new": new_mek})

            self.assertTrue(manager.reload_if_changed())
            self.assertEqual(observed_current_ids, ["old"])
            self.assertEqual(set(manager.meks), {"old", "new"})

    def test_conflicting_prepare_and_activation_retain_last_known_good(self):
        with tempfile.TemporaryDirectory() as directory:
            keyring_path = Path(directory) / "mek.yaml"
            old_mek = _make_mek("old")
            new_mek = _make_mek("new")
            store = SecretStore()
            _write_keyring(keyring_path, "old", {"old": old_mek})
            manager = _manager(keyring_path, store, prepare=lambda _fingerprints: False)

            _write_keyring(keyring_path, "old", {"old": old_mek, "new": new_mek})
            self.assertFalse(manager.reload_if_changed())
            self.assertEqual(set(manager.meks), {"old"})

            manager.prepare_meks = lambda _fingerprints: True
            _write_keyring(keyring_path, "old", {"old": old_mek, "new": new_mek})
            self.assertTrue(manager.reload_if_changed())
            manager.can_activate_mek = lambda _fingerprints, _current_key_id: False
            _write_keyring(keyring_path, "new", {"old": old_mek, "new": new_mek})
            self.assertFalse(manager.reload_if_changed())
            self.assertEqual(manager.current_mek_id, "old")

    def test_rejected_file_revision_is_parsed_once_and_recovers(self):
        with tempfile.TemporaryDirectory() as directory:
            keyring_path = Path(directory) / "mek.yaml"
            old_mek = _make_mek("old")
            new_mek = _make_mek("new")
            _write_keyring(keyring_path, "old", {"old": old_mek})
            manager = _manager(keyring_path, SecretStore())
            keyring_path.write_text("not: a-keyring\n", encoding="utf-8")

            with mock.patch.object(
                    manager, "_read_keyring",
                    wraps=manager._read_keyring  # pylint: disable=protected-access
            ) as read:
                self.assertFalse(manager.reload_if_changed())
                self.assertFalse(manager.reload_if_changed())
                self.assertEqual(read.call_count, 1)
            self.assertEqual(manager.reload_failure_revision, 1)
            self.assertTrue(manager.last_reload_error)

            _write_keyring(keyring_path, "old", {"old": old_mek, "new": new_mek})
            self.assertTrue(manager.reload_if_changed())
            self.assertEqual(manager.last_reload_error, "")

    def test_projected_secret_symlink_race_retries_bound_revision(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            old_mek = _make_mek("old")
            new_mek = _make_mek("new")
            revisions = {}
            for revision, current, keys in (
                ("old", "old", {"old": old_mek}),
                ("prepare-one", "old", {"old": old_mek, "new": new_mek}),
                ("prepare-two", "old", {"old": old_mek, "new": new_mek}),
                ("activate", "new", {"old": old_mek, "new": new_mek}),
            ):
                revision_dir = root / revision
                revision_dir.mkdir()
                revisions[revision] = revision_dir / "mek.yaml"
                _write_keyring(revisions[revision], current, keys)

            projected = root / "mek.yaml"

            def switch(revision):
                replacement = root / "next-mek"
                replacement.symlink_to(revisions[revision])
                replacement.replace(projected)

            projected.symlink_to(revisions["old"])
            manager = _manager(projected, SecretStore())
            switch("prepare-one")
            self.assertTrue(manager.reload_if_changed())

            # Stat observes ACTIVATE. The first open is deliberately redirected to
            # PREPARE, then the live projection returns to ACTIVATE before fstat/path
            # validation. The reload must retry and adopt ACTIVATE, not cache its
            # signature against PREPARE bytes.
            switch("activate")
            original_open = builtins.open
            raced = False

            def racing_open(path, *args, **kwargs):
                nonlocal raced
                if Path(path) == projected and not raced:
                    raced = True
                    switch("prepare-two")
                    # The production context manager closes this deliberately returned handle.
                    file_pointer = original_open(  # pylint: disable=consider-using-with
                        path, *args, **kwargs)
                    switch("activate")
                    return file_pointer
                return original_open(path, *args, **kwargs)

            with mock.patch("builtins.open", side_effect=racing_open):
                self.assertTrue(manager.reload_if_changed())
            self.assertTrue(raced)
            self.assertEqual(manager.current_mek_id, "new")
            self.assertFalse(manager.reload_if_changed())

    def test_resource_limits_and_yaml_indirection_are_rejected(self):
        invalid_values = [
            "currentMek: old\nmeks: &keys\n  old: value\ncopy: *keys\n",
            "currentMek: !custom old\nmeks: {}\n",
            "currentMek: " + "x" * 65 + "\nmeks: {}\n",
            "currentMek: old\nmeks:\n" + "".join(f"  key-{index}: value\n" for index in range(33)),
            "currentMek: old\nmeks:\n  invalid/id: value\n",
            "x" * (MAX_KEYRING_BYTES + 1),
        ]
        for contents in invalid_values:
            with self.subTest(size=len(contents)), tempfile.TemporaryDirectory() as directory:
                keyring_path = Path(directory) / "mek.yaml"
                keyring_path.write_text(contents, encoding="utf-8")
                with self.assertRaises(osmo_errors.OSMOError):
                    _manager(keyring_path, SecretStore())

    def test_duplicate_material_under_different_ids_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            keyring_path = Path(directory) / "mek.yaml"
            key = _make_mek("old")
            raw = key.export(as_dict=True)
            duplicate = jwk.JWK(kty="oct", kid="new", k=raw["k"])
            _write_keyring(keyring_path, "old", {"old": key, "new": duplicate})
            with self.assertRaisesRegex(osmo_errors.OSMOError, "unique key material"):
                _manager(keyring_path, SecretStore())

    def test_invalid_key_material_is_not_disclosed_in_error(self):
        with tempfile.TemporaryDirectory() as directory:
            keyring_path = Path(directory) / "mek.yaml"
            secret_marker = "DO-NOT-LOG-THIS-KEY-MATERIAL"
            encoded = base64.b64encode(secret_marker.encode("utf-8")).decode("ascii")
            keyring_path.write_text(f"currentMek: old\nmeks:\n  old: {encoded}\n", encoding="utf-8")
            with self.assertRaises(osmo_errors.OSMOError) as raised:
                _manager(keyring_path, SecretStore())
            self.assertNotIn(secret_marker, str(raised.exception))
            self.assertNotIn(encoded, str(raised.exception))

    def test_parser_traceback_does_not_disclose_secret_controlled_duplicate_key(self):
        with tempfile.TemporaryDirectory() as directory:
            keyring_path = Path(directory) / "mek.yaml"
            secret_marker = "DO-NOT-LOG-DUPLICATE-KEY-MATERIAL"
            exported = _make_mek("old").export(as_dict=True)
            duplicate_json = (
                '{"k":' + json.dumps(exported["k"])
                + ',"kid":"old","kty":"oct",'
                + json.dumps(secret_marker) + ':"first",'
                + json.dumps(secret_marker) + ':"second"}'
            )
            encoded_json = base64.b64encode(duplicate_json.encode("utf-8")).decode("ascii")
            invalid_documents = (
                "currentMek: old\nmeks:\n"
                f"  {secret_marker}: first\n  {secret_marker}: second\n",
                f"currentMek: old\nmeks:\n  old: {encoded_json}\n",
            )
            for contents in invalid_documents:
                with self.subTest(contents=contents[:20]):
                    keyring_path.write_text(contents, encoding="utf-8")
                    with self.assertRaises(osmo_errors.OSMOError) as raised:
                        _manager(keyring_path, SecretStore())
                    rendered_traceback = "".join(
                        traceback.format_exception(raised.exception))
                    self.assertNotIn(secret_marker, rendered_traceback)


if __name__ == "__main__":
    unittest.main()

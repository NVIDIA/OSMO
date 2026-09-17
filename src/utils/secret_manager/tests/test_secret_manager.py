"""Tests for startup-only MEK loading and explicit rewrap primitives."""

# SPDX-License-Identifier: Apache-2.0

import base64
import json
import os
from pathlib import Path
import shutil
import tempfile
import traceback
from typing import Callable
import unittest
from unittest import mock

from jwcrypto import jwk, jwe  # type: ignore
from jwcrypto.common import json_encode  # type: ignore

from src.lib.utils import osmo_errors
from src.utils.secret_manager import Decrypted, Encrypted, SecretManager


def _key(key_id: str) -> jwk.JWK:
    return jwk.JWK.generate(kty="oct", size=256, kid=key_id)


def _encoded(key: jwk.JWK) -> str:
    return base64.b64encode(
        json.dumps(key.export(as_dict=True), separators=(",", ":")).encode()
    ).decode()


def _encoded_octet_jwk(key_id: str, encoded_key: str) -> str:
    return base64.b64encode(json.dumps({
        "k": encoded_key,
        "kid": key_id,
        "kty": "oct",
    }, separators=(",", ":")).encode()).decode()


def _write(path: Path, current: str, keys: dict[str, jwk.JWK]) -> None:
    path.write_text(
        "currentMek: " + current + "\nmeks:\n" +
        "".join(f"  {key_id}: {_encoded(key)}\n" for key_id, key in keys.items()),
        encoding="utf-8",
    )


class Store:
    """Minimal compare-and-set persistence double."""

    def __init__(self):
        self.wrappers: dict[tuple[str, str], str] = {}
        self.current: dict[str, str] = {}

    def read(self, uid: str, kid: str) -> str:
        return self.wrappers[(uid, kid)]

    def write(self, uid: str, kid: str, new: str, old: str) -> bool:
        if self.wrappers.get((uid, kid)) != old:
            return False
        self.wrappers[(uid, kid)] = new
        return True

    def add(self, uid: str, values: dict) -> None:
        self.current[uid] = values["current"]
        for kid, value in values.items():
            if kid != "current":
                self.wrappers[(uid, kid)] = value


def _manager(path: Path, store: Store) -> SecretManager:
    return SecretManager(
        str(path), store.read, store.write,
        lambda uid: store.current[uid], store.add)


def _wrap_uek(user_key: jwk.JWK, wrapping_key: jwk.JWK) -> str:
    token = jwe.JWE(
        user_key.export().encode(),
        json_encode({"alg": "A256GCMKW", "enc": "A256GCM", "kid": wrapping_key.key_id}),
    )
    token.add_recipient(wrapping_key)
    return token.serialize(True)


CANONICAL_KEY = "4OHi4-Tl5ufo6err7O3u7_Dx8vP09fb3-Pn6-_z9_v8"


def _wrap_bytes(payload: bytes, wrapping_key: jwk.JWK, header: dict) -> str:
    token = jwe.JWE(payload, json_encode(header))
    token.add_recipient(wrapping_key)
    return token.serialize(True)


def _encoded_raw_jwk(document: str) -> str:
    return base64.b64encode(document.encode("utf-8")).decode("ascii")


def _manager_from_text(directory: str, text: str) -> SecretManager:
    path = Path(directory) / "mek.yaml"
    path.write_text(text, encoding="utf-8")
    return _manager(path, Store())


def _keyring_text_with_entry_count(count: int) -> str:
    entries = "".join(f"  key{index}: material\n" for index in range(count))
    return "currentMek: key0\nmeks:\n" + entries


def _losing_write(store: Store, concurrent_value: str) -> Callable[[str, str, str, str], bool]:
    """Build a compare-and-set writer that always loses to a concurrent winner."""

    def write(uid: str, kid: str, new_value: str, old_value: str) -> bool:
        del new_value, old_value
        store.wrappers[(uid, kid)] = concurrent_value
        return False

    return write


class TestSecretManager(unittest.TestCase):
    """Validate startup-only loading and explicit authenticated rewrites."""

    def test_keyring_is_loaded_only_at_startup(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "mek.yaml"
            first, second = _key("key1"), _key("key2")
            _write(path, "key1", {"key1": first})
            manager = _manager(path, Store())
            _write(path, "key2", {"key1": first, "key2": second})
            self.assertEqual(manager.current_mek_id, "key1")
            self.assertEqual(sorted(manager.meks), ["key1"])

            replacement = _manager(path, Store())
            self.assertEqual(replacement.current_mek_id, "key2")
            self.assertEqual(sorted(replacement.meks), ["key1", "key2"])

    def test_generation_is_public_but_digest_binds_material(self):
        with tempfile.TemporaryDirectory() as directory:
            first_path = Path(directory) / "one.yaml"
            second_path = Path(directory) / "two.yaml"
            _write(first_path, "key1", {"key1": _key("key1")})
            _write(second_path, "key1", {"key1": _key("key1")})
            first = _manager(first_path, Store())
            second = _manager(second_path, Store())
            self.assertEqual(first.generation, second.generation)
            self.assertNotEqual(
                first.fingerprint_bundle_digest(), second.fingerprint_bundle_digest())

    def test_parser_accepts_legacy_unpadded_standard_base64(self):
        material = (
            b"\xe0\xe1\xe2\xe3\xe4\xe5\xe6\xe7"
            b"\xe8\xe9\xea\xeb\xec\xed\xee\xef"
            b"\xf0\xf1\xf2\xf3\xf4\xf5\xf6\xf7"
            b"\xf8\xf9\xfa\xfb\xfc\xfd\xfe\xff"
        )
        legacy_standard_key = base64.b64encode(material).decode().rstrip("=")
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "mek.yaml"
            path.write_text(
                "currentMek: key1\nmeks:\n"
                "  key1: " + _encoded_octet_jwk(
                    "key1", legacy_standard_key) + "\n",
                encoding="utf-8",
            )

            manager = _manager(path, Store())

        self.assertEqual(
            manager.meks["key1"].export(as_dict=True)["k"],
            "4OHi4-Tl5ufo6err7O3u7_Dx8vP09fb3-Pn6-_z9_v8",
        )
        self.assertEqual(
            manager.key_fingerprints()["key1"],
            "9432c1a7d343fcfacb164bdc44ff71c1281c004886b1c428419088d06cd3561a",
        )

    def test_parser_rejects_invalid_inner_key_spellings_without_leaking(self):
        invalid_keys = {
            "mixed-plus-underscore":
                "4OHi4+Tl5ufo6err7O3u7_Dx8vP09fb3+Pn6+/z9/v8",
            "mixed-dash-slash":
                "4OHi4-Tl5ufo6err7O3u7/Dx8vP09fb3+Pn6+/z9/v8",
            "invalid-character":
                "4OHi4+Tl5ufo6err7O3u7/Dx8vP09fb3+Pn6+/z9/v!",
            "whitespace":
                "4OHi4+Tl5ufo6err7O3u7/Dx8vP09fb3+Pn6+ /z9/v8",
            "misplaced-padding":
                "4OHi4+Tl5ufo6err7O3u7/Dx8vP09fb3+Pn6+=/z9/v8",
            "excess-padding":
                "4OHi4+Tl5ufo6err7O3u7/Dx8vP09fb3+Pn6+/z9/v8===",
            "nonzero-discarded-bits":
                "4OHi4+Tl5ufo6err7O3u7/Dx8vP09fb3+Pn6+/z9/v9",
            "31-byte-standard-unpadded":
                "4OHi4+Tl5ufo6err7O3u7/Dx8vP09fb3+Pn6+/z9/g",
            "33-byte-standard-unpadded":
                "3+Dh4uPk5ebn6Onq6+zt7u/w8fLz9PX29/j5+vv8/f7/",
            "padded-base64url":
                "4OHi4-Tl5ufo6err7O3u7_Dx8vP09fb3-Pn6-_z9_v8=",
        }
        for name, encoded_key in invalid_keys.items():
            with self.subTest(name=name), tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / "mek.yaml"
                path.write_text(
                    "currentMek: key1\nmeks:\n"
                    "  key1: " + _encoded_octet_jwk(
                        "key1", encoded_key) + "\n",
                    encoding="utf-8",
                )

                with self.assertRaises(osmo_errors.OSMOError) as context:
                    _manager(path, Store())

                self.assertEqual(str(context.exception), "A MEK entry is invalid.")
                self.assertNotIn(encoded_key, str(context.exception))

    def test_parser_rejects_duplicate_material_across_legacy_spellings(self):
        url_key = "4OHi4-Tl5ufo6err7O3u7_Dx8vP09fb3-Pn6-_z9_v8"
        legacy_standard_key = "4OHi4+Tl5ufo6err7O3u7/Dx8vP09fb3+Pn6+/z9/v8"
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "mek.yaml"
            path.write_text(
                "currentMek: key1\nmeks:\n"
                "  key1: " + _encoded_octet_jwk("key1", url_key) + "\n"
                "  key2: " + _encoded_octet_jwk(
                    "key2", legacy_standard_key) + "\n",
                encoding="utf-8",
            )

            with self.assertRaises(osmo_errors.OSMOError) as context:
                _manager(path, Store())

        self.assertEqual(
            str(context.exception),
            "Each MEK identifier must contain unique key material.",
        )
        self.assertNotIn(url_key, str(context.exception))
        self.assertNotIn(legacy_standard_key, str(context.exception))

    def test_parser_rejects_duplicate_material_and_does_not_leak(self):
        sentinel = "MEK-SENTINEL-DO-NOT-LOG"
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "mek.yaml"
            path.write_text(
                f"currentMek: key1\nmeks:\n  {sentinel}: first\n"
                f"  {sentinel}: second\n",
                encoding="utf-8",
            )
            try:
                _manager(path, Store())
            except osmo_errors.OSMOError as error:
                rendered = "".join(traceback.format_exception(error))
                self.assertNotIn(sentinel, str(error))
                self.assertNotIn(sentinel, rendered)
            else:
                self.fail("invalid keyring was accepted")

    def test_direct_mek_decrypt_is_read_only_and_explicit_rewraps(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "mek.yaml"
            old, new = _key("key1"), _key("key2")
            _write(path, "key2", {"key1": old, "key2": new})
            manager = _manager(path, Store())
            token = jwe.JWE(
                b"secret",
                json_encode({"alg": manager.alg, "enc": manager.enc, "kid": "key1"}),
            )
            token.add_recipient(old)
            original = token.serialize(True)
            callbacks: list[str] = []
            self.assertEqual(
                manager.decrypt(Encrypted(original), "", callbacks.append).value, "secret")
            self.assertEqual(callbacks, [])

            result = manager.rewrap_direct_mek(original, manager.rewrap_snapshot())
            self.assertEqual(result.status, "rewrapped")
            replacement = jwe.JWE()
            replacement.deserialize(result.value)
            self.assertEqual(replacement.jose_header["kid"], "key2")
            replacement.decrypt(new)
            self.assertEqual(replacement.payload, b"secret")

    def test_empty_direct_mek_ciphertext_authenticates_and_decrypts(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "mek.yaml"
            key = _key("key1")
            _write(path, "key1", {"key1": key})
            manager = _manager(path, Store())

            encrypted = manager.encrypt("", "")
            self.assertEqual(manager.authenticate_mek_encrypted(encrypted.value), "key1")
            callbacks: list[str] = []
            self.assertEqual(
                manager.decrypt(encrypted, "", callbacks.append).value, "")
            self.assertEqual(callbacks, [])

    def test_uek_rewrap_is_cas_and_preserves_payload(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "mek.yaml"
            old, new = _key("key1"), _key("key2")
            _write(path, "key2", {"key1": old, "key2": new})
            store = Store()
            manager = _manager(path, store)
            user_key = _key("uek1")
            store.current["user"] = "uek1"
            store.wrappers[("user", "uek1")] = _wrap_uek(user_key, old)

            result = manager.rewrap_uek("user", "uek1", manager.rewrap_snapshot())
            self.assertEqual(result.status, "rewrapped")
            reread, _ = manager.get_uek("user", "uek1")
            self.assertEqual(reread.export(as_dict=True), user_key.export(as_dict=True))
            self.assertEqual(
                manager.rewrap_uek("user", "uek1", manager.rewrap_snapshot()).status,
                "already-current",
            )

    def test_uek_cas_loser_must_authenticate_same_payload(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "mek.yaml"
            old, new = _key("key1"), _key("key2")
            _write(path, "key2", {"key1": old, "key2": new})
            store = Store()
            manager = _manager(path, store)
            user_key = _key("uek1")
            store.current["user"] = "uek1"
            store.wrappers[("user", "uek1")] = _wrap_uek(user_key, old)

            def lose_cas(uid: str, kid: str, new: str, old: str) -> bool:
                del uid, kid, new, old
                store.wrappers[("user", "uek1")] = "malformed"
                return False

            manager.write_uek = lose_cas
            with self.assertRaisesRegex(osmo_errors.OSMOError, "authentication"):
                manager.rewrap_uek("user", "uek1", manager.rewrap_snapshot())


class TestSecretWrappers(unittest.TestCase):
    """Validate the plaintext exposure contract of the secret wrapper types."""

    def test_encrypted_str_exposes_ciphertext(self):
        self.assertEqual(str(Encrypted("ciphertext")), "ciphertext")

    def test_decrypted_str_masks_plaintext(self):
        self.assertEqual(str(Decrypted("super-secret")), "xxxxx")


class TestKeyringValidation(unittest.TestCase):
    """Validate rejection of malformed, unsafe, or non-canonical keyrings."""

    def test_keyring_accepts_exact_size_count_and_identifier_limits(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "mek.yaml"
            current_id = "k" * 64
            keys = {current_id: _key(current_id)}
            keys.update({f"key{index}": _key(f"key{index}") for index in range(31)})
            _write(path, current_id, keys)
            text = path.read_text(encoding="utf-8")
            text += "#" + "a" * (1024 * 1024 - len(text.encode("utf-8")) - 1)

            manager = _manager_from_text(directory, text)

        self.assertEqual(manager.current_mek_id, current_id)
        self.assertEqual(set(manager.meks), set(keys))
        self.assertEqual(
            manager.get_mek().export(as_dict=True), keys[current_id].export(as_dict=True))

    def test_missing_mek_file_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            missing = Path(directory) / "absent.yaml"

            with self.assertRaises(osmo_errors.OSMOError) as context:
                _manager(missing, Store())

        self.assertIn("does not exist", str(context.exception))

    def test_keyring_above_the_size_limit_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(osmo_errors.OSMOError) as context:
                _manager_from_text(directory, "#" + "a" * (1024 * 1024))

        self.assertIn("exceeds the 1048576-byte limit", str(context.exception))

    def test_keyring_with_yaml_anchor_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(osmo_errors.OSMOError) as context:
                _manager_from_text(
                    directory, "currentMek: &anchor key1\nmeks:\n  key1: *anchor\n")

        self.assertIn("cannot contain YAML aliases, anchors, or tags", str(context.exception))

    def test_keyring_that_changes_while_being_read_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "mek.yaml"
            _write(path, "key1", {"key1": _key("key1")})
            decoy = Path(directory) / "decoy.yaml"
            decoy.write_text("currentMek: key1\n", encoding="utf-8")
            observed_signatures = [os.stat(path), os.stat(decoy)]

            with mock.patch(
                "src.utils.secret_manager.secret_manager.os.fstat",
                side_effect=observed_signatures,
            ), self.assertRaises(osmo_errors.OSMOError) as context:
                _manager(path, Store())

        self.assertIn("changed while it was being read", str(context.exception))

    def test_keyring_that_is_not_a_mapping_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(osmo_errors.OSMOError) as context:
                _manager_from_text(directory, "just-a-scalar\n")

        self.assertIn("must contain a mapping", str(context.exception))

    def test_current_mek_id_with_a_leading_dash_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(osmo_errors.OSMOError) as context:
                _manager_from_text(
                    directory, 'currentMek: "-leading-dash"\nmeks:\n  key1: material\n')

        self.assertEqual(
            str(context.exception),
            "currentMek must use 1-64 letters, digits, dots, underscores, or dashes.",
        )

    def test_empty_meks_mapping_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(osmo_errors.OSMOError) as context:
                _manager_from_text(directory, "currentMek: key1\nmeks: {}\n")

        self.assertEqual(str(context.exception), "meks must be a non-empty mapping.")

    def test_keyring_with_more_than_thirty_two_meks_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(osmo_errors.OSMOError) as context:
                _manager_from_text(directory, _keyring_text_with_entry_count(33))

        self.assertEqual(str(context.exception), "meks cannot contain more than 32 entries.")

    def test_mek_identifier_with_a_leading_dash_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(osmo_errors.OSMOError) as context:
                _manager_from_text(
                    directory, 'currentMek: key1\nmeks:\n  "-key1": material\n')

        self.assertEqual(
            str(context.exception),
            "MEK identifiers must use 1-64 letters, digits, dots, underscores, or dashes.",
        )

    def test_non_string_mek_entry_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(osmo_errors.OSMOError) as context:
                _manager_from_text(directory, "currentMek: key1\nmeks:\n  key1: 5\n")

        self.assertEqual(str(context.exception), "Every MEK must be a base64 encoded JWK.")

    def test_jwk_with_an_unexpected_member_is_rejected(self):
        document = json.dumps(
            {"k": CANONICAL_KEY, "kid": "key1", "kty": "oct", "use": "enc"},
            separators=(",", ":"),
        )
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(osmo_errors.OSMOError) as context:
                _manager_from_text(
                    directory,
                    "currentMek: key1\nmeks:\n  key1: " + _encoded_raw_jwk(document) + "\n",
                )

        self.assertEqual(str(context.exception), "A MEK entry is invalid.")

    def test_jwk_with_a_duplicate_member_is_rejected(self):
        document = (
            '{"k":"' + CANONICAL_KEY + '","k":"' + CANONICAL_KEY
            + '","kid":"key1","kty":"oct"}'
        )
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(osmo_errors.OSMOError) as context:
                _manager_from_text(
                    directory,
                    "currentMek: key1\nmeks:\n  key1: " + _encoded_raw_jwk(document) + "\n",
                )

        self.assertEqual(str(context.exception), "A MEK entry is invalid.")

    def test_jwk_kid_that_disagrees_with_its_entry_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(osmo_errors.OSMOError) as context:
                _manager_from_text(
                    directory,
                    "currentMek: key1\nmeks:\n  key1: "
                    + _encoded_octet_jwk("other", CANONICAL_KEY) + "\n",
                )

        self.assertEqual(str(context.exception), "A MEK entry is invalid.")

    def test_jwk_with_non_string_key_material_is_rejected(self):
        document = json.dumps({"k": 5, "kid": "key1", "kty": "oct"}, separators=(",", ":"))
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(osmo_errors.OSMOError) as context:
                _manager_from_text(
                    directory,
                    "currentMek: key1\nmeks:\n  key1: " + _encoded_raw_jwk(document) + "\n",
                )

        self.assertEqual(str(context.exception), "A MEK entry is invalid.")

    def test_current_mek_absent_from_meks_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(osmo_errors.OSMOError) as context:
                _manager_from_text(
                    directory,
                    "currentMek: key9\nmeks:\n  key1: "
                    + _encoded_octet_jwk("key1", CANONICAL_KEY) + "\n",
                )

        self.assertEqual(str(context.exception), "currentMek is not present in meks.")


class TestCiphertextAuthentication(unittest.TestCase):
    """Validate authenticated JWE header and payload checks."""

    def setUp(self):
        self.directory_name = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.directory_name)
        path = Path(self.directory_name) / "mek.yaml"
        self.mek = _key("key1")
        _write(path, "key1", {"key1": self.mek})
        self.manager = _manager(path, Store())

    def test_decrypt_rejects_unsupported_algorithms(self):
        for algorithm, encryption in (("A256GCMKW", "A128GCM"), ("A256KW", "A256GCM")):
            with self.subTest(algorithm=algorithm, encryption=encryption):
                value = _wrap_bytes(
                    b"secret", self.mek,
                    {"alg": algorithm, "enc": encryption, "kid": "key1"})
                updates = mock.Mock()

                with self.assertRaises(osmo_errors.OSMOError) as context:
                    self.manager.decrypt(Encrypted(value), "", updates)

                self.assertEqual(
                    str(context.exception), "Encrypted secret uses an unsupported JWE algorithm.")
                updates.assert_not_called()

    def test_decrypt_rejects_a_header_without_a_kid(self):
        value = _wrap_bytes(b"secret", self.mek, {"alg": "A256GCMKW", "enc": "A256GCM"})

        with self.assertRaises(osmo_errors.OSMOError) as context:
            self.manager.decrypt(Encrypted(value), "", lambda updated: None)

        self.assertEqual(
            str(context.exception), "Encrypted secret does not contain a valid kid.")

    def test_authenticate_mek_encrypted_rejects_a_non_compact_value(self):
        with self.assertRaises(osmo_errors.OSMOError) as context:
            self.manager.authenticate_mek_encrypted("header.key.iv.ciphertext")

        self.assertEqual(
            str(context.exception), "Persisted direct-MEK ciphertext failed authentication.")

    def test_authenticate_mek_encrypted_rejects_foreign_key_material(self):
        foreign_path = Path(self.directory_name) / "foreign.yaml"
        _write(foreign_path, "key1", {"key1": _key("key1")})
        foreign_manager = _manager(foreign_path, Store())
        value = foreign_manager.encrypt("secret", "").value

        with self.assertRaises(osmo_errors.OSMOError) as context:
            self.manager.authenticate_mek_encrypted(value)

        self.assertEqual(
            str(context.exception), "Persisted direct-MEK ciphertext failed authentication.")

    def test_empty_ciphertext_with_corrupted_tag_fails_authentication(self):
        parts = self.manager.encrypt("", "").value.split(".")
        parts[-1] = ("A" if parts[-1][0] != "A" else "B") + parts[-1][1:]
        value = ".".join(parts)

        with self.assertRaisesRegex(osmo_errors.OSMOError, "failed authentication"):
            self.manager.authenticate_mek_encrypted(value)

    def test_get_mek_rejects_an_unknown_kid(self):
        with self.assertRaises(osmo_errors.OSMONotFoundError) as context:
            self.manager.get_mek("key9")

        self.assertEqual(str(context.exception), "Cannot find mek whose kid is key9.")

    def test_authenticate_uek_wrapper_returns_the_wrapping_mek_id(self):
        wrapper = _wrap_uek(_key("uek1"), self.mek)

        self.assertEqual(self.manager.authenticate_uek_wrapper(wrapper, "uek1"), "key1")

    def test_authenticate_uek_wrapper_rejects_a_non_compact_value(self):
        with self.assertRaises(osmo_errors.OSMOError) as context:
            self.manager.authenticate_uek_wrapper("header.key.iv.ciphertext")

        self.assertEqual(str(context.exception), "Persisted UEK wrapper failed authentication.")

    def test_authenticate_uek_wrapper_rejects_a_payload_without_a_key_id(self):
        anonymous_key = jwk.JWK(kty="oct", k=CANONICAL_KEY)
        wrapper = _wrap_bytes(
            anonymous_key.export().encode("utf-8"), self.mek,
            {"alg": "A256GCMKW", "enc": "A256GCM", "kid": "key1"})

        with self.assertRaises(osmo_errors.OSMOError) as context:
            self.manager.authenticate_uek_wrapper(wrapper)

        self.assertEqual(str(context.exception), "Persisted UEK wrapper failed authentication.")

    def test_authenticate_uek_wrapper_rejects_a_slot_mismatch(self):
        wrapper = _wrap_uek(_key("uek1"), self.mek)

        with self.assertRaises(osmo_errors.OSMOError) as context:
            self.manager.authenticate_uek_wrapper(wrapper, "uek2")

        self.assertEqual(str(context.exception), "Persisted UEK wrapper failed authentication.")

    def test_authenticate_uek_wrapper_rejects_an_undersized_user_key(self):
        undersized_key = jwk.JWK.generate(kty="oct", size=128, kid="uek1")
        wrapper = _wrap_uek(undersized_key, self.mek)

        with self.assertRaises(osmo_errors.OSMOError) as context:
            self.manager.authenticate_uek_wrapper(wrapper, "uek1")

        self.assertEqual(str(context.exception), "Persisted UEK wrapper failed authentication.")

    def test_generate_uek_returns_a_fresh_256_bit_octet_key(self):
        first = self.manager.generate_uek()
        second = self.manager.generate_uek()
        exported = first.export(as_dict=True)

        self.assertEqual(exported["kty"], "oct")
        self.assertEqual(len(base64.urlsafe_b64decode(exported["k"] + "=")), 32)
        self.assertNotEqual(first.key_id, second.key_id)


class TestUserKeyLifecycle(unittest.TestCase):
    """Validate UEK slot resolution, lazy migration, and pinned rewrap."""

    def setUp(self):
        self.directory_name = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.directory_name)
        self.path = Path(self.directory_name) / "mek.yaml"
        self.old_mek = _key("key1")
        self.new_mek = _key("key2")
        _write(self.path, "key2", {"key1": self.old_mek, "key2": self.new_mek})
        self.store = Store()
        self.manager = _manager(self.path, self.store)

    def test_add_new_user_persists_a_wrapper_readable_as_current(self):
        self.manager.add_new_user("user")

        user_key, is_current = self.manager.get_uek("user")
        self.assertTrue(is_current)
        self.assertEqual(user_key.key_id, self.store.current["user"])
        self.assertEqual(
            self.manager.authenticate_uek_wrapper(
                self.store.wrappers[("user", user_key.key_id)], user_key.key_id),
            "key2",
        )
        updates = mock.Mock()
        encrypted = self.manager.encrypt("user secret", "user")
        self.assertEqual(self.manager.decrypt(encrypted, "user", updates).value, "user secret")
        updates.assert_not_called()

    def test_get_uek_reports_an_unknown_user(self):
        with self.assertRaises(osmo_errors.OSMOError) as context:
            self.manager.get_uek("absent")

        self.assertEqual(str(context.exception), "Cannot find user key for user absent.")

    def test_get_uek_rejects_a_wrapper_referencing_an_unknown_mek(self):
        self.store.current["user"] = "uek1"
        self.store.wrappers[("user", "uek1")] = _wrap_uek(_key("uek1"), _key("key9"))

        with self.assertRaises(osmo_errors.OSMONotFoundError) as context:
            self.manager.get_uek("user", "uek1")

        self.assertEqual(str(context.exception), "Cannot find mek whose kid is key9.")

    def test_get_uek_rejects_a_wrapper_for_a_different_slot(self):
        self.store.current["user"] = "uek1"
        self.store.wrappers[("user", "uek1")] = _wrap_uek(_key("uek2"), self.new_mek)

        with self.assertRaises(osmo_errors.OSMOError) as context:
            self.manager.get_uek("user", "uek1")

        self.assertEqual(
            str(context.exception), "User key wrapper for user user does not match slot uek1.")

    def test_decrypt_migrates_stale_user_ciphertext_to_the_current_slot(self):
        stale_uek = _key("uek1")
        current_uek = _key("uek2")
        self.store.current["user"] = "uek2"
        self.store.wrappers[("user", "uek1")] = _wrap_uek(stale_uek, self.new_mek)
        self.store.wrappers[("user", "uek2")] = _wrap_uek(current_uek, self.new_mek)
        stale_value = _wrap_bytes(
            b"secret", stale_uek, {"alg": "A256GCMKW", "enc": "A256GCM", "kid": "uek1"})
        updates: list[str] = []

        decrypted = self.manager.decrypt(Encrypted(stale_value), "user", updates.append)

        self.assertEqual(decrypted.value, "secret")
        self.assertEqual(len(updates), 1)
        migrated = jwe.JWE()
        migrated.deserialize(updates[0])
        self.assertEqual(migrated.jose_header["kid"], "uek2")
        migrated.decrypt(current_uek)
        self.assertEqual(migrated.payload, b"secret")

    def test_rewrap_snapshot_digest_matches_the_live_bundle_digest(self):
        snapshot = self.manager.rewrap_snapshot()

        self.assertEqual(
            SecretManager.rewrap_snapshot_digest(snapshot),
            self.manager.fingerprint_bundle_digest(),
        )

    def test_validate_rewrap_snapshot_rejects_a_foreign_keyring(self):
        foreign_path = Path(self.directory_name) / "foreign.yaml"
        _write(foreign_path, "key1", {"key1": _key("key1")})
        foreign_manager = _manager(foreign_path, Store())

        with self.assertRaises(osmo_errors.OSMOError) as context:
            self.manager.validate_rewrap_snapshot(foreign_manager.rewrap_snapshot())

        self.assertEqual(
            str(context.exception), "Active MEK keyring changed during explicit rewrap.")

    def test_rewrap_uek_rejects_a_wrapper_referencing_an_unavailable_mek(self):
        self.store.current["user"] = "uek1"
        self.store.wrappers[("user", "uek1")] = _wrap_uek(_key("uek1"), _key("key9"))

        with self.assertRaises(osmo_errors.OSMOError) as context:
            self.manager.rewrap_uek("user", "uek1", self.manager.rewrap_snapshot())

        self.assertEqual(str(context.exception), "UEK wrapper references an unavailable MEK.")

    def test_rewrap_uek_rejects_a_wrapper_for_a_different_slot(self):
        self.store.current["user"] = "uek1"
        self.store.wrappers[("user", "uek1")] = _wrap_uek(_key("uek2"), self.old_mek)

        with self.assertRaises(osmo_errors.OSMOError) as context:
            self.manager.rewrap_uek("user", "uek1", self.manager.rewrap_snapshot())

        self.assertEqual(str(context.exception), "UEK wrapper does not match its persisted slot.")

    def test_rewrap_uek_rejects_a_malformed_wrapper(self):
        self.store.current["user"] = "uek1"
        self.store.wrappers[("user", "uek1")] = "not-a-jwe"

        with self.assertRaises(osmo_errors.OSMOError) as context:
            self.manager.rewrap_uek("user", "uek1", self.manager.rewrap_snapshot())

        self.assertEqual(str(context.exception), "Persisted UEK wrapper failed authentication.")

    def test_rewrap_uek_accepts_a_concurrent_winner_under_the_pinned_mek(self):
        user_key = _key("uek1")
        self.store.current["user"] = "uek1"
        self.store.wrappers[("user", "uek1")] = _wrap_uek(user_key, self.old_mek)
        concurrent_winner = _wrap_uek(user_key, self.new_mek)
        self.manager.write_uek = _losing_write(self.store, concurrent_winner)

        result = self.manager.rewrap_uek("user", "uek1", self.manager.rewrap_snapshot())

        self.assertEqual(result.status, "concurrent-winner")
        self.assertEqual(result.value, concurrent_winner)
        replacement = jwe.JWE()
        replacement.deserialize(result.value)
        replacement.decrypt(self.new_mek)
        self.assertEqual(replacement.payload, user_key.export().encode())

    def test_rewrap_uek_rejects_a_concurrent_winner_under_another_mek(self):
        user_key = _key("uek1")
        self.store.current["user"] = "uek1"
        self.store.wrappers[("user", "uek1")] = _wrap_uek(user_key, self.old_mek)
        self.manager.write_uek = _losing_write(
            self.store, _wrap_uek(user_key, self.old_mek))

        with self.assertRaises(osmo_errors.OSMOError) as context:
            self.manager.rewrap_uek("user", "uek1", self.manager.rewrap_snapshot())

        self.assertEqual(
            str(context.exception), "Concurrent UEK rewrap did not use the pinned target MEK.")

    def test_rewrap_uek_rejects_a_concurrent_winner_with_a_substituted_payload(self):
        self.store.current["user"] = "uek1"
        self.store.wrappers[("user", "uek1")] = _wrap_uek(_key("uek1"), self.old_mek)
        self.manager.write_uek = _losing_write(
            self.store, _wrap_uek(_key("uek1"), self.new_mek))

        with self.assertRaises(osmo_errors.OSMOError) as context:
            self.manager.rewrap_uek("user", "uek1", self.manager.rewrap_snapshot())

        self.assertEqual(
            str(context.exception), "Concurrent UEK rewrap changed the key payload.")

    def test_rewrap_direct_mek_reports_already_current(self):
        value = _wrap_bytes(
            b"secret", self.new_mek, {"alg": "A256GCMKW", "enc": "A256GCM", "kid": "key2"})

        result = self.manager.rewrap_direct_mek(value, self.manager.rewrap_snapshot())

        self.assertEqual(result.status, "already-current")
        self.assertEqual(result.value, value)

    def test_rewrap_direct_mek_rejects_an_unavailable_mek(self):
        stranger = _key("key9")
        value = _wrap_bytes(
            b"secret", stranger, {"alg": "A256GCMKW", "enc": "A256GCM", "kid": "key9"})

        with self.assertRaises(osmo_errors.OSMOError) as context:
            self.manager.rewrap_direct_mek(value, self.manager.rewrap_snapshot())

        self.assertEqual(
            str(context.exception), "Direct-MEK ciphertext references an unavailable MEK.")

    def test_rewrap_direct_mek_rejects_a_malformed_value(self):
        with self.assertRaises(osmo_errors.OSMOError) as context:
            self.manager.rewrap_direct_mek("not-a-jwe", self.manager.rewrap_snapshot())

        self.assertEqual(
            str(context.exception), "Persisted direct-MEK ciphertext failed authentication.")


if __name__ == "__main__":
    unittest.main()

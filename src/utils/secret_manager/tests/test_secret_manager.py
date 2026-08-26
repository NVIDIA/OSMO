"""Tests for startup-only MEK loading and explicit rewrap primitives."""

# SPDX-License-Identifier: Apache-2.0

import base64
import json
from pathlib import Path
import tempfile
import traceback
import unittest

from jwcrypto import jwk, jwe  # type: ignore
from jwcrypto.common import json_encode  # type: ignore

from src.lib.utils import osmo_errors
from src.utils.secret_manager import Encrypted, SecretManager


def _key(key_id: str) -> jwk.JWK:
    return jwk.JWK.generate(kty="oct", size=256, kid=key_id)


def _encoded(key: jwk.JWK) -> str:
    return base64.b64encode(
        json.dumps(key.export(as_dict=True), separators=(",", ":")).encode()
    ).decode()


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


if __name__ == "__main__":
    unittest.main()

"""
SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

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
import binascii
import dataclasses
import hashlib
import json
import os
import re
import threading
from types import MappingProxyType
from typing import Callable, Dict, Mapping, Tuple
import uuid

from jwcrypto import jwk, jwe  # type: ignore
from jwcrypto.common import JWException, json_encode  # type: ignore
import yaml
from yaml.tokens import AliasToken, AnchorToken, TagToken

from src.lib.utils import osmo_errors


class _DuplicateKeySafeLoader(yaml.SafeLoader):
    """Safe YAML loader which rejects duplicate mapping keys."""


def _construct_unique_mapping(loader, node, deep=False):
    mapping = {}
    for key_node, value_node in node.value:
        key = loader.construct_object(key_node, deep=deep)
        if key in mapping:
            raise yaml.constructor.ConstructorError(
                "while constructing a mapping",
                node.start_mark,
                "found a duplicate key",
                key_node.start_mark,
            )
        mapping[key] = loader.construct_object(value_node, deep=deep)
    return mapping


_DuplicateKeySafeLoader.add_constructor(
    yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, _construct_unique_mapping
)


MAX_KEYRING_BYTES = 1024 * 1024
MAX_MEK_COUNT = 32
MAX_MEK_ID_LENGTH = 64
MEK_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")


@dataclasses.dataclass(frozen=True)
class Keyring:
    """An immutable, validated MEK keyring snapshot."""

    current_mek_id: str
    meks: Mapping[str, jwk.JWK]
    fingerprints: Mapping[str, str]
    generation: str


def _json_object_without_duplicates(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON member")
        result[key] = value
    return result


class Encrypted:
    """Represents an encrypted secret"""

    def __init__(self, value: str):
        self.value = value

    def __str__(self):
        return self.value


class Decrypted:
    """Represents a decrypted secret"""

    def __init__(self, value: str):
        self.value = value

    def __str__(self):
        return "xxxxx"


class SecretManager:
    """Class to read and write encrypted user secrets to postgres"""

    def __init__(
        self,
        mek_file: str,
        read_uek: Callable[[str, str], str],
        write_uek: Callable[[str, str, str, str], bool],
        read_current_kid: Callable[[str], str],
        add_user: Callable[[str, Dict], None],
        prepare_meks: Callable[[Mapping[str, str]], bool] | None = None,
        can_activate_mek: Callable[[Mapping[str, str], str], bool] | None = None,
        alg: str = "A256GCMKW",
        enc: str = "A256GCM",
    ):
        """Constructor

        Args:
            mek_file (str): A yaml file that stores master keys. The format is as follows:
                currentMek: mek0
                meks:
                    mek0: base64 encoded JWK
                    mek1: base64 encoded JWK
            read_uek (Callable[[str, str], str]): A function to read encrypted uek.
                `read_uek(uid, kid)` will be called to read the uek.
            write_uek (Callable[[str, str, str, str], bool]): A compare-and-set function to write
                an encrypted uek and report whether the row was updated.
                `write_uek(uid, kid, new_uek, old_uek)` will be called to re-encrypt uek.
            read_current_kid (Callable[[str], str]): A function to get current uek kid.
                `read_current_kid(uid)` will be called to get current kid.
            add_user (Callable[[str, Dict], None]): A function to insert new uek.
                `add_user(uid, {'current': current_kid, current_kid: encrypted_key})` will be
                called to add new uek.
            prepare_meks (Callable[[Mapping[str, str]], bool] | None): Atomically validate and
                register the complete mounted MEK fingerprint map during PREPARE.
            can_activate_mek (Callable[[Mapping[str, str], str], bool] | None): Validate that the
                complete mounted fingerprint map and selected current MEK are durably prepared.
            alg (str, optional): Cryptographic algorithm used to encrypt or determine the value of
                the content encryption key. Defaults to 'A256GCMKW'.
            enc (str, optional): Content encryption algorithm used to encrypt plain text.
                Defaults to 'A256GCM'.
        """
        self.alg = alg
        self.enc = enc
        self.mek_file = mek_file
        self.read_uek = read_uek
        self.write_uek = write_uek
        self.read_current_kid = read_current_kid
        self.add_user = add_user
        self.prepare_meks = prepare_meks
        self.can_activate_mek = can_activate_mek
        self._keyring_lock = threading.RLock()
        self._reload_lock = threading.Lock()
        self._file_signature: Tuple[int, int, int, int] | None = None
        self._rejected_file_signature: Tuple[int, int, int, int] | None = None
        self._pending_file_signature: Tuple[int, int, int, int] | None = None
        self._pending_keyring: Keyring | None = None
        self._reload_failure_revision = 0
        self._last_reload_error = ""

        if not os.path.isfile(mek_file):
            raise osmo_errors.OSMOError(f"MEK file {mek_file} does not exist.")
        for _ in range(3):
            self._keyring, self._file_signature = self._read_keyring()
            if self._stat_file() == self._file_signature:
                break
        else:
            raise osmo_errors.OSMOError(
                f"MEK file {self.mek_file} changed repeatedly while it was being initialized."
            )

    @property
    def current_mek_id(self) -> str:
        return self._keyring.current_mek_id

    @property
    def meks(self) -> Mapping[str, jwk.JWK]:
        return self._keyring.meks

    @property
    def generation(self) -> str:
        """Return a non-secret identifier for the loaded keyring revision."""
        return self._keyring.generation

    @property
    def last_reload_error(self) -> str:
        return self._last_reload_error

    @property
    def reload_failure_revision(self) -> int:
        """Return a monotonic, non-secret identifier for a rejected file revision."""
        return self._reload_failure_revision

    def key_fingerprints(self) -> Dict[str, str]:
        """Return a copy for restricted database identity validation."""
        with self._keyring_lock:
            return dict(self._keyring.fingerprints)

    def _stat_file(self) -> Tuple[int, int, int, int]:
        file_stat = os.stat(self.mek_file)
        return (file_stat.st_dev, file_stat.st_ino, file_stat.st_mtime_ns, file_stat.st_size)

    @staticmethod
    def _file_stat_signature(file_stat: os.stat_result) -> Tuple[int, int, int, int]:
        return (file_stat.st_dev, file_stat.st_ino, file_stat.st_mtime_ns, file_stat.st_size)

    def _read_keyring(self) -> Tuple[Keyring, Tuple[int, int, int, int]]:
        try:
            with open(self.mek_file, "rb") as file_pointer:
                signature = self._file_stat_signature(os.fstat(file_pointer.fileno()))
                contents = file_pointer.read(MAX_KEYRING_BYTES + 1)
                if self._file_stat_signature(os.fstat(file_pointer.fileno())) != signature:
                    raise osmo_errors.OSMOError(
                        f"MEK file {self.mek_file} changed while it was being read."
                    )
            if len(contents) > MAX_KEYRING_BYTES:
                raise osmo_errors.OSMOError(
                    f"MEK file {self.mek_file} exceeds the {MAX_KEYRING_BYTES}-byte limit."
                )
            text = contents.decode("utf-8")
            if any(
                isinstance(token, (AliasToken, AnchorToken, TagToken)) for token in yaml.scan(text)
            ):
                raise osmo_errors.OSMOError(
                    f"MEK file {self.mek_file} cannot contain YAML aliases, anchors, or tags."
                )
            config = yaml.load(text, Loader=_DuplicateKeySafeLoader)
        except osmo_errors.OSMOError:
            raise
        except (OSError, UnicodeError, yaml.YAMLError):
            raise osmo_errors.OSMOError(
                f"MEK file {self.mek_file} is not valid YAML."
            ) from None

        if not isinstance(config, dict):
            raise osmo_errors.OSMOError(f"MEK file {self.mek_file} must contain a mapping.")
        if set(config) != {"currentMek", "meks"}:
            raise osmo_errors.OSMOError(
                f"MEK file {self.mek_file} must contain only currentMek and meks."
            )

        current_mek_id = config["currentMek"]
        encoded_meks = config["meks"]
        if (
            not isinstance(current_mek_id, str)
            or not current_mek_id
            or len(current_mek_id) > MAX_MEK_ID_LENGTH
            or not MEK_ID_PATTERN.fullmatch(current_mek_id)
        ):
            raise osmo_errors.OSMOError(
                "currentMek must use 1-64 letters, digits, dots, underscores, or dashes."
            )
        if not isinstance(encoded_meks, dict) or not encoded_meks:
            raise osmo_errors.OSMOError("meks must be a non-empty mapping.")
        if len(encoded_meks) > MAX_MEK_COUNT:
            raise osmo_errors.OSMOError(f"meks cannot contain more than {MAX_MEK_COUNT} entries.")

        parsed_meks = {}
        fingerprints = {}
        for mek_id, encoded_jwk in encoded_meks.items():
            if (
                not isinstance(mek_id, str)
                or not mek_id
                or len(mek_id) > MAX_MEK_ID_LENGTH
                or not MEK_ID_PATTERN.fullmatch(mek_id)
            ):
                raise osmo_errors.OSMOError(
                    "MEK identifiers must use 1-64 letters, digits, dots, underscores, or dashes."
                )
            if not isinstance(encoded_jwk, str) or not encoded_jwk:
                raise osmo_errors.OSMOError(f"MEK {mek_id} must be a base64 encoded JWK.")
            try:
                jwk_json = base64.b64decode(encoded_jwk.encode("ascii"), validate=True).decode(
                    "utf-8"
                )
                jwk_config = json.loads(
                    jwk_json,
                    object_pairs_hook=_json_object_without_duplicates,
                    parse_constant=lambda value: (_ for _ in ()).throw(
                        ValueError(f"invalid JSON constant {value}")
                    ),
                )
                if not isinstance(jwk_config, dict) or set(jwk_config) != {"k", "kid", "kty"}:
                    raise ValueError("JWK must contain exactly k, kid, and kty")
                if jwk_config["kid"] != mek_id or jwk_config["kty"] != "oct":
                    raise ValueError("JWK kid or kty does not match the MEK entry")
                encoded_key = jwk_config["k"]
                if not isinstance(encoded_key, str):
                    raise ValueError("MEK key material must be a string")
                key_padding = "=" * (-len(encoded_key) % 4)
                try:
                    key_bytes = base64.b64decode(
                        encoded_key + key_padding, altchars=b"-_", validate=True
                    )
                except binascii.Error:
                    key_bytes = base64.b64decode(encoded_key, validate=True)
                if len(key_bytes) != 32:
                    raise ValueError("MEK must contain exactly 256 bits")
                canonical_key = base64.urlsafe_b64encode(key_bytes).decode("ascii").rstrip("=")
                canonical_standard_key = base64.b64encode(key_bytes).decode("ascii")
                if encoded_key not in (canonical_key, canonical_standard_key):
                    raise ValueError("MEK key material is not canonical base64")
                jwk_config["k"] = canonical_key
                parsed_meks[mek_id] = jwk.JWK.from_json(
                    json.dumps(jwk_config, separators=(",", ":"), sort_keys=True)
                )
                fingerprints[mek_id] = hashlib.sha256(key_bytes).hexdigest()
            except (
                UnicodeError,
                ValueError,
                TypeError,
                binascii.Error,
                jwk.InvalidJWKValue,
            ):
                raise osmo_errors.OSMOError(f"MEK {mek_id} is invalid.") from None

        if len(set(fingerprints.values())) != len(fingerprints):
            raise osmo_errors.OSMOError("Each MEK identifier must contain unique key material.")

        if current_mek_id not in parsed_meks:
            raise osmo_errors.OSMOError(f"currentMek {current_mek_id} is not in meks.")

        descriptor = json.dumps(
            {
                "currentMek": current_mek_id,
                "mekIds": sorted(parsed_meks),
            },
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")
        return (
            Keyring(
                current_mek_id=current_mek_id,
                meks=MappingProxyType(parsed_meks),
                fingerprints=MappingProxyType(fingerprints),
                generation=hashlib.sha256(descriptor).hexdigest()[:16],
            ),
            signature,
        )

    def _validate_transition(self, candidate: Keyring) -> None:
        previous = self._keyring
        previous_ids = set(previous.meks)
        candidate_ids = set(candidate.meks)
        retained_ids = previous_ids & candidate_ids
        changed_ids = {
            mek_id
            for mek_id in retained_ids
            if previous.fingerprints[mek_id] != candidate.fingerprints[mek_id]
        }
        if changed_ids:
            raise osmo_errors.OSMOError(
                f"MEK material changed for existing ids: {sorted(changed_ids)}."
            )

        added_ids = candidate_ids - previous_ids
        removed_ids = previous_ids - candidate_ids
        current_changed = candidate.current_mek_id != previous.current_mek_id
        if removed_ids:
            raise osmo_errors.OSMOError(
                f"MEK removal is not supported; retain keys: {sorted(removed_ids)}."
            )
        if added_ids and current_changed and added_ids != {candidate.current_mek_id}:
            raise osmo_errors.OSMOError(
                "MEK activation may add only its already-registered currentMek."
            )
        if added_ids and not current_changed:
            if self.prepare_meks is None or not self.prepare_meks(candidate.fingerprints):
                raise osmo_errors.OSMOError(
                    "MEK prepare conflicts with the registered key material."
                )
        if (
            current_changed
            and (
                self.can_activate_mek is None
                or not self.can_activate_mek(
                    candidate.fingerprints,
                    candidate.current_mek_id,
                )
            )
        ):
            raise osmo_errors.OSMOError(
                "MEK activation does not match a prepared database key."
            )

    def _validate_jwe_header(self, header: Mapping[str, object]) -> str:
        if header.get("alg") != self.alg or header.get("enc") != self.enc:
            raise osmo_errors.OSMOError("Encrypted secret uses an unsupported JWE algorithm.")
        kid = header.get("kid")
        if (
            not isinstance(kid, str)
            or not kid
            or len(kid) > MAX_MEK_ID_LENGTH
            or not MEK_ID_PATTERN.fullmatch(kid)
        ):
            raise osmo_errors.OSMOError("Encrypted secret does not contain a valid kid.")
        return kid

    def reload_if_changed(self, retry_pending: bool = True) -> bool:
        """Atomically adopt a safe kubelet-projected keyring revision."""
        with self._reload_lock:
            signature = None
            try:
                signature = self._stat_file()
                with self._keyring_lock:
                    if signature == self._file_signature:
                        self._rejected_file_signature = None
                        self._pending_file_signature = None
                        self._pending_keyring = None
                        self._last_reload_error = ""
                        return False
                    if signature == self._rejected_file_signature:
                        return False
                    candidate = (
                        self._pending_keyring
                        if signature == self._pending_file_signature
                        else None
                    )
                    if candidate is not None and not retry_pending:
                        return False
                if candidate is None:
                    try:
                        for _ in range(3):
                            candidate, read_signature = self._read_keyring()
                            current_signature = self._stat_file()
                            if read_signature == signature == current_signature:
                                break
                            # Kubelet switches projected Secrets by replacing the ..data symlink.
                            # Retry until the path and open descriptor identify one revision.
                            signature = current_signature
                        else:
                            raise osmo_errors.OSMOError(
                                f"MEK file {self.mek_file} changed repeatedly while being read."
                            )
                    except (OSError, osmo_errors.OSMOError) as error:
                        with self._keyring_lock:
                            self._rejected_file_signature = signature
                            self._reload_failure_revision += 1
                            self._last_reload_error = str(error)
                        return False
                try:
                    # Persistence callbacks intentionally run without the
                    # keyring lock so crypto can continue using the LKG.
                    self._validate_transition(candidate)
                except osmo_errors.OSMOError as error:
                    with self._keyring_lock:
                        if signature != self._pending_file_signature:
                            self._reload_failure_revision += 1
                        self._pending_file_signature = signature
                        self._pending_keyring = candidate
                        self._last_reload_error = str(error)
                    return False
                if self._stat_file() != signature:
                    return False
                with self._keyring_lock:
                    self._keyring = candidate
                    self._file_signature = signature
                    self._rejected_file_signature = None
                    self._pending_file_signature = None
                    self._pending_keyring = None
                    self._last_reload_error = ""
                    return True
            except (OSError, osmo_errors.OSMOError) as error:
                with self._keyring_lock:
                    if str(error) != self._last_reload_error:
                        self._reload_failure_revision += 1
                    self._last_reload_error = str(error)
                return False

    def get_mek(self, kid: str = "") -> jwk.JWK:
        """Returns master key according to kid. Returns the current master key if kid is empty"""
        self.reload_if_changed(retry_pending=False)
        with self._keyring_lock:
            if not kid:
                kid = self.current_mek_id
            if kid not in self.meks:
                raise osmo_errors.OSMONotFoundError(f"Cannot find mek whose kid is {kid}.")
            return self.meks[kid]

    def get_uek(self, uid: str, kid: str = "") -> Tuple[jwk.JWK, bool]:
        """Returns user key according to kid and uid. Returns master key if uid is empty.
        Returns current user key if kid is empty"""
        self.reload_if_changed(retry_pending=False)
        with self._keyring_lock:
            if not uid:
                is_current = not kid or kid == self.current_mek_id
                selected_kid = kid or self._keyring.current_mek_id
                if selected_kid not in self._keyring.meks:
                    raise osmo_errors.OSMONotFoundError(
                        f"Cannot find mek whose kid is {selected_kid}.")
                return (self._keyring.meks[selected_kid], is_current)

        # Get Encrypted UEK
        try:
            current_kid = self.read_current_kid(uid)
            if not kid:
                kid = current_kid
            is_current = kid == current_kid
            uek_jwe = self.read_uek(uid, kid)
            jwetoken = jwe.JWE()
            jwetoken.deserialize(uek_jwe)
            mek_kid = self._validate_jwe_header(jwetoken.jose_header)

        except Exception as exc:
            raise osmo_errors.OSMOError(f"Cannot find user key for user {uid}.") from exc
        # Snapshot immutable keys while locked; database callbacks and crypto run outside it.
        with self._keyring_lock:
            if mek_kid not in self._keyring.meks:
                raise osmo_errors.OSMONotFoundError(
                    f"Cannot find mek whose kid is {mek_kid}.")
            mek = self._keyring.meks[mek_kid]
            current_mek_id = self._keyring.current_mek_id
            current_mek = self._keyring.meks[current_mek_id]
        jwetoken.decrypt(mek)

        jwk_json = jwetoken.payload.decode("utf-8")
        user_key = jwk.JWK.from_json(jwk_json)
        if user_key.key_id != kid:
            raise osmo_errors.OSMOError(
                f"User key wrapper for user {uid} does not match slot {kid}."
            )

        # Re-encrypt uek if not using the latest MEK
        if mek_kid != current_mek_id:
            new_jwe = jwe.JWE(
                jwetoken.payload,
                json_encode({"alg": self.alg, "enc": self.enc, "kid": current_mek_id}),
            )
            new_jwe.add_recipient(current_mek)
            updated = self.write_uek(uid, kid, new_jwe.serialize(True), uek_jwe)
            if not updated:
                # A concurrent reader may already have rewrapped this UEK. Re-read so callers do
                # not mistake an unrelated CAS loss for a successful migration.
                replacement = self.read_uek(uid, kid)
                replacement_jwe = jwe.JWE()
                try:
                    replacement_jwe.deserialize(replacement)
                    replacement_mek_id = self._validate_jwe_header(
                        replacement_jwe.jose_header)
                    self.reload_if_changed(retry_pending=False)
                    with self._keyring_lock:
                        replacement_current_id = self._keyring.current_mek_id
                        replacement_mek = self._keyring.meks.get(replacement_mek_id)
                    if replacement_mek_id != replacement_current_id or replacement_mek is None:
                        raise osmo_errors.OSMOError(
                            f"Concurrent UEK update for user {uid} did not use the current MEK."
                        )
                    replacement_jwe.decrypt(replacement_mek)
                    replacement_key = jwk.JWK.from_json(
                        replacement_jwe.payload.decode("utf-8"))
                    if (
                        replacement_key.key_id != kid
                        or replacement_key.export(as_dict=True) != user_key.export(as_dict=True)
                    ):
                        raise osmo_errors.OSMOError(
                            f"Concurrent UEK update for user {uid} changed the key payload."
                        )
                except (JWException, UnicodeError, ValueError, jwk.InvalidJWKValue) as error:
                    raise osmo_errors.OSMOError(
                        f"Concurrent UEK update for user {uid} failed authentication."
                    ) from error

        return (user_key, is_current)

    def generate_uek(self) -> jwk.JWK:
        kid = uuid.uuid4().hex
        return jwk.JWK.generate(kty="oct", size=256, kid=kid)

    def authenticate_mek_encrypted(self, value: str) -> str:
        """Authenticate direct-MEK ciphertext without exposing its plaintext."""
        self.reload_if_changed(retry_pending=False)
        try:
            if value.count(".") != 4:
                raise ValueError("ciphertext is not compact JWE")
            token = jwe.JWE()
            token.deserialize(value)
            key_id = self._validate_jwe_header(token.jose_header)
            with self._keyring_lock:
                if key_id not in self._keyring.meks:
                    raise osmo_errors.OSMONotFoundError(
                        f"Cannot find mek whose kid is {key_id}.")
                mek = self._keyring.meks[key_id]
            token.decrypt(mek)
            token.payload.decode("utf-8")
            return key_id
        except (JWException, UnicodeError, ValueError, osmo_errors.OSMOError) as error:
            raise osmo_errors.OSMOError(
                "Persisted direct-MEK ciphertext failed authentication."
            ) from error

    def authenticate_uek_wrapper(self, value: str, expected_uek_id: str = "") -> str:
        """Authenticate a persisted UEK wrapper and validate its JWK payload."""
        self.reload_if_changed(retry_pending=False)
        try:
            if value.count(".") != 4:
                raise ValueError("ciphertext is not compact JWE")
            token = jwe.JWE()
            token.deserialize(value)
            key_id = self._validate_jwe_header(token.jose_header)
            with self._keyring_lock:
                if key_id not in self._keyring.meks:
                    raise osmo_errors.OSMONotFoundError(
                        f"Cannot find mek whose kid is {key_id}.")
                mek = self._keyring.meks[key_id]
            token.decrypt(mek)
            user_key = jwk.JWK.from_json(token.payload.decode("utf-8"))
            exported = user_key.export(as_dict=True)
            if exported.get("kty") != "oct" or not exported.get("kid"):
                raise ValueError("invalid UEK JWK")
            if expected_uek_id and exported["kid"] != expected_uek_id:
                raise ValueError("UEK JWK does not match its persisted slot")
            padding = "=" * (-len(exported["k"]) % 4)
            key_bytes = base64.b64decode(exported["k"] + padding, altchars=b"-_", validate=True)
            if len(key_bytes) != 32:
                raise ValueError("invalid UEK size")
            return key_id
        except (
            JWException,
            UnicodeError,
            ValueError,
            TypeError,
            binascii.Error,
            jwk.InvalidJWKValue,
            osmo_errors.OSMOError,
        ) as error:
            raise osmo_errors.OSMOError("Persisted UEK wrapper failed authentication.") from error

    def add_new_user(self, uid: str):
        """Add uek for a new user"""
        self.reload_if_changed(retry_pending=False)
        with self._keyring_lock:
            uek = self.generate_uek()
            mek = self._keyring.meks[self._keyring.current_mek_id]

            # Encrypt uek by mek
            jwetoken = jwe.JWE(
                uek.export().encode("utf-8"),
                json_encode({"alg": self.alg, "enc": self.enc, "kid": mek.key_id}),
            )
            jwetoken.add_recipient(mek)

            ueks = {"current": uek.key_id, uek.key_id: jwetoken.serialize(True)}
        self.add_user(uid, ueks)

    def encrypt(self, plain_text: str, uid: str) -> Encrypted:
        """Encrypts the plain_text using current user key. Use the master key if uid is empty."""
        uek, _ = self.get_uek(uid)
        jwetoken = jwe.JWE(
            plain_text.encode("utf-8"),
            json_encode({"alg": self.alg, "enc": self.enc, "kid": uek.key_id}),
        )

        jwetoken.add_recipient(uek)
        enc = Encrypted(jwetoken.serialize(True))
        return enc

    def decrypt(self, enc: Encrypted, uid: str, update_secret: Callable[[str], None]) -> Decrypted:
        """Decrypts a given encrypted secret `enc`. If the user secret is not current, run command
        `cmd` to update the re-encrypted secret.

        Args:
            enc (Encrypted): encrypted secret
            uid (str): user id. If empty, use the master key to encrypt.
            update_secret (Callable[[str], None]): function to update secret.

        Returns:
            Decrpted: Decrypted secret
        """
        jwetoken = jwe.JWE()
        jwetoken.deserialize(enc.value)
        kid = self._validate_jwe_header(jwetoken.jose_header)
        uek, is_current = self.get_uek(uid, kid)
        jwetoken.decrypt(uek)
        decrypted = jwetoken.payload.decode("utf-8")

        if not is_current:
            current_uek, _ = self.get_uek(uid)
            new_jwe = jwe.JWE(
                decrypted.encode("utf-8"),
                json_encode({"alg": self.alg, "enc": self.enc, "kid": current_uek.key_id}),
            )
            new_jwe.add_recipient(current_uek)
            re_encrypted = new_jwe.serialize(True)
            update_secret(re_encrypted)

        return Decrypted(decrypted)

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
import os
from typing import Callable, Dict, Tuple
import uuid

from jwcrypto import jwk, jwe # type: ignore
from jwcrypto.common import json_encode # type: ignore
import yaml

from src.lib.utils import osmo_errors


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
        return 'xxxxx'

class SecretManager:
    """Class to read and write encrypted user secrets to postgres"""
    def __init__(self, mek_file: str, read_uek: Callable[[str, str], str],
                 write_uek: Callable[[str, str, str, str], None],
                 read_current_kid: Callable[[str], str], add_user: Callable[[str, Dict], None],
                 alg: str = 'A256GCMKW', enc: str = 'A256GCM',):
        """Constructor

        Args:
            mek_file (str): A yaml file that stores master keys. The format is as follows:
                currentMek: mek0
                meks:
                    mek0: base64 encoded JWK
                    mek1: base64 encoded JWK
            read_uek (Callable[[str, str], str]): A function to read encrypted uek.
                `read_uek(uid, kid)` will be called to read the uek.
            write_uek (Callable[[str, str, str, str], None]): A function to write encrypted uek.
                `write_uek(uid, kid, new_uek, old_uek)` will be called to re-encrypt uek.
            read_current_kid (Callable[[str], str]): A function to get current uek kid.
                `read_current_kid(uid)` will be called to get current kid.
            add_user (Callable[[str, Dict], None]): A function to insert new uek.
                `add_user(uid, {'current': current_kid, current_kid: encrypted_key})` will be
                called to add new uek.
            alg (str, optional): Cryptographic algorithm used to encrypt or determine the value of
                the content encryption key. Defaults to 'A256GCMKW'.
            enc (str, optional): Content encryption algorithm used to encrypt plain text.
                Defaults to 'A256GCM'.
        """
        self.alg = alg
        self.enc = enc
        self.meks = {}
        self.current_mek_id = ''
        self.read_uek = read_uek
        self.write_uek = write_uek
        self.read_current_kid = read_current_kid
        self.add_user = add_user

        if not os.path.isfile(mek_file):
            raise osmo_errors.OSMOError(f'MEK file {mek_file} does not exist.')
        with open(mek_file, 'r', encoding='utf-8') as fp:
            meks = yaml.safe_load(fp)

        self.current_mek_id = meks['currentMek']
        for kid, jwk_encoded in meks['meks'].items():
            jwk_json = base64.b64decode(jwk_encoded.encode('utf-8')).decode('utf-8')
            self.meks[kid] = jwk.JWK.from_json(jwk_json)

    def get_mek(self, kid: str = '') -> jwk.JWK:
        """Returns master key according to kid. Returns the current master key if kid is empty"""
        if not kid:
            kid = self.current_mek_id
        if kid not in self.meks:
            raise osmo_errors.OSMONotFoundError(f'Cannot find mek whose kid is {kid}.')
        return self.meks[kid]

    def get_uek(self, uid: str, kid: str = '') -> Tuple[jwk.JWK, bool]:
        """Returns user key according to kid and uid. Returns master key if uid is empty.
        Returns current user key if kid is empty"""
        if not uid:
            return (self.get_mek(kid), True)

        # Get Encrypted UEK
        try:
            current_kid = self.read_current_kid(uid)
            if not kid:
                kid = current_kid
            is_current = kid == current_kid
            uek_jwe = self.read_uek(uid, kid)
            jwetoken = jwe.JWE()
            jwetoken.deserialize(uek_jwe)
            mek_kid = jwetoken.jose_header['kid']

        except Exception as exc:
            raise osmo_errors.OSMOError(f'Cannot find user key for user {uid}.') from exc
        # Get MEK
        mek = self.get_mek(mek_kid)
        jwetoken.decrypt(mek)

        jwk_json = jwetoken.payload.decode('utf-8')

        # Re-encrypt uek if not using the latest MEK
        if mek_kid != self.current_mek_id:
            new_jwe = jwe.JWE(
                jwetoken.payload,
                json_encode({'alg': self.alg, 'enc': self.enc, 'kid': self.current_mek_id}))
            current_mek = self.get_mek()
            new_jwe.add_recipient(current_mek)
            self.write_uek(uid, kid, new_jwe.serialize(True), uek_jwe)

        return (jwk.JWK.from_json(jwk_json), is_current)

    def generate_uek(self) -> jwk.JWK:
        kid = uuid.uuid4().hex
        return jwk.JWK.generate(kty='oct', size=256, kid=kid)

    def add_new_user(self, uid: str):
        """Add uek for a new user"""
        uek = self.generate_uek()
        mek = self.get_mek()

        # Encrypt uek by mek
        jwetoken = jwe.JWE(
            uek.export().encode('utf-8'),
            json_encode({'alg': self.alg, 'enc': self.enc, 'kid': mek.key_id}))
        jwetoken.add_recipient(mek)

        ueks = {'current': uek.key_id, uek.key_id: jwetoken.serialize(True)}
        self.add_user(uid, ueks)

    def encrypt(self, plain_text: str, uid: str) -> Encrypted:
        """Encrypts the plain_text using current user key. Use the master key if uid is empty."""
        uek, _ = self.get_uek(uid)
        jwetoken = jwe.JWE(
            plain_text.encode('utf-8'),
            json_encode({'alg': self.alg, 'enc': self.enc, 'kid': uek.key_id}))

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
        kid = jwetoken.jose_header['kid']
        uek, is_current = self.get_uek(uid, kid)
        jwetoken.decrypt(uek)
        decrypted = jwetoken.payload.decode('utf-8')

        if not is_current:
            # Re-encrypt the secret
            current_uek, _ = self.get_uek(uid)
            new_jwe = jwe.JWE(
                decrypted.value.encode('utf-8'),
                json_encode({'alg': self.alg, 'enc': self.enc, 'kid': current_uek.key_id}))
            new_jwe.add_recipient(current_uek)
            re_encrypted = new_jwe.serialize(True)
            update_secret(re_encrypted)

        return Decrypted(decrypted)

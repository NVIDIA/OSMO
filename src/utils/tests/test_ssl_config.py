"""
SPDX-FileCopyrightText: NVIDIA CORPORATION
Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.

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
import datetime
import os
import socket
import ssl
import stat
import unittest

from cryptography import x509
import pydantic

from src.utils import ssl_config


class TestSSLConfigKwargs(unittest.TestCase):
    """uvicorn_ssl_kwargs() picks the right mode for the given fields."""

    def test_no_tls_returns_empty_kwargs(self):
        cfg = ssl_config.SSLConfig()
        self.assertEqual(cfg.uvicorn_ssl_kwargs(), {})

    def test_explicit_paths_pass_through(self):
        cfg = ssl_config.SSLConfig(ssl_keyfile='/etc/k.pem', ssl_certfile='/etc/c.pem')
        self.assertEqual(cfg.uvicorn_ssl_kwargs(),
                         {'ssl_keyfile': '/etc/k.pem', 'ssl_certfile': '/etc/c.pem'})

    def test_only_keyfile_set_raises(self):
        # Half-configured TLS is the kind of bug that silently degrades a
        # production listener to plain HTTP; the validator must fail loudly.
        with self.assertRaisesRegex(pydantic.ValidationError, 'ssl_certfile'):
            ssl_config.SSLConfig(ssl_keyfile='/etc/k.pem')

    def test_only_certfile_set_raises(self):
        with self.assertRaisesRegex(pydantic.ValidationError, 'ssl_keyfile'):
            ssl_config.SSLConfig(ssl_certfile='/etc/c.pem')

    def test_self_signed_with_explicit_paths_raises(self):
        # Specifying both modes is ambiguous — pick one. Reject early so the
        # operator notices instead of guessing which mode wins.
        with self.assertRaisesRegex(pydantic.ValidationError, 'ssl_self_signed'):
            ssl_config.SSLConfig(ssl_self_signed=True,
                                 ssl_keyfile='/etc/k.pem',
                                 ssl_certfile='/etc/c.pem')

    def test_self_signed_with_just_keyfile_raises(self):
        # Conflict-detection should fire even when the on-disk pair is itself
        # incomplete; otherwise the user gets two confusing errors instead of
        # one pointing at the conflict.
        with self.assertRaises(pydantic.ValidationError):
            ssl_config.SSLConfig(ssl_self_signed=True, ssl_keyfile='/etc/k.pem')

    def test_self_signed_returns_real_paths(self):
        cfg = ssl_config.SSLConfig(ssl_self_signed=True)
        kwargs = cfg.uvicorn_ssl_kwargs()
        self.assertIn('ssl_keyfile', kwargs)
        self.assertIn('ssl_certfile', kwargs)
        self.assertTrue(os.path.isfile(kwargs['ssl_keyfile']))
        self.assertTrue(os.path.isfile(kwargs['ssl_certfile']))


class TestEphemeralSelfSigned(unittest.TestCase):
    """_mint_ephemeral_self_signed produces a usable cert/key pair on disk."""

    def setUp(self):
        self.keyfile, self.certfile = ssl_config._mint_ephemeral_self_signed()

    def test_files_exist_and_are_nonempty(self):
        self.assertTrue(os.path.isfile(self.keyfile))
        self.assertTrue(os.path.isfile(self.certfile))
        self.assertGreater(os.path.getsize(self.keyfile), 0)
        self.assertGreater(os.path.getsize(self.certfile), 0)

    def test_cert_pem_parses_as_x509(self):
        with open(self.certfile, 'rb') as f:
            cert = x509.load_pem_x509_certificate(f.read())
        self.assertIsInstance(cert, x509.Certificate)

    def test_cert_has_expected_sans(self):
        with open(self.certfile, 'rb') as f:
            cert = x509.load_pem_x509_certificate(f.read())
        san_ext = cert.extensions.get_extension_for_class(x509.SubjectAlternativeName)
        dns_names = san_ext.value.get_values_for_type(x509.DNSName)
        ip_addrs = [str(ip) for ip in san_ext.value.get_values_for_type(x509.IPAddress)]
        # Hostname (CN) and the standard loopback aliases must be present so
        # local probes (cluster-internal HTTPS, sidecar self-checks) get a
        # name match. Envoy with common_tls_context: {} ignores SANs anyway.
        self.assertIn(socket.gethostname() or 'localhost', dns_names)
        self.assertIn('localhost', dns_names)
        self.assertIn('127.0.0.1', ip_addrs)

    def test_cert_is_not_a_ca(self):
        with open(self.certfile, 'rb') as f:
            cert = x509.load_pem_x509_certificate(f.read())
        bc = cert.extensions.get_extension_for_class(x509.BasicConstraints)
        self.assertFalse(bc.value.ca)

    def test_cert_validity_window_includes_now(self):
        with open(self.certfile, 'rb') as f:
            cert = x509.load_pem_x509_certificate(f.read())
        now = datetime.datetime.now(datetime.timezone.utc)
        self.assertLess(cert.not_valid_before_utc, now)
        self.assertGreater(cert.not_valid_after_utc, now)

    def test_keyfile_is_not_world_readable(self):
        # Private key must be 0600 (only owner can read). Any group/other
        # access on a private key would be a regression.
        mode = stat.S_IMODE(os.stat(self.keyfile).st_mode)
        self.assertEqual(mode & 0o077, 0,
                         f'keyfile permissions {oct(mode)} grant access beyond owner')

    def test_cert_loads_into_uvicorn_style_ssl_context(self):
        # This is the exact call uvicorn makes internally; if it fails here
        # uvicorn would fail at startup. Doubles as an end-to-end sanity check.
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(certfile=self.certfile, keyfile=self.keyfile)

    def test_each_call_produces_a_unique_cert(self):
        # Ephemerality matters — every process start should mint a fresh cert
        # rather than reusing one across pods.
        keyfile2, certfile2 = ssl_config._mint_ephemeral_self_signed()
        self.assertNotEqual(self.keyfile, keyfile2)
        self.assertNotEqual(self.certfile, certfile2)
        with open(self.certfile, 'rb') as f:
            cert1 = x509.load_pem_x509_certificate(f.read())
        with open(certfile2, 'rb') as f:
            cert2 = x509.load_pem_x509_certificate(f.read())
        self.assertNotEqual(cert1.serial_number, cert2.serial_number)
        self.assertNotEqual(cert1.public_key().public_numbers(),
                            cert2.public_key().public_numbers())


if __name__ == '__main__':
    unittest.main()

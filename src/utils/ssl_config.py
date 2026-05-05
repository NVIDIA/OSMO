"""
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved. # pylint: disable=line-too-long

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

TLS/SSL configuration for services that listen on a uvicorn port. Lives in
its own module (rather than next to StaticConfig) because it pulls in the
`cryptography` package, and small utility binaries that only need
StaticConfig (e.g. progress_check) shouldn't have to bundle that dep.
"""

import datetime
import ipaddress
import os
import socket
import tempfile
from typing import Any, Dict, Optional, Tuple

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import NameOID
import pydantic


class SSLConfig(pydantic.BaseModel):
    """TLS/SSL configuration for the uvicorn listener.

    Three modes, picked by which flags are set:

    1. ssl_self_signed=True
       The process mints a fresh ECDSA P-256 cert at startup, writes it to a
       temp dir, and points uvicorn at it. The cert is per-process and lives
       only as long as the container. Used by the chart's default
       gateway.tls.enabled mode where Envoy connects with TLS but does not
       validate the upstream cert (common_tls_context: {}). No CA management,
       no Secret rotation, no init container needed.

    2. ssl_keyfile and ssl_certfile point at on-disk PEMs (e.g. mounted from
       a cert-manager-managed Secret). The process serves HTTPS using the
       provided cert. Used when the chart is in cert-manager mode.

    3. None set: plain HTTP.
    """
    ssl_keyfile: Optional[str] = pydantic.Field(
        default=None,
        description='Path to a PEM-encoded private key. If set together with '
                    'ssl_certfile, the service serves HTTPS instead of HTTP.',
        json_schema_extra={'command_line': 'ssl_keyfile', 'env': 'OSMO_SSL_KEYFILE'})
    ssl_certfile: Optional[str] = pydantic.Field(
        default=None,
        description='Path to a PEM-encoded certificate (server leaf, optionally '
                    'chained). Required together with ssl_keyfile.',
        json_schema_extra={'command_line': 'ssl_certfile', 'env': 'OSMO_SSL_CERTFILE'})
    ssl_self_signed: bool = pydantic.Field(
        default=False,
        description='Generate an ephemeral self-signed cert in-process and '
                    'serve HTTPS with it. The cert is regenerated on every '
                    'process start. Useful when the consumer (e.g. the OSMO '
                    'gateway) wants encryption-without-validation.',
        json_schema_extra={'command_line': 'ssl_self_signed',
                           'env': 'OSMO_SSL_SELF_SIGNED'})

    @pydantic.model_validator(mode='after')
    def _validate_ssl_combination(self) -> 'SSLConfig':
        """Reject incomplete or conflicting TLS settings at config-load time.

        Silently falling back to HTTP when one of these is misconfigured leads
        to confusing failures later (Envoy talks TLS to a plain-HTTP listener,
        clients hit unexpected redirects, etc.). Fail fast instead so the
        operator sees the problem at startup.
        """
        explicit_paths = bool(self.ssl_keyfile) or bool(self.ssl_certfile)
        both_paths = bool(self.ssl_keyfile) and bool(self.ssl_certfile)

        # Incomplete: exactly one of keyfile/certfile.
        if explicit_paths and not both_paths:
            missing = 'ssl_certfile' if self.ssl_keyfile else 'ssl_keyfile'
            raise ValueError(
                f'TLS misconfigured: ssl_keyfile and ssl_certfile must be set '
                f'together; missing {missing}. Set both to enable TLS, or '
                f'unset both to serve plain HTTP.')

        # Conflicting: self-signed mode plus explicit on-disk paths.
        if self.ssl_self_signed and explicit_paths:
            raise ValueError(
                'TLS misconfigured: ssl_self_signed cannot be combined with '
                'explicit ssl_keyfile/ssl_certfile. Pick one mode — set '
                'ssl_self_signed=true to mint an ephemeral cert in-process, '
                'or provide ssl_keyfile + ssl_certfile to use on-disk PEMs.')

        return self

    def uvicorn_ssl_kwargs(self) -> Dict[str, Any]:
        """Return uvicorn keyword args for TLS, or an empty dict if TLS is off.

        The validator above guarantees we're in exactly one of three states:
        all-unset (HTTP), self-signed-only, or both paths set.
        """
        if self.ssl_self_signed:
            keyfile, certfile = _mint_ephemeral_self_signed()
            return {'ssl_keyfile': keyfile, 'ssl_certfile': certfile}
        if self.ssl_keyfile and self.ssl_certfile:
            return {'ssl_keyfile': self.ssl_keyfile, 'ssl_certfile': self.ssl_certfile}
        return {}


def _mint_ephemeral_self_signed() -> Tuple[str, str]:
    """Generate an ECDSA P-256 self-signed cert and write it to a temp dir.

    Returns (keyfile_path, certfile_path). uvicorn opens both at startup and
    parses them into an in-memory SSLContext, so the files only need to exist
    long enough for ssl.SSLContext.load_cert_chain() to read them. We don't
    bother deleting them; the temp dir goes away when the container exits.

    SANs include the pod hostname so anything that DOES validate (e.g. a
    cluster-internal probe with HTTPS scheme) gets a name match. Envoy with
    common_tls_context: {} ignores SANs entirely.
    """
    private_key = ec.generate_private_key(ec.SECP256R1())
    hostname = socket.gethostname() or 'localhost'
    subject = issuer = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, hostname)])

    san_entries: list[x509.GeneralName] = [
        x509.DNSName(hostname),
        x509.DNSName('localhost'),
        x509.IPAddress(ipaddress.ip_address('127.0.0.1')),
    ]

    now = datetime.datetime.now(datetime.timezone.utc)
    cert = (x509.CertificateBuilder()
            .subject_name(subject)
            .issuer_name(issuer)
            .public_key(private_key.public_key())
            .serial_number(x509.random_serial_number())
            .not_valid_before(now - datetime.timedelta(minutes=5))
            .not_valid_after(now + datetime.timedelta(days=365))
            .add_extension(x509.SubjectAlternativeName(san_entries), critical=False)
            .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
            .sign(private_key, hashes.SHA256()))

    tmpdir = tempfile.mkdtemp(prefix='osmo-tls-')
    keyfile_path = os.path.join(tmpdir, 'tls.key')
    certfile_path = os.path.join(tmpdir, 'tls.crt')
    with open(keyfile_path, 'wb') as f:
        f.write(private_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption()))
        os.chmod(keyfile_path, 0o600)
    with open(certfile_path, 'wb') as f:
        f.write(cert.public_bytes(serialization.Encoding.PEM))
    return keyfile_path, certfile_path

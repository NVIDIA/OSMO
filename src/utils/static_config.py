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

import argparse
import datetime
import ipaddress
import os
import socket
import sys
import tempfile
import typing
from typing import Any, ClassVar, Dict, Optional

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import NameOID
import pydantic
from pydantic.fields import FieldInfo
import yaml


def _get_field_extras(field: FieldInfo) -> Dict[str, Any]:
    """Get json_schema_extra as a dict, handling Callable and None cases."""
    extra = field.json_schema_extra
    if isinstance(extra, dict):
        return extra
    return {}


class SSLConfig(pydantic.BaseModel):
    """TLS/SSL configuration for the uvicorn listener.

    Two modes, picked by which flags are set:

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

    With neither set, the listener serves plain HTTP.
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

    def uvicorn_ssl_kwargs(self) -> Dict[str, Any]:
        """Return uvicorn keyword args for TLS, or an empty dict if TLS is off."""
        if self.ssl_self_signed:
            keyfile, certfile = _mint_ephemeral_self_signed()
            return {'ssl_keyfile': keyfile, 'ssl_certfile': certfile}
        if self.ssl_keyfile and self.ssl_certfile:
            return {'ssl_keyfile': self.ssl_keyfile, 'ssl_certfile': self.ssl_certfile}
        return {}


def _mint_ephemeral_self_signed() -> tuple[str, str]:
    """Generate an ECDSA P-256 self-signed cert and write it to a temp dir.

    Returns (keyfile_path, certfile_path). uvicorn opens both at startup and
    parses them into an in-memory SSLContext, so the files only need to exist
    long enough for uvicorn's ssl.SSLContext.load_cert_chain() call. We don't
    bother deleting them because the temp dir goes away when the container
    exits.

    SANs include the pod hostname so anything that DOES validate (e.g. a
    cluster-internal probe with HTTPS scheme) gets a name match. Envoy with
    common_tls_context: {} ignores SANs entirely.
    """
    private_key = ec.generate_private_key(ec.SECP256R1())
    hostname = socket.gethostname() or 'localhost'
    subject = issuer = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, hostname)])

    san_entries: list[x509.GeneralName] = [x509.DNSName(hostname), x509.DNSName('localhost')]
    san_entries.append(x509.IPAddress(ipaddress.ip_address('127.0.0.1')))

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


class StaticConfig(pydantic.BaseModel):
    """ A class for reading in config information from either command line, files,
    or environment variables """
    _instance: ClassVar[Optional[Any]] = None
    @classmethod
    def load(cls):
        if cls._instance is not None:
            return cls._instance

        # First, build the argument parser, add an argument for each field in the config that
        # supports "command_line"
        parser = argparse.ArgumentParser()
        parser.add_argument('--config', action='append', default=[],
                            help='The yaml file from which to load configuration data. Multiple ' \
                                 'files may be specified by including this argument multiple ' \
                                 'times. If a config parameter is duplicated in more than one ' \
                                 'file, the value in the last file is used.')

        for _, field in cls.model_fields.items():
            extras = _get_field_extras(field)
            if 'command_line' in extras:
                help_message = field.description or ''
                if field.default is not None:
                    help_message += f' (default: {field.default!s})'
                parser.add_argument(f'--{extras['command_line']}',
                                    action=extras.get('action', 'store'),
                                    help=help_message)
        args = parser.parse_args()

        # Initialize config with default values
        config = {}
        for name, field in cls.model_fields.items():
            # If the default is None and its not optional, then dont set the default because the
            # user must provide this value
            if not field.is_required():
                config[name] = field.default

        # Load any config files. The later files override anything from the earlier files
        for config_file in args.config:
            with open(config_file, encoding='utf-8') as file:
                config.update(yaml.safe_load(file))
            for key in config:
                if key not in cls.model_fields.keys():
                    raise ValueError(f'Unrecognized key "{key}" in config file {config_file}')
        args_dict = vars(args)
        args_dict.pop('config')

        # Now, make sure each field is set, picking from the following priority
        # 1. Environment variable
        # 2. Command line argument
        # 3. Config file
        # 4. Default
        for name, field in cls.model_fields.items():
            extras = _get_field_extras(field)
            env_name = extras.get('env')
            arg_name = extras.get('command_line')
            is_list = typing.get_origin(field.annotation) is list
            # Do we have an environment variable? If so, use that
            if env_name is not None and env_name in os.environ:
                if is_list:
                    config[name] = os.environ[env_name].split(',')
                else:
                    config[name] = os.environ[env_name]
            # Do we have a command line value from Argparser?
            elif arg_name is not None and args_dict.get(arg_name) is not None:
                if is_list:
                    config[name] = args_dict[arg_name].split(',')
                else:
                    config[name] = args_dict[arg_name]

        try:
            cls._instance = cls(**config)
        except pydantic.ValidationError as error:
            # Parse through errors and print them in a more user friendly manner
            for type_error in error.errors():
                if type_error['type'] not in ('type_error.none.not_allowed', 'value_error.missing',
                                                 'missing', 'none_required'):
                    print(type_error)
                else:
                    field_name = str(type_error['loc'][0])
                    field = cls.model_fields[field_name]  # pylint: disable=E1136
                    extras = _get_field_extras(field)
                    print(f'ERROR: No value provided for config {field_name} ' \
                          'via any of the following methods:')
                    print(f'- Config file key: {field_name}')
                    if 'command_line' in extras:
                        command_line = extras['command_line']
                        print(f'- Command line argument: --{command_line}')
                    if 'env' in extras:
                        env = extras['env']
                        print(f'- Environment variable: {env}')
            sys.exit(1)
        return cls._instance

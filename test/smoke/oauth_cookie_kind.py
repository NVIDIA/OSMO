"""KIND coverage for the unified chart's embedded authentication lifecycle."""

# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long
# SPDX-License-Identifier: Apache-2.0

import base64
import hashlib
import html
import http.cookiejar
import json
import os
import re
import secrets
import socket
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
import unittest

from cryptography import x509

from test.oetf.smoke_fixture import SmokeFixture


def _environment_secret_bytes(random_bytes):
    return base64.urlsafe_b64encode(random_bytes).rstrip(b'=')


class _CallbackRedirect(Exception):

    def __init__(self, location):
        super().__init__('OAuth callback captured')
        self.location = location


class _LoopbackRedirectHandler(urllib.request.HTTPRedirectHandler):

    def __init__(self, callback_url):
        super().__init__()
        self.callback_url = callback_url

    def redirect_request(self, request, file_pointer, code, message, headers, new_url):
        if new_url.startswith(self.callback_url):
            raise _CallbackRedirect(new_url)
        return super().redirect_request(
            request, file_pointer, code, message, headers, new_url)


class EmbeddedDexKind(SmokeFixture):
    """Exercise generated credential rotation, retention, and fail-closed use."""

    @staticmethod
    def _run(command, expected_success=True, input_text=None):
        result = subprocess.run(
            command, check=False, capture_output=True, text=True, timeout=180,
            input=input_text)
        if (result.returncode == 0) != expected_success:
            command_text = " ".join(command)
            raise RuntimeError(
                f"{command_text} exited {result.returncode}: "
                f"{result.stderr.strip()}")
        return result

    @staticmethod
    def _chart_path():
        return os.path.join(
            os.environ["TEST_SRCDIR"], os.environ["TEST_WORKSPACE"],
            "deployments", "charts", "osmo")

    @staticmethod
    def _secret_data_identity(secret, key=None):
        digest = hashlib.sha256()
        keys = [key] if key else sorted(secret["data"])
        for current_key in keys:
            value = base64.b64decode(secret["data"][current_key], validate=True)
            digest.update(current_key.encode("utf-8"))
            digest.update(len(value).to_bytes(8, byteorder="big"))
            digest.update(value)
        return digest.hexdigest()

    @classmethod
    def _bootstrap_image(cls):
        configured_image = os.environ.get("OSMO_BOOTSTRAP_IMAGE")
        if configured_image:
            return configured_image
        osmo_namespace = os.environ.get("OSMO_NAMESPACE", "osmo")
        deployments = json.loads(cls._run([
            "kubectl", "--context", "kind-osmo", "--namespace", osmo_namespace,
            "get", "deployments", "-o", "json",
        ]).stdout)["items"]
        service_images = [
            container["image"]
            for deployment in deployments
            for container in deployment["spec"]["template"]["spec"]["containers"]
            if container.get("command") == ["service"]
        ]
        if len(service_images) != 1:
            raise RuntimeError(
                "Set OSMO_BOOTSTRAP_IMAGE to an OSMO service image containing "
                "the chart bootstrap commands")
        return service_images[0]

    @staticmethod
    def _related_image(image, component):
        image_prefix, separator, image_leaf = image.rpartition('/')
        if not separator or not (
            image_leaf.startswith('service:')
            or image_leaf.startswith('service@')
        ):
            raise RuntimeError(
                f'Cannot derive the {component} image from service image {image}')
        return f'{image_prefix}/{component}{image_leaf[len("service"):]}'

    @staticmethod
    def _component_image_values(image):
        image_name, digest_separator, digest = image.partition('@')
        registry, path_separator, repository_and_tag = image_name.partition('/')
        if not path_separator:
            raise RuntimeError(f'Component image must include a registry: {image}')
        repository, tag_separator, tag = repository_and_tag.rpartition(':')
        if not tag_separator:
            repository = repository_and_tag
            tag = ''
        return registry, repository, tag, digest if digest_separator else ''

    def _authenticate_embedded_admin(self, external_url, password):
        callback_url = 'http://127.0.0.1:33747/callback'
        verifier = base64.urlsafe_b64encode(
            secrets.token_bytes(48)).rstrip(b'=').decode('ascii')
        challenge = base64.urlsafe_b64encode(hashlib.sha256(
            verifier.encode('ascii')).digest()).rstrip(b'=').decode('ascii')
        state = secrets.token_urlsafe(24)
        authorization_url = external_url + '/dex/auth?' + urllib.parse.urlencode({
            'client_id': 'osmo-cli',
            'redirect_uri': callback_url,
            'response_type': 'code',
            'scope': 'openid profile email groups',
            'state': state,
            'code_challenge': challenge,
            'code_challenge_method': 'S256',
        })
        cookie_jar = http.cookiejar.CookieJar()
        opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(cookie_jar),
            _LoopbackRedirectHandler(callback_url),
        )
        login_page = None
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            try:
                with opener.open(authorization_url, timeout=5) as response:
                    login_page = response.read().decode('utf-8')
                break
            except (urllib.error.URLError, ConnectionError):
                time.sleep(1)
        if login_page is None:
            raise AssertionError('embedded Dex login did not become reachable')
        form = re.search(
            r'<form[^>]+action=["\']([^"\']+)["\']', login_page,
            flags=re.IGNORECASE)
        if form is None:
            raise AssertionError('embedded Dex login form was not rendered')
        login_url = urllib.parse.urljoin(
            authorization_url, html.unescape(form.group(1)))
        login_request = urllib.request.Request(
            login_url,
            data=urllib.parse.urlencode({
                'login': 'admin@osmo.local',
                'password': password.decode('ascii'),
            }).encode('ascii'),
            headers={'Content-Type': 'application/x-www-form-urlencoded'},
        )
        callback_location = None
        try:
            opener.open(login_request, timeout=10)
        except _CallbackRedirect as redirect:
            callback_location = redirect.location
        if callback_location is None:
            raise AssertionError('Dex did not redirect after login')
        callback_query = urllib.parse.parse_qs(
            urllib.parse.urlparse(callback_location).query)
        self.assertEqual([state], callback_query.get('state'))
        self.assertIn('code', callback_query)

        token_request = urllib.request.Request(
            external_url + '/dex/token',
            data=urllib.parse.urlencode({
                'grant_type': 'authorization_code',
                'code': callback_query['code'][0],
                'redirect_uri': callback_url,
                'client_id': 'osmo-cli',
                'code_verifier': verifier,
            }).encode('ascii'),
            headers={'Content-Type': 'application/x-www-form-urlencoded'},
        )
        with urllib.request.urlopen(token_request, timeout=10) as response:
            token_response = json.load(response)
        id_token = token_response['id_token']
        payload_part = id_token.split('.')[1]
        payload_part += '=' * (-len(payload_part) % 4)
        payload = json.loads(base64.urlsafe_b64decode(payload_part))
        self.assertEqual(
            'CiQwOGE4Njg0Yi1kYjg4LTRiNzMtOTBhOS0zY2QxNjYxZjU0NjYSBWxvY2Fs',
            payload['sub'])
        self.assertEqual(external_url + '/dex', payload['iss'])

        admin_request = urllib.request.Request(
            external_url + '/api/configs/pool',
            headers={'Authorization': 'Bearer ' + id_token},
        )
        authorization_deadline = time.monotonic() + 45
        while True:
            try:
                with urllib.request.urlopen(admin_request, timeout=10) as response:
                    status = response.status
                    response_body = ''
            except urllib.error.HTTPError as error:
                status = error.code
                response_body = error.read().decode('utf-8', errors='replace')
                error.close()
            if status != 401 or time.monotonic() >= authorization_deadline:
                break
            time.sleep(1)
        self.assertNotIn(
            status, (401, 403),
            'issued administrator identity was rejected by gateway authorization: '
            + response_body)

    @staticmethod
    def _stop_process(process):
        if process.poll() is not None:
            return
        process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=10)

    def test_embedded_dex_credential_helm_lifecycle(self):
        suffix = secrets.token_hex(4)
        namespace = f"embedded-dex-{suffix}"
        release = f"embedded-dex-{suffix}"
        chart = self._chart_path()
        profile = os.path.join(chart, "profiles", "split-plane-control.yaml")
        external = os.path.join(chart, "tests", "control-external-values.yaml")
        bootstrap_image = self._bootstrap_image()
        authz_image = self._related_image(bootstrap_image, 'authz-sidecar')
        authz_registry, authz_repository, authz_tag, authz_digest = (
            self._component_image_values(authz_image))
        port_reservation = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.addCleanup(port_reservation.close)
        port_reservation.bind(('127.0.0.1', 0))
        local_port = port_reservation.getsockname()[1]
        external_url = f'http://127.0.0.1:{local_port}'

        def kubectl(*args, expected_success=True, input_text=None):
            return self._run(
                ["kubectl", "--context", "kind-osmo", "--namespace", namespace,
                 *args], expected_success, input_text)

        def helm_apply(*extra, reuse_values=False, expected_success=True):
            command = [
                "helm", "upgrade", release, chart,
                "--kube-context", "kind-osmo", "--namespace", namespace,
                "--timeout", "120s",
            ]
            if reuse_values:
                command.append("--reuse-values")
            else:
                command.extend([
                    "--install", "-f", profile, "-f", external,
                    "--set", "authentication.provider=embeddedDex",
                    "--set", "embeddedDependencies.dex.enabled=true",
                    "--set", "gateway.tls.enabled=false",
                    "--set-string", f"externalUrl={external_url}",
                    "--set-string",
                    f"authentication.embeddedDex.bootstrap.image={bootstrap_image}",
                    "--set",
                    "authentication.embeddedDex.bootstrap.imagePullPolicy=IfNotPresent",
                    "--set",
                    "authentication.embeddedDex.bootstrap.activeDeadlineSeconds=90",
                    "--set", "gateway.oauth2Proxy.redisSessionStore=false",
                    "--set-string",
                    f"gateway.authz.image.registry={authz_registry}",
                    "--set-string",
                    f"gateway.authz.image.repository={authz_repository}",
                    "--set-string", f"gateway.authz.image.tag={authz_tag}",
                    "--set-string", f"gateway.authz.image.digest={authz_digest}",
                    "--set", "gateway.authz.image.pullPolicy=IfNotPresent",
                ])
            command.extend(extra)
            return self._run(command, expected_success)

        def secret(name):
            return json.loads(kubectl(
                "get", "secret", name, "-o", "json").stdout)

        self.addCleanup(
            subprocess.run,
            ["kubectl", "--context", "kind-osmo", "delete", "namespace", namespace,
             "--ignore-not-found=true", "--wait=true", "--timeout=45s"],
            check=False, capture_output=True, text=True)
        self._run([
            "kubectl", "--context", "kind-osmo", "create", "namespace", namespace,
        ])
        for secret_name, secret_key in (
            ('external-postgresql-secret', 'external-db-password'),
            ('external-valkey-secret', 'redis-password'),
        ):
            kubectl(
                "apply", "--filename", "-",
                input_text=json.dumps({
                    'apiVersion': 'v1',
                    'kind': 'Secret',
                    'metadata': {'name': secret_name, 'namespace': namespace},
                    'type': 'Opaque',
                    'data': {
                        secret_key: base64.b64encode(
                            _environment_secret_bytes(
                                secrets.token_bytes(32))).decode('ascii'),
                    },
                }),
            )

        admin_name = "osmo-embedded-dex-admin"
        oauth_name = "osmo-embedded-dex-oauth"
        helm_apply()
        try:
            kubectl(
                "rollout", "status",
                f"deployment/{release}-osmo-gateway-authz",
                "--timeout=60s")
        except RuntimeError as error:
            authz_pods = json.loads(kubectl(
                "get", "pods", "--selector",
                "app.kubernetes.io/component=gateway-authz",
                "--output=json").stdout)
            diagnostics = []
            for pod in authz_pods['items']:
                for status in pod.get('status', {}).get(
                    'containerStatuses', []
                ):
                    diagnostics.append({
                        'image': status.get('image'),
                        'state': status.get('state'),
                    })
                events = json.loads(kubectl(
                    "get", "events", "--field-selector",
                    f"involvedObject.name={pod['metadata']['name']}",
                    "--output=json").stdout)
                diagnostics.extend({
                    'reason': event.get('reason'),
                    'message': event.get('message'),
                } for event in events['items'])
            raise RuntimeError(
                f'{error}; authz container diagnostics: '
                f'{json.dumps(diagnostics, sort_keys=True)}') from error
        initial_admin = secret(admin_name)
        initial_oauth = secret(oauth_name)
        password = base64.b64decode(initial_admin["data"]["password"])
        password_hash = base64.b64decode(initial_admin["data"]["password-hash"])
        self.assertGreaterEqual(len(password), 43)
        self.assertTrue(re.match(br"^\$2[aby]\$12\$", password_hash))
        cookie = base64.b64decode(initial_oauth["data"]["cookie-secret"])
        self.assertEqual(32, len(base64.urlsafe_b64decode(cookie)))
        port_reservation.close()
        port_forward = subprocess.Popen(
            [
                "kubectl", "--context", "kind-osmo", "--namespace", namespace,
                "port-forward", f"service/{release}-osmo-gateway",
                f"{local_port}:80", "--address=127.0.0.1",
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        self.addCleanup(self._stop_process, port_forward)
        try:
            self._authenticate_embedded_admin(external_url, password)
        except AssertionError as error:
            authz_logs = kubectl(
                "logs", f"deployment/{release}-osmo-gateway-authz",
                "--tail=100").stdout
            raise AssertionError(
                f'{error}\nauthz logs:\n{authz_logs}') from error

        helm_apply(reuse_values=True)
        self.assertEqual(
            self._secret_data_identity(initial_admin),
            self._secret_data_identity(secret(admin_name)))
        self.assertEqual(
            self._secret_data_identity(initial_oauth),
            self._secret_data_identity(secret(oauth_name)))

        helm_apply(
            "--set", "authentication.embeddedDex.admin.passwordGeneration=2",
            reuse_values=True)
        rotated_admin = secret(admin_name)
        self.assertNotEqual(
            self._secret_data_identity(initial_admin),
            self._secret_data_identity(rotated_admin))
        self.assertEqual(
            self._secret_data_identity(initial_oauth),
            self._secret_data_identity(secret(oauth_name)))

        helm_apply(
            "--set",
            "authentication.embeddedDex.browserClientSecretGeneration=2",
            reuse_values=True)
        rotated_client = secret(oauth_name)
        self.assertNotEqual(
            self._secret_data_identity(initial_oauth, "browser-client-secret"),
            self._secret_data_identity(rotated_client, "browser-client-secret"))
        self.assertEqual(
            self._secret_data_identity(initial_oauth, "cookie-secret"),
            self._secret_data_identity(rotated_client, "cookie-secret"))

        helm_apply(
            "--set", "authentication.embeddedDex.cookieSecretGeneration=2",
            "--set",
            "authentication.embeddedDex.bootstrap.allowInitialGeneration=false",
            reuse_values=True)
        rotated_cookie = secret(oauth_name)
        self.assertNotEqual(
            self._secret_data_identity(rotated_client, "cookie-secret"),
            self._secret_data_identity(rotated_cookie, "cookie-secret"))
        self.assertEqual(
            self._secret_data_identity(rotated_client, "browser-client-secret"),
            self._secret_data_identity(rotated_cookie, "browser-client-secret"))

        self._run([
            "helm", "uninstall", release, "--kube-context", "kind-osmo",
            "--namespace", namespace,
        ])
        self.assertEqual(
            self._secret_data_identity(rotated_admin),
            self._secret_data_identity(secret(admin_name)))
        self.assertEqual(
            self._secret_data_identity(rotated_cookie),
            self._secret_data_identity(secret(oauth_name)))

        helm_apply(
            "--set",
            "authentication.embeddedDex.bootstrap.allowInitialGeneration=false",
            "--set", "authentication.embeddedDex.admin.passwordGeneration=2",
            "--set",
            "authentication.embeddedDex.browserClientSecretGeneration=2",
            "--set", "authentication.embeddedDex.cookieSecretGeneration=2")
        kubectl("delete", "secret", admin_name)
        missing = helm_apply(reuse_values=True, expected_success=False)
        self.assertIn("pre-upgrade hooks failed", missing.stderr)
        bootstrap_logs = kubectl(
            "logs", "job/" + release + "-osmo-embedded-dex-bootstrap-pre")
        self.assertIn("initial generation is disabled", bootstrap_logs.stdout)

    def test_unified_generated_and_existing_secret_modes(self):
        """Install the unified chart in both supported OAuth/TLS modes."""
        suffix = secrets.token_hex(4)
        generated_namespace = f"secret-generated-{suffix}"
        existing_namespace = f"secret-existing-{suffix}"
        generated_release = f"secret-generated-{suffix}"
        existing_release = f"secret-existing-{suffix}"
        chart = self._chart_path()
        profile = os.path.join(chart, "profiles", "split-plane-control.yaml")
        external = os.path.join(chart, "tests", "control-external-values.yaml")
        bootstrap_image = self._bootstrap_image()

        for namespace in (generated_namespace, existing_namespace):
            self.addCleanup(
                subprocess.run,
                ["kubectl", "--context", "kind-osmo", "delete", "namespace", namespace,
                 "--ignore-not-found=true", "--wait=true", "--timeout=45s"],
                check=False, capture_output=True, text=True)
            self._run([
                "kubectl", "--context", "kind-osmo", "create", "namespace", namespace,
            ])

        self._run([
            "helm", "install", generated_release, chart,
            "--kube-context", "kind-osmo",
            "--namespace", generated_namespace,
            "-f", profile, "-f", external,
            "--set", "authentication.provider=embeddedDex",
            "--set", "embeddedDependencies.dex.enabled=true",
            "--set-string", "externalUrl=http://127.0.0.1:30080",
            "--set-string",
            f"authentication.embeddedDex.bootstrap.image={bootstrap_image}",
            "--set",
            "authentication.embeddedDex.bootstrap.imagePullPolicy=IfNotPresent",
            "--set", "gateway.tls.enabled=true",
            "--set", "gateway.tls.generated.enabled=true",
            "--set-string",
            f"gateway.tls.generated.bootstrap.image={bootstrap_image}",
            "--set", "gateway.tls.generated.bootstrap.imagePullPolicy=IfNotPresent",
            "--timeout", "5m",
        ])
        generated_status = json.loads(self._run([
            "helm", "status", generated_release, "--kube-context", "kind-osmo",
            "--namespace", generated_namespace, "-o", "json",
        ]).stdout)
        self.assertEqual("deployed", generated_status["info"]["status"])

        generated_prefix = f"{generated_release}-osmo"
        ca_secret = json.loads(self._run([
            "kubectl", "--context", "kind-osmo", "--namespace", generated_namespace,
            "get", "secret", f"{generated_prefix}-internal-tls-ca",
            "-o", "json",
        ]).stdout)
        ca_certificate = x509.load_pem_x509_certificate(
            base64.b64decode(ca_secret["data"]["ca.crt"]))
        self.assertEqual(ca_certificate.subject, ca_certificate.issuer)
        self.assertTrue(ca_secret["data"]["ca.key"])

        trust_secret = json.loads(self._run([
            "kubectl", "--context", "kind-osmo", "--namespace", generated_namespace,
            "get", "secret", f"{generated_prefix}-internal-tls-trust",
            "-o", "json",
        ]).stdout)
        self.assertEqual(
            ca_secret["data"]["ca.crt"], trust_secret["data"]["ca.crt"])
        for component in ("api", "router", "agent", "logger"):
            leaf_secret = json.loads(self._run([
                "kubectl", "--context", "kind-osmo", "--namespace", generated_namespace,
                "get", "secret", f"{generated_prefix}-internal-tls-{component}",
                "-o", "json",
            ]).stdout)
            leaf_certificate = x509.load_pem_x509_certificate(
                base64.b64decode(leaf_secret["data"]["tls.crt"]))
            self.assertEqual(ca_certificate.subject, leaf_certificate.issuer)
            self.assertTrue(leaf_secret["data"]["tls.key"])

        generated_cookie = json.loads(self._run([
            "kubectl", "--context", "kind-osmo", "--namespace", generated_namespace,
            "get", "secret", "osmo-embedded-dex-oauth", "-o", "json",
        ]).stdout)
        mounted_cookie = base64.b64decode(
            generated_cookie["data"]["cookie-secret"]).decode("ascii")
        self.assertTrue(re.fullmatch(r"[A-Za-z0-9_-]{43}=", mounted_cookie))
        self.assertEqual(32, len(base64.urlsafe_b64decode(mounted_cookie)))

        generated_api = json.loads(self._run([
            "kubectl", "--context", "kind-osmo", "--namespace", generated_namespace,
            "get", "deployment", f"{generated_prefix}-api", "-o", "json",
        ]).stdout)
        generated_api_secrets = {
            volume["secret"]["secretName"]
            for volume in generated_api["spec"]["template"]["spec"]["volumes"]
            if "secret" in volume
        }
        self.assertIn(
            f"{generated_prefix}-internal-tls-api", generated_api_secrets)
        generated_oauth = json.loads(self._run([
            "kubectl", "--context", "kind-osmo", "--namespace", generated_namespace,
            "get", "deployment", f"{generated_prefix}-gateway-oauth2-proxy",
            "-o", "json",
        ]).stdout)
        generated_oauth_secrets = {
            volume["secret"]["secretName"]
            for volume in generated_oauth["spec"]["template"]["spec"]["volumes"]
            if "secret" in volume
        }
        self.assertIn("osmo-embedded-dex-oauth", generated_oauth_secrets)
        missing_generated_rbac = self._run([
            "kubectl", "--context", "kind-osmo", "--namespace", generated_namespace,
            "get", "rolebinding", f"{generated_prefix}-internal-tls-bootstrap",
        ], expected_success=False)
        self.assertIn("NotFound", missing_generated_rbac.stderr)

        existing_client = f"{existing_release}-oauth-client"
        existing_cookie = f"{existing_release}-oauth-cookie"
        existing_trust = f"{existing_release}-tls-trust"
        existing_leaves = {
            component: f"{existing_release}-tls-{component}"
            for component in ("api", "router", "agent", "logger")
        }
        operator_secrets = {
            existing_client: {
                "client_secret": secrets.token_urlsafe(32).encode("ascii"),
            },
            existing_cookie: {
                "cookie_secret": base64.urlsafe_b64encode(secrets.token_bytes(32)),
            },
            existing_trust: {"ca.crt": b"operator-ca"},
        }
        for leaf_name in existing_leaves.values():
            operator_secrets[leaf_name] = {
                "tls.crt": b"operator-certificate",
                "tls.key": b"operator-private-key",
            }
        before = {}
        for secret_name, secret_data in operator_secrets.items():
            secret_manifest = {
                "apiVersion": "v1",
                "kind": "Secret",
                "metadata": {
                    "name": secret_name,
                    "namespace": existing_namespace,
                },
                "type": "Opaque",
                "data": {
                    key: base64.b64encode(value).decode("ascii")
                    for key, value in secret_data.items()
                },
            }
            self._run([
                "kubectl", "--context", "kind-osmo", "--namespace", existing_namespace,
                "apply", "--filename", "-",
            ], input_text=json.dumps(secret_manifest))
            before[secret_name] = json.loads(self._run([
                "kubectl", "--context", "kind-osmo", "--namespace", existing_namespace,
                "get", "secret", secret_name, "-o", "json",
            ]).stdout)

        existing_command = [
            "helm", "install", existing_release, chart,
            "--kube-context", "kind-osmo",
            "--namespace", existing_namespace,
            "-f", profile, "-f", external,
            "--set-string",
            ("authentication.externalOidc.browserClientSecret.existingSecret="
             f"{existing_client}"),
            "--set-string",
            ("authentication.externalOidc.cookieSecret.existingSecret="
             f"{existing_cookie}"),
            "--set", "gateway.tls.enabled=true",
            "--set", "gateway.tls.generated.enabled=false",
            "--set-string", f"gateway.tls.caSecret={existing_trust}",
        ]
        for component, secret_name in existing_leaves.items():
            existing_command.extend([
                "--set-string",
                f"gateway.tls.upstreamCerts.{component}={secret_name}",
            ])
        existing_command.extend(["--timeout", "5m"])
        self._run(existing_command)

        existing_status = json.loads(self._run([
            "helm", "status", existing_release, "--kube-context", "kind-osmo",
            "--namespace", existing_namespace, "-o", "json",
        ]).stdout)
        self.assertEqual("deployed", existing_status["info"]["status"])
        for secret_name, original in before.items():
            observed = json.loads(self._run([
                "kubectl", "--context", "kind-osmo", "--namespace", existing_namespace,
                "get", "secret", secret_name, "-o", "json",
            ]).stdout)
            self.assertEqual(original["metadata"]["uid"], observed["metadata"]["uid"])
            self.assertEqual(
                self._secret_data_identity(original),
                self._secret_data_identity(observed))

        existing_prefix = f"{existing_release}-osmo"
        existing_api = json.loads(self._run([
            "kubectl", "--context", "kind-osmo", "--namespace", existing_namespace,
            "get", "deployment", f"{existing_prefix}-api", "-o", "json",
        ]).stdout)
        existing_api_secrets = {
            volume["secret"]["secretName"]
            for volume in existing_api["spec"]["template"]["spec"]["volumes"]
            if "secret" in volume
        }
        self.assertIn(existing_leaves["api"], existing_api_secrets)
        existing_envoy = json.loads(self._run([
            "kubectl", "--context", "kind-osmo", "--namespace", existing_namespace,
            "get", "deployment", f"{existing_prefix}-gateway-envoy", "-o", "json",
        ]).stdout)
        existing_envoy_secrets = {
            volume["secret"]["secretName"]
            for volume in existing_envoy["spec"]["template"]["spec"]["volumes"]
            if "secret" in volume
        }
        self.assertIn(existing_trust, existing_envoy_secrets)
        unexpected_ca = self._run([
            "kubectl", "--context", "kind-osmo", "--namespace", existing_namespace,
            "get", "secret", f"{existing_prefix}-internal-tls-ca",
        ], expected_success=False)
        self.assertIn("NotFound", unexpected_ca.stderr)


class EnvironmentSecretEncodingTest(unittest.TestCase):

    def test_environment_secret_bytes_are_safe_for_environment_variables(self):
        value = _environment_secret_bytes(bytes(range(32)))

        self.assertIsNotNone(re.fullmatch(rb'[A-Za-z0-9_-]+', value))
        self.assertNotIn(b'\x00', value)


if __name__ == "__main__":
    unittest.main()

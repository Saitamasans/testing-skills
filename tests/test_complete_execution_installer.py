import hashlib
import json
import os
import re
import shutil
import socket
import subprocess
import tempfile
import threading
import time
import unittest
import warnings
import zipfile
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
INSTALLER = ROOT / "scripts" / "install-web-api-test-execution-evidence.ps1"
SYSTEM_ROOT = Path(os.environ.get("SystemRoot", r"C:\Windows"))
POWERSHELL = (
    SYSTEM_ROOT / "System32" / "WindowsPowerShell" / "v1.0" / "powershell.exe"
)
SUCCESS = "安装完成，可以执行 Web/API 自动化测试"
SKILL = "web-api-test-execution-evidence"


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


@dataclass
class Fixture:
    archive: bytes
    companion: bytes
    companion_sha256: str
    archive_name: str
    payload_manifest: bytes


def build_fixture(*, arch="x64", unsafe_entry=None, duplicate_case=False,
                  installed_size_adjustment=0, content_marker="v1"):
    files = {
        "node/node.exe": b"fixture-node",
        "runner/dist/cli.js": b"fixture-runner",
        "runner/package.json": b'{"name":"@saitamasans/testing-runner","version":"1.1.1"}\n',
        "skill/web-api-test-execution-evidence/SKILL.md": (
            f"# Fixture Skill\n\n{content_marker}\n".encode()
        ),
        "smoke/installation-smoke-test.mjs": b"// fixture smoke\n",
        "smoke/installation-smoke-fixture.html": b"Bundle Smoke Ready\n",
        "browser-cache/chromium-1228/chrome-win64/chrome.exe": b"chromium",
        "browser-cache/chromium_headless_shell-1228/"
        "chrome-headless-shell-win64/chrome-headless-shell.exe": b"headless",
        "browser-cache/ffmpeg-1011/ffmpeg-win64.exe": b"ffmpeg",
    }
    payload = {
        "schema_version": 1,
        "bundle": {
            "name": SKILL,
            "version": "1.0.0",
            "release_tag": "web-api-test-execution-evidence-v1.0.0",
            "os": "windows",
            "arch": arch,
        },
        "components": {
            "node": {"version": "22.23.1"},
            "runner": {"name": "@saitamasans/testing-runner", "version": "1.1.1"},
            "playwright": {
                "version": "1.61.1",
                "chromium_revision": "1228",
                "chromium_headless_shell_revision": "1228",
                "ffmpeg_revision": "1011",
            },
            "skill": {"name": SKILL},
        },
        "installed_size_bytes": sum(len(value) for value in files.values()),
        "files": [
            {"path": name, "size_bytes": len(value), "sha256": sha256(value)}
            for name, value in sorted(files.items())
        ],
    }
    payload_bytes = json_bytes(payload)
    with tempfile.SpooledTemporaryFile() as archive_file:
        with zipfile.ZipFile(archive_file, "w", zipfile.ZIP_DEFLATED) as bundle:
            for name, value in files.items():
                bundle.writestr(name, value)
            bundle.writestr("bundle-manifest.json", payload_bytes)
            if unsafe_entry:
                info = zipfile.ZipInfo(unsafe_entry[0])
                if unsafe_entry[1] == "symlink":
                    info.create_system = 3
                    info.external_attr = 0o120777 << 16
                bundle.writestr(info, b"unsafe")
            if duplicate_case:
                with warnings.catch_warnings():
                    warnings.simplefilter("ignore", UserWarning)
                    bundle.writestr("NODE/node.exe", b"duplicate")
        archive_file.seek(0)
        archive = archive_file.read()
    archive_name = f"{SKILL}-1.0.0-windows-{arch}.zip"
    companion = {
        "schema_version": 1,
        "bundle": payload["bundle"],
        "archive": {
            "file_name": archive_name,
            "download_url": "__BUNDLE_URL__",
            "size_bytes": len(archive),
            "sha256": sha256(archive),
        },
        "payload_manifest": {
            "path": "bundle-manifest.json",
            "size_bytes": len(payload_bytes),
            "sha256": sha256(payload_bytes),
        },
        "installed_size_bytes": (
            sum(len(value) for value in files.values())
            + len(payload_bytes)
            + installed_size_adjustment
        ),
    }
    companion_bytes = json_bytes(companion)
    return Fixture(
        archive=archive,
        companion=companion_bytes,
        companion_sha256=sha256(companion_bytes),
        archive_name=archive_name,
        payload_manifest=payload_bytes,
    )


class FixtureServer:
    def __init__(self, fixture, *, bundle_actions=None, etag='"fixture-etag"',
                 last_modified="Fri, 18 Jul 2026 00:00:00 GMT"):
        self.fixture = fixture
        self.bundle_actions = list(bundle_actions or ["normal"])
        self.etag = etag
        self.last_modified = last_modified
        self.requests = []
        self._bundle_count = 0

        owner = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, *_args):
                return

            def do_GET(self):
                owner.requests.append(
                    {
                        "path": self.path,
                        "range": self.headers.get("Range"),
                        "if_range": self.headers.get("If-Range"),
                    }
                )
                if self.path == "/manifest.json":
                    body = owner.companion_for_server()
                    self.send_response(200)
                    self.send_header("Content-Length", str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                    return
                if self.path != "/bundle.zip":
                    self.send_error(404)
                    return
                index = owner._bundle_count
                owner._bundle_count += 1
                action = owner.bundle_actions[min(index, len(owner.bundle_actions) - 1)]
                owner.serve_bundle(self, action)

        class QuietThreadingHTTPServer(ThreadingHTTPServer):
            def handle_error(self, _request, _client_address):
                return

        self.server = QuietThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    @property
    def origin(self):
        return f"http://127.0.0.1:{self.server.server_port}"

    def companion_for_server(self):
        parsed = json.loads(self.fixture.companion)
        parsed["archive"]["download_url"] = self.origin + "/bundle.zip"
        return json_bytes(parsed)

    @property
    def companion_sha256(self):
        return sha256(self.companion_for_server())

    def __enter__(self):
        self.thread.start()
        return self

    def __exit__(self, *_args):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)

    def serve_bundle(self, handler, action):
        body = self.fixture.archive
        range_header = handler.headers.get("Range")
        offset = int(range_header.split("=")[1].split("-")[0]) if range_header else 0
        if range_header and offset >= len(body) and action == "normal":
            action = "416"
        if action == "429" or action == "500":
            status = int(action)
            handler.send_response(status)
            handler.send_header("Content-Length", "0")
            if status == 429:
                handler.send_header("Retry-After", "0")
            handler.end_headers()
            return
        if action == "redirect":
            handler.send_response(302)
            handler.send_header("Location", self.origin + "/bundle.zip")
            handler.send_header("Content-Length", "0")
            handler.end_headers()
            return
        if action == "slow":
            time.sleep(1.5)
            action = "normal"
        if action == "416":
            handler.send_response(416)
            handler.send_header("Content-Range", f"bytes */{len(body)}")
            handler.send_header("Content-Length", "0")
            handler.end_headers()
            return

        ignore_range = action == "ignore-range"
        if range_header and not ignore_range:
            data = body[offset:]
            handler.send_response(206)
            start = offset + (1 if action == "bad-content-range" else 0)
            handler.send_header(
                "Content-Range", f"bytes {start}-{len(body) - 1}/{len(body)}"
            )
        else:
            data = body
            handler.send_response(200)
        if self.etag:
            handler.send_header("ETag", self.etag)
        if self.last_modified:
            handler.send_header("Last-Modified", self.last_modified)
        handler.send_header("Content-Length", str(len(data)))
        handler.end_headers()
        if action == "disconnect":
            split = max(1, len(data) // 3)
            handler.wfile.write(data[:split])
            handler.wfile.flush()
            handler.connection.shutdown(socket.SHUT_RDWR)
            handler.connection.close()
            return
        handler.wfile.write(data)


@unittest.skipUnless(POWERSHELL.is_file(), "Windows PowerShell 5.1 is required")
class CompleteInstallerTest(unittest.TestCase):
    maxDiff = None

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.install_root = self.root / "skills"
        self.state_root = self.root / "state"
        self.empty_path = self.root / "empty-path"
        self.empty_path.mkdir()
        self.smoke = self.root / "fixture-smoke.ps1"
        self.smoke.write_text(
            "param([string]$BundleRoot, [string]$DiagnosticsRoot)\n"
            "New-Item -ItemType Directory -Path $DiagnosticsRoot -Force | Out-Null\n"
            "$png='evidence/BUNDLE-SMOKE-001/BUNDLE-SMOKE-001-visible-text/web-page.png'; "
            "$trace='evidence/playwright-trace.zip'; "
            "$artifacts=@('run-result.json','projected-report.json','result.html','result.xlsx','run-events.jsonl');\n"
            "foreach($relative in @($png,$trace)+$artifacts){$target=Join-Path $DiagnosticsRoot $relative; "
            "New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null; "
            "Set-Content -LiteralPath $target -Encoding UTF8 -Value ('fixture-'+$relative)}\n"
            "function Ref([string]$relative){$file=Join-Path $DiagnosticsRoot $relative; "
            "[ordered]@{path=$relative;size_bytes=(Get-Item $file).Length;"
            "sha256=(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()}}\n"
            "$result=[ordered]@{schema_version=1;ok=$true;node=@{version='22.23.1';arch='x64'};"
            "runner=@{version='1.1.1'};browser=@{visible=$true};case_id='BUNDLE-SMOKE-001';"
            "case_status='通过';assertion_id='BUNDLE-SMOKE-001-visible-text';assertion_passed=$true;"
            "png=(Ref $png);trace=(Ref $trace);artifacts=@($artifacts|ForEach-Object {Ref $_})}\n"
            "$result|ConvertTo-Json -Depth 8|Set-Content -LiteralPath (Join-Path $DiagnosticsRoot 'smoke-result.json') -Encoding UTF8\n",
            encoding="utf-8-sig",
        )

    def tearDown(self):
        self.temp.cleanup()

    def installer_command(self, server, *extra, state_root=None, architecture="x64"):
        selected_state_root = state_root or self.state_root
        return [
            str(POWERSHELL),
            "-NoProfile",
            "-ExecutionPolicy", "Bypass",
            "-File", str(INSTALLER),
            "-ManifestUri", server.origin + "/manifest.json",
            "-ManifestSha256", server.companion_sha256,
            "-Architecture", architecture,
            "-InstallRoot", str(self.install_root),
            "-StateRoot", str(selected_state_root),
            "-AllowLocalFixture",
            "-LocalSmokeScript", str(self.smoke),
            "-RetryDelayMilliseconds", "1",
            "-MaxRetries", "4",
            "-SafetyMarginBytes", "0",
            *extra,
        ]

    def run_installer(self, server, *extra, fixture=None, state_root=None, architecture="x64"):
        environment = os.environ.copy()
        environment["PATH"] = str(self.empty_path)
        command = self.installer_command(
            server,
            *extra,
            state_root=state_root,
            architecture=architecture,
        )
        return subprocess.run(command, capture_output=True, env=environment, check=False)

    def output(self, result):
        return (result.stdout + result.stderr).decode("utf-8", errors="replace")

    def receipt_path(self):
        return self.state_root / "installations" / f"{SKILL}.json"

    def cache_paths(self, fixture):
        parent = self.state_root / "downloads" / SKILL / "1.0.0" / "x64"
        return parent / (fixture.archive_name + ".part"), parent / (
            fixture.archive_name + ".part.meta.json"
        )

    def write_partial(self, fixture, length, *, etag='"fixture-etag"',
                      last_modified="Fri, 18 Jul 2026 00:00:00 GMT"):
        part, metadata = self.cache_paths(fixture)
        part.parent.mkdir(parents=True, exist_ok=True)
        part.write_bytes(fixture.archive[:length])
        metadata.write_text(
            json.dumps(
                {
                    "schema_version": 1,
                    "url": "placeholder",
                    "expected_size": len(fixture.archive),
                    "etag": etag,
                    "last_modified": last_modified,
                }
            ),
            encoding="utf-8",
        )
        return part, metadata

    def test_clean_install_is_path_independent_and_writes_receipt_after_smoke(self):
        fixture = build_fixture()
        with FixtureServer(fixture) as server:
            result = self.run_installer(server)
        output = self.output(result)
        self.assertEqual(0, result.returncode, output)
        self.assertEqual(1, output.count(SUCCESS), output)
        receipt = json.loads(self.receipt_path().read_text(encoding="utf-8-sig"))
        runtime = Path(receipt["runtime_path"])
        skill = Path(receipt["skill_path"])
        self.assertEqual("x64", receipt["architecture"])
        self.assertTrue((runtime / "node" / "node.exe").is_file())
        self.assertTrue((skill / "SKILL.md").is_file())
        self.assertTrue((Path(receipt["diagnostics_path"]) / "smoke-result.json").is_file())
        for field in ("当前文件", "总字节", "已下载", "百分比", "字节/秒", "ETA", "重试", "续传偏移"):
            self.assertIn(field, output)

    def test_public_cmd_environment_roots_drive_default_install_locations(self):
        fixture = build_fixture()
        with FixtureServer(fixture) as server:
            command = self.installer_command(server)
            for parameter in ("-InstallRoot", "-StateRoot"):
                index = command.index(parameter)
                del command[index:index + 2]
            environment = os.environ.copy()
            environment["PATH"] = str(self.empty_path)
            environment["TESTING_SKILLS_INSTALL_ROOT"] = str(self.install_root)
            environment["TESTING_SKILLS_STATE_ROOT"] = str(self.state_root)
            result = subprocess.run(command, capture_output=True, env=environment, check=False)

        output = self.output(result)
        self.assertEqual(0, result.returncode, output)
        receipt = json.loads(self.receipt_path().read_text(encoding="utf-8-sig"))
        self.assertEqual(self.install_root / SKILL, Path(receipt["skill_path"]))
        self.assertTrue(Path(receipt["runtime_path"]).is_dir())

    def test_existing_receipt_without_smoke_evidence_never_claims_readiness(self):
        fixture = build_fixture()
        with FixtureServer(fixture) as server:
            installed = self.run_installer(server)
        self.assertEqual(0, installed.returncode, self.output(installed))
        receipt = json.loads(self.receipt_path().read_text(encoding="utf-8-sig"))
        diagnostics = Path(receipt["diagnostics_path"])
        (diagnostics / "smoke-result.json").unlink()

        with FixtureServer(fixture) as server:
            repeated = self.run_installer(server)

        output = self.output(repeated)
        self.assertNotEqual(0, repeated.returncode, output)
        self.assertNotIn(SUCCESS, output)
        self.assertIn("-Repair", output)

    def test_existing_receipt_with_empty_report_never_claims_readiness(self):
        fixture = build_fixture()
        with FixtureServer(fixture) as server:
            installed = self.run_installer(server)
        self.assertEqual(0, installed.returncode, self.output(installed))
        receipt = json.loads(self.receipt_path().read_text(encoding="utf-8-sig"))
        diagnostics = Path(receipt["diagnostics_path"])
        report = diagnostics / "result.xlsx"
        report.write_bytes(b"")
        smoke_path = diagnostics / "smoke-result.json"
        smoke = json.loads(smoke_path.read_text(encoding="utf-8-sig"))
        reference = next(item for item in smoke["artifacts"] if item["path"] == "result.xlsx")
        reference["size_bytes"] = 0
        reference["sha256"] = sha256(b"")
        smoke_path.write_text(json.dumps(smoke), encoding="utf-8-sig")

        with FixtureServer(fixture) as server:
            repeated = self.run_installer(server)

        output = self.output(repeated)
        self.assertNotEqual(0, repeated.returncode, output)
        self.assertNotIn(SUCCESS, output)
        self.assertIn("-Repair", output)

    def test_existing_receipt_through_runtime_junction_never_claims_readiness(self):
        fixture = build_fixture()
        with FixtureServer(fixture) as server:
            installed = self.run_installer(server)
        self.assertEqual(0, installed.returncode, self.output(installed))
        receipt = json.loads(self.receipt_path().read_text(encoding="utf-8-sig"))
        runtime_parent = Path(receipt["runtime_path"]).parent
        outside = runtime_parent.with_name(runtime_parent.name + "-outside")
        runtime_parent.rename(outside)
        os.symlink(outside, runtime_parent, target_is_directory=True)
        try:
            with FixtureServer(fixture) as server:
                repeated = self.run_installer(server)
        finally:
            runtime_parent.unlink()
            outside.rename(runtime_parent)

        output = self.output(repeated)
        self.assertNotEqual(0, repeated.returncode, output)
        self.assertNotIn(SUCCESS, output)
        self.assertIn("-Repair", output)

    def test_symlinked_canonical_receipt_never_claims_readiness(self):
        fixture = build_fixture()
        with FixtureServer(fixture) as server:
            installed = self.run_installer(server)
        self.assertEqual(0, installed.returncode, self.output(installed))
        receipt_path = self.receipt_path()
        outside = receipt_path.with_name(receipt_path.name + ".outside")
        receipt_path.rename(outside)
        os.symlink(outside, receipt_path)
        try:
            with FixtureServer(fixture) as server:
                repeated = self.run_installer(server)
        finally:
            receipt_path.unlink()
            outside.rename(receipt_path)

        output = self.output(repeated)
        self.assertNotEqual(0, repeated.returncode, output)
        self.assertNotIn(SUCCESS, output)
        self.assertIn("-Repair", output)

    def test_smoke_evidence_through_junction_never_claims_readiness(self):
        fixture = build_fixture()
        with FixtureServer(fixture) as server:
            installed = self.run_installer(server)
        self.assertEqual(0, installed.returncode, self.output(installed))
        receipt = json.loads(self.receipt_path().read_text(encoding="utf-8-sig"))
        evidence = Path(receipt["diagnostics_path"]) / "evidence"
        outside = evidence.with_name("evidence-outside")
        evidence.rename(outside)
        os.symlink(outside, evidence, target_is_directory=True)
        try:
            with FixtureServer(fixture) as server:
                repeated = self.run_installer(server)
        finally:
            evidence.unlink()
            outside.rename(evidence)

        output = self.output(repeated)
        self.assertNotEqual(0, repeated.returncode, output)
        self.assertNotIn(SUCCESS, output)
        self.assertIn("-Repair", output)

    def test_interrupted_download_retries_and_resumes_with_etag(self):
        fixture = build_fixture()
        with FixtureServer(fixture, bundle_actions=["disconnect", "normal"]) as server:
            result = self.run_installer(server)
            bundle_requests = [item for item in server.requests if item["path"] == "/bundle.zip"]
        output = self.output(result)
        self.assertEqual(0, result.returncode, output)
        self.assertGreaterEqual(len(bundle_requests), 2)
        self.assertIsNone(bundle_requests[0]["range"])
        self.assertRegex(bundle_requests[1]["range"], r"bytes=\d+-")
        self.assertEqual('"fixture-etag"', bundle_requests[1]["if_range"])
        self.assertIn("重试=1", output)
        progress_lines = [line for line in output.splitlines() if "当前文件=" in line]
        resume_offsets = [
            int(match.group(1))
            for line in progress_lines
            if (match := re.search(r"续传偏移=(\d+)", line))
        ]
        self.assertTrue(any(value > 0 for value in resume_offsets), output)

    def test_changed_resume_validator_discards_partial_and_restarts_from_zero(self):
        fixture = build_fixture()
        length = len(fixture.archive) // 4
        part, metadata = self.write_partial(fixture, length, etag='"old-etag"')
        with FixtureServer(fixture, etag='"new-etag"') as server:
            result = self.run_installer(server)
            requests = [item for item in server.requests if item["path"] == "/bundle.zip"]

        output = self.output(result)
        self.assertEqual(0, result.returncode, output)
        self.assertEqual(f"bytes={length}-", requests[0]["range"])
        self.assertIsNone(requests[1]["range"])
        self.assertIn("验证器已变化", output)
        self.assertEqual(fixture.archive, part.read_bytes())
        saved = json.loads(metadata.read_text(encoding="utf-8"))
        self.assertEqual('"new-etag"', saved["etag"])

    def test_existing_partial_uses_last_modified_when_etag_is_absent(self):
        fixture = build_fixture()
        length = len(fixture.archive) // 4
        self.write_partial(fixture, length, etag=None)
        with FixtureServer(fixture, etag=None) as server:
            result = self.run_installer(server)
            bundle_request = [item for item in server.requests if item["path"] == "/bundle.zip"][0]
        self.assertEqual(0, result.returncode, self.output(result))
        self.assertEqual(f"bytes={length}-", bundle_request["range"])
        self.assertEqual("Fri, 18 Jul 2026 00:00:00 GMT", bundle_request["if_range"])

    def test_range_200_restarts_affected_artifact_explicitly(self):
        fixture = build_fixture()
        self.write_partial(fixture, len(fixture.archive) // 4)
        with FixtureServer(fixture, bundle_actions=["ignore-range"]) as server:
            result = self.run_installer(server)
        output = self.output(result)
        self.assertEqual(0, result.returncode, output)
        self.assertIn("服务器未接受 Range，已从 0 重新下载当前文件", output)

    def test_strict_content_range_rejects_mismatched_start_and_preserves_partial(self):
        fixture = build_fixture()
        initial = len(fixture.archive) // 4
        part, _ = self.write_partial(fixture, initial)
        with FixtureServer(fixture, bundle_actions=["bad-content-range"] * 5) as server:
            result = self.run_installer(server)
        output = self.output(result)
        self.assertNotEqual(0, result.returncode, output)
        self.assertIn("Content-Range", output)
        self.assertTrue(part.is_file())
        self.assertEqual(initial, part.stat().st_size)
        self.assertFalse(self.receipt_path().exists())

    def test_416_is_accepted_only_for_a_complete_verified_partial(self):
        fixture = build_fixture()
        self.write_partial(fixture, len(fixture.archive))
        with FixtureServer(fixture, bundle_actions=["416"]) as server:
            result = self.run_installer(server)
        self.assertEqual(0, result.returncode, self.output(result))

        self.tearDown()
        self.setUp()
        fixture = build_fixture()
        part, _ = self.write_partial(fixture, len(fixture.archive))
        part.write_bytes(b"x" + fixture.archive[1:])
        with FixtureServer(fixture, bundle_actions=["416"] * 5) as server:
            result = self.run_installer(server)
        self.assertNotEqual(0, result.returncode, self.output(result))
        self.assertFalse(self.receipt_path().exists())
        self.assertTrue(part.exists())

        with FixtureServer(fixture) as server:
            repaired = self.run_installer(server, "-Repair")
        self.assertEqual(0, repaired.returncode, self.output(repaired))

    def test_429_and_5xx_are_retried_with_visible_accounting(self):
        fixture = build_fixture()
        with FixtureServer(fixture, bundle_actions=["429", "500", "normal"]) as server:
            result = self.run_installer(server)
        output = self.output(result)
        self.assertEqual(0, result.returncode, output)
        self.assertIn("重试=1", output)
        self.assertIn("重试=2", output)

    def test_size_hash_and_free_space_failures_never_commit(self):
        fixture = build_fixture()
        with FixtureServer(fixture) as server:
            result = self.run_installer(server, "-TestAvailableBytes", "1")
        self.assertNotEqual(0, result.returncode, self.output(result))
        self.assertIn("磁盘空间不足", self.output(result))
        self.assertFalse(self.receipt_path().exists())

        self.tearDown()
        self.setUp()
        fixture = build_fixture()
        fixture.archive = fixture.archive[:-3] + b"bad"
        with FixtureServer(fixture) as server:
            result = self.run_installer(server)
        self.assertNotEqual(0, result.returncode, self.output(result))
        self.assertIn("SHA-256", self.output(result))
        self.assertFalse(self.receipt_path().exists())

    def test_zip_traversal_duplicate_case_symlink_and_total_are_rejected(self):
        fixtures = [
            (build_fixture(unsafe_entry=("../escape.txt", "file")), "不安全 ZIP 路径"),
            (build_fixture(duplicate_case=True), "大小写重复"),
            (build_fixture(unsafe_entry=("link", "symlink")), "重解析点"),
            (build_fixture(installed_size_adjustment=-1), "解压总量"),
        ]
        for fixture, message in fixtures:
            with self.subTest(message=message):
                with tempfile.TemporaryDirectory() as directory:
                    old_root = self.root
                    self.root = Path(directory)
                    self.install_root = self.root / "skills"
                    self.state_root = self.root / "state"
                    self.empty_path = self.root / "empty-path"
                    self.empty_path.mkdir()
                    self.smoke = self.root / "smoke.ps1"
                    self.smoke.write_text(
                        "param($BundleRoot,$DiagnosticsRoot)\nexit 0\n",
                        encoding="utf-8-sig",
                    )
                    with FixtureServer(fixture) as server:
                        result = self.run_installer(server)
                    self.assertNotEqual(0, result.returncode, self.output(result))
                    self.assertIn(message, self.output(result))
                    self.assertFalse(self.receipt_path().exists())
                    self.root = old_root

    def test_path_length_is_rejected_before_extraction(self):
        fixture = build_fixture(unsafe_entry=(("deep/" * 55) + "file.txt", "file"))
        with FixtureServer(fixture) as server:
            result = self.run_installer(server)
        self.assertNotEqual(0, result.returncode, self.output(result))
        self.assertIn("路径过长", self.output(result))

    def test_activation_failure_removes_staging_and_preserves_previous_install(self):
        first_fixture = build_fixture(content_marker="old")
        with FixtureServer(first_fixture) as server:
            first = self.run_installer(server)
        self.assertEqual(0, first.returncode, self.output(first))
        old_receipt = self.receipt_path().read_bytes()
        old_skill = (self.install_root / SKILL / "SKILL.md").read_bytes()

        for phase in ("AfterRuntime", "AfterSkill", "BeforeReceipt", "ReceiptWrite"):
            with self.subTest(phase=phase):
                second_fixture = build_fixture(content_marker="new")
                with FixtureServer(second_fixture) as server:
                    second = self.run_installer(
                        server, "-Force", "-TestFailurePoint", phase
                    )
                self.assertNotEqual(0, second.returncode, self.output(second))
                self.assertEqual(old_receipt, self.receipt_path().read_bytes())
                self.assertEqual(old_skill, (self.install_root / SKILL / "SKILL.md").read_bytes())
                self.assertFalse(list(self.state_root.rglob(".stage-*")))
                self.assertNotIn(SUCCESS, self.output(second))
                self.assertIn(f"注入激活失败：{phase}", self.output(second))

    def test_repair_and_force_rebuild_damaged_or_existing_runtime(self):
        fixture = build_fixture()
        with FixtureServer(fixture) as server:
            first = self.run_installer(server)
        self.assertEqual(0, first.returncode, self.output(first))
        receipt = json.loads(self.receipt_path().read_text(encoding="utf-8-sig"))
        runtime = Path(receipt["runtime_path"])
        node = runtime / "node" / "node.exe"
        node.write_bytes(b"damaged")
        with FixtureServer(fixture) as server:
            rejected = self.run_installer(server)
        self.assertNotEqual(0, rejected.returncode, self.output(rejected))
        self.assertIn("-Repair", self.output(rejected))
        self.assertNotIn(SUCCESS, self.output(rejected))

        with FixtureServer(fixture) as server:
            repaired = self.run_installer(server, "-Repair")
        self.assertEqual(0, repaired.returncode, self.output(repaired))
        repaired_receipt = json.loads(self.receipt_path().read_text(encoding="utf-8-sig"))
        repaired_runtime = Path(repaired_receipt["runtime_path"])
        self.assertNotEqual(runtime, repaired_runtime)
        self.assertEqual(b"damaged", node.read_bytes())
        self.assertEqual(b"fixture-node", (repaired_runtime / "node" / "node.exe").read_bytes())

        marker = repaired_runtime / "stale.txt"
        marker.write_text("stale")
        with FixtureServer(fixture) as server:
            forced = self.run_installer(server, "-Force")
        self.assertEqual(0, forced.returncode, self.output(forced))
        forced_receipt = json.loads(self.receipt_path().read_text(encoding="utf-8-sig"))
        forced_runtime = Path(forced_receipt["runtime_path"])
        self.assertNotEqual(repaired_runtime, forced_runtime)
        self.assertTrue(marker.exists())
        self.assertFalse((forced_runtime / "stale.txt").exists())

    def test_smoke_failure_retains_diagnostics_but_not_receipt(self):
        self.smoke.write_text(
            "param($BundleRoot,$DiagnosticsRoot)\n"
            "New-Item -ItemType Directory -Path $DiagnosticsRoot -Force | Out-Null\n"
            "Set-Content (Join-Path $DiagnosticsRoot 'failure.txt') 'smoke failed'\n"
            "exit 19\n",
            encoding="utf-8-sig",
        )
        fixture = build_fixture()
        with FixtureServer(fixture) as server:
            result = self.run_installer(server)
        self.assertNotEqual(0, result.returncode, self.output(result))
        self.assertFalse(self.receipt_path().exists())
        self.assertTrue(list((self.state_root / "diagnostics").rglob("failure.txt")))
        self.assertFalse(list(self.state_root.rglob(".stage-*")))

    def test_same_install_root_is_locked_across_processes_with_different_state_roots(self):
        fixture = build_fixture()
        second_state = self.root / "other-state"
        environment = os.environ.copy()
        environment["PATH"] = str(self.empty_path)
        with FixtureServer(fixture, bundle_actions=["slow", "normal"]) as server:
            first = subprocess.Popen(
                self.installer_command(server),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                env=environment,
            )
            deadline = time.time() + 5
            while time.time() < deadline:
                if any(item["path"] == "/bundle.zip" for item in server.requests):
                    break
                time.sleep(0.02)
            else:
                first.kill()
                self.fail("first installer did not reach the locked download phase")

            second = self.run_installer(server, state_root=second_state)
            first_stdout, first_stderr = first.communicate(timeout=20)

        first_output = (first_stdout + first_stderr).decode("utf-8", errors="replace")
        self.assertEqual(0, first.returncode, first_output)
        self.assertNotEqual(0, second.returncode, self.output(second))
        self.assertIn("另一个安装进程", self.output(second))
        receipts = [path for path in (
            self.receipt_path(),
            second_state / "installations" / f"{SKILL}.json",
        ) if path.is_file()]
        self.assertEqual([self.receipt_path()], receipts)
        receipt = json.loads(receipts[0].read_text(encoding="utf-8-sig"))
        self.assertEqual(self.install_root / SKILL, Path(receipt["skill_path"]))
        self.assertTrue(Path(receipt["runtime_path"]).is_dir())

    def test_mutex_uses_same_physical_identity_for_normal_and_extended_paths(self):
        self.install_root.mkdir()
        escaped = str(INSTALLER).replace("'", "''")
        normal = str(self.install_root).replace("'", "''")
        extended = ("\\\\?\\" + str(self.install_root)).replace("'", "''")
        ready = self.root / "mutex-ready.txt"
        first_command = (
            f". '{escaped}'; $lock=Enter-InstallerLock -InstallRoot '{normal}' -SkillName '{SKILL}'; "
            f"Set-Content -LiteralPath '{str(ready).replace("'", "''")}' -Value ready; "
            "Start-Sleep -Milliseconds 1800; $lock.ReleaseMutex(); $lock.Dispose(); exit 0"
        )
        first = subprocess.Popen(
            [str(POWERSHELL), "-NoProfile", "-Command", first_command],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        deadline = time.time() + 5
        while time.time() < deadline and not ready.exists():
            time.sleep(0.02)
        if not ready.exists():
            first.kill()
            self.fail("normal-path mutex process did not acquire the lock")

        second_command = (
            f". '{escaped}'; try {{$lock=Enter-InstallerLock -InstallRoot '{extended}' -SkillName '{SKILL}'; "
            "$lock.ReleaseMutex(); $lock.Dispose(); exit 2} catch {"
            "if($_.Exception.Message -notmatch '另一个安装进程'){Write-Error $_; exit 3}; exit 0}"
        )
        second = subprocess.run(
            [str(POWERSHELL), "-NoProfile", "-Command", second_command],
            capture_output=True,
            check=False,
        )
        first_stdout, first_stderr = first.communicate(timeout=10)
        self.assertEqual(0, first.returncode, (first_stdout + first_stderr).decode(errors="replace"))
        self.assertEqual(0, second.returncode, self.output(second))

    def test_mutex_path_normalization_preserves_roots_and_resolves_missing_descendants(self):
        escaped = str(INSTALLER).replace("'", "''")
        workspace = str(ROOT).replace("'", "''")
        existing_parent = str(self.root).replace("'", "''")
        command = (
            f". '{escaped}'; "
            f"$driveRoot = [IO.Path]::GetPathRoot('{workspace}'); "
            "$extendedDriveRoot = '\\\\?\\' + $driveRoot; "
            "$uncRoot = '\\\\server\\share\\'; "
            "$extendedUncRoot = '\\\\?\\UNC\\server\\share\\'; "
            "$normalizedDrive = Get-RootPreservingFullPath -Path $driveRoot; "
            "$normalizedExtendedDrive = Get-RootPreservingFullPath -Path $extendedDriveRoot; "
            "$normalizedUnc = Get-RootPreservingFullPath -Path $uncRoot; "
            "$normalizedExtendedUnc = Get-RootPreservingFullPath -Path $extendedUncRoot; "
            "if($normalizedDrive -cne $driveRoot){throw \"drive root: [$normalizedDrive]\"}; "
            "if($normalizedExtendedDrive -cne $extendedDriveRoot){throw \"extended drive root: [$normalizedExtendedDrive]\"}; "
            "if($normalizedUnc -cne $uncRoot){throw \"UNC root: [$normalizedUnc]\"}; "
            "if($normalizedExtendedUnc -cne $extendedUncRoot){throw \"extended UNC root: [$normalizedExtendedUnc]\"}; "
            "$physicalDrive = Resolve-PhysicalInstallRoot -InstallRoot $driveRoot; "
            "$physicalExtendedDrive = Resolve-PhysicalInstallRoot -InstallRoot $extendedDriveRoot; "
            "if($physicalDrive -cne $driveRoot.ToUpperInvariant() -or $physicalExtendedDrive -cne $physicalDrive){"
            "throw \"physical drive roots: [$physicalDrive] [$physicalExtendedDrive]\"}; "
            "$driveMutex = Get-InstallerMutexName -InstallRoot $driveRoot -SkillName 'root-test'; "
            "$extendedDriveMutex = Get-InstallerMutexName -InstallRoot $extendedDriveRoot -SkillName 'root-test'; "
            "if($driveMutex -cne $extendedDriveMutex){throw \"drive mutexes: [$driveMutex] [$extendedDriveMutex]\"}; "
            f"$missing = Join-Path '{existing_parent}' 'missing\\child\\'; "
            "$extendedMissing = '\\\\?\\' + $missing; "
            "$expectedMissing = [IO.Path]::GetFullPath($missing).TrimEnd('\\','/').ToUpperInvariant(); "
            "$physicalMissing = Resolve-PhysicalInstallRoot -InstallRoot $missing; "
            "$physicalExtendedMissing = Resolve-PhysicalInstallRoot -InstallRoot $extendedMissing; "
            "if($physicalMissing -cne $expectedMissing -or $physicalExtendedMissing -cne $expectedMissing){"
            "throw \"missing descendants: [$physicalMissing] [$physicalExtendedMissing] expected [$expectedMissing]\"}; "
            "exit 0"
        )
        result = subprocess.run(
            [str(POWERSHELL), "-NoProfile", "-Command", command],
            capture_output=True,
            check=False,
        )
        self.assertEqual(0, result.returncode, self.output(result))

    def test_lock_https_and_arm64_manifest_selection_functions(self):
        escaped = str(INSTALLER).replace("'", "''")
        install_root = str(self.install_root).replace("'", "''")
        command = (
            f". '{escaped}'; "
            f"$name1 = Get-InstallerMutexName -InstallRoot '{install_root}' -SkillName '{SKILL}'; "
            f"$name2 = Get-InstallerMutexName -InstallRoot '{install_root}\\.' -SkillName '{SKILL}'; "
            "if($name1 -cne $name2 -or -not $name1.StartsWith('Global\\')){throw \"mutex names: [$name1] [$name2]\"}; "
            f"$first = Enter-InstallerLock -InstallRoot '{install_root}' -SkillName '{SKILL}'; "
            "$first.ReleaseMutex(); $first.Dispose(); "
            "$httpRejected=$false; try { Assert-TrustedUri -Uri 'http://example.com/file' -AllowLocal:$false } catch { $httpRejected=$true }; "
            "if(-not $httpRejected){throw 'HTTP accepted'}; "
            "Assert-TrustedUri -Uri 'https://example.com/file' -AllowLocal:$false | Out-Null; "
            "$arm = Get-PinnedManifest -Architecture 'arm64'; "
            "if($arm.Uri -cnotmatch 'windows-arm64\\.manifest\\.json$' -or $arm.Sha256 -cne '__ARM64_COMPANION_MANIFEST_SHA256__'){throw \"arm: $($arm.Uri) $($arm.Sha256)\"}; "
            "try { Get-TrustedManifestBytes -Uri $arm.Uri -ExpectedSha256 $arm.Sha256 -Retries 0 -RetryDelay 0; throw 'placeholder accepted' } "
            "catch { if($_.Exception.Message -notmatch '未写入有效'){throw \"wrong fail-closed error: $($_.Exception.Message)\"} }; exit 0"
        )
        result = subprocess.run(
            [str(POWERSHELL), "-NoProfile", "-Command", command],
            capture_output=True,
            check=False,
        )
        self.assertEqual(0, result.returncode, self.output(result))


class CompleteInstallerStaticTest(unittest.TestCase):
    def test_installer_is_ps51_bom_and_uses_required_platform_apis(self):
        source = INSTALLER.read_bytes()
        self.assertTrue(source.startswith(b"\xef\xbb\xbf"))
        text = source.decode("utf-8-sig")
        for phrase in [
            "HttpWebRequest", ".AddRange(", "Content-Range", "If-Range",
            "ETag", "Last-Modified", "ZipArchive", "Threading.Mutex", "Global\\",
            "DefaultWebProxy", "Tls12", "Get-CimInstance", "ARM64",
            "installation-receipt", "File]::Replace", "-Repair", "-Force",
        ]:
            self.assertIn(phrase, text)
        self.assertIn("$defaultProxy = [Net.WebRequest]::DefaultWebProxy", text)
        self.assertIn("if ($defaultProxy)", text)
        self.assertEqual(1, text.count(f'Write-Output "{SUCCESS}"'))

    def test_installer_has_no_path_based_tool_invocation(self):
        text = INSTALLER.read_text(encoding="utf-8-sig")
        for command in ("node", "npm", "npx", "git", "tar"):
            self.assertNotRegex(
                text, rf"(?im)^\s*(?:&\s*)?{command}(?:\.exe)?\b", command
            )


if __name__ == "__main__":
    unittest.main()

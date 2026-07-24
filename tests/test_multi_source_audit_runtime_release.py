import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import unittest
import tempfile
import zipfile
import tarfile
from pathlib import Path

from tooling.build_multi_source_audit_runtime import (
    extract,
    build_runtime_metadata,
    build_bundle_metadata,
    render_release_assets,
)


ROOT = Path(__file__).resolve().parents[1]
PACKAGE = ROOT / "skill-sources" / "multi-source-test-audit" / "packaging"
CMD_SOURCE = PACKAGE.parent / "scripts" / "install-multi-source-test-audit.cmd"


class MultiSourceAuditBootstrapperContractTest(unittest.TestCase):
    def test_cmd_is_a_standalone_v014_bootstrapper_template(self):
        text = CMD_SOURCE.read_text(encoding="utf-8")
        self.assertIn('set "BOOTSTRAP_VERSION=0.1.4"', text)
        self.assertIn(
            "https://github.com/Saitamasans/testing-skills/releases/download/"
            "multi-source-test-audit-v0.1.4/install-multi-source-test-audit.ps1",
            text,
        )
        self.assertIn("__INSTALLER_SHA256__", text)
        self.assertIn("curl.exe", text)
        self.assertIn("Invoke-WebRequest", text)
        self.assertIn("curl.exe 下载 PS1 失败，回退 Windows PowerShell", text)
        self.assertIn(":download_with_powershell", text)
        self.assertIn("pause", text.casefold())
        for phrase in ["安装失败", "错误码", "日志位置", "建议操作", "预期 SHA-256", "实际 SHA-256", "TESTING_SKILLS_NO_PAUSE"]:
            self.assertIn(phrase, text)
        self.assertNotIn("%~dp0install-multi-source-test-audit.ps1", text)

    def test_rendered_cmd_embeds_exact_rendered_ps1_sha(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            archive_name = json.loads((PACKAGE / "release-contract.json").read_text(encoding="utf-8"))["archive_name"]
            archive = root / archive_name
            bundle = root / "bundle" / "multi-source-test-audit"
            (bundle / "runtime").mkdir(parents=True)
            (bundle / "runtime" / "runtime-manifest.json").write_text("{}\n", encoding="utf-8")
            (bundle / "bundle-manifest.json").write_text('{"files":[]}\n', encoding="utf-8")
            with zipfile.ZipFile(archive, "w") as output:
                for path in sorted(bundle.parent.rglob("*")):
                    if path.is_file():
                        output.write(path, path.relative_to(bundle.parent).as_posix())
            assets = render_release_assets(archive, root / "assets")
            rendered_ps1 = (root / "assets" / "install-multi-source-test-audit.ps1").read_bytes()
            rendered_cmd_bytes = (root / "assets" / "install-multi-source-test-audit.cmd").read_bytes()
            rendered_cmd = rendered_cmd_bytes.decode("utf-8")
            self.assertIn(hashlib.sha256(rendered_ps1).hexdigest(), rendered_cmd)
            self.assertNotIn("__INSTALLER_SHA256__", rendered_cmd)
            self.assertIn(b"\r\n", rendered_cmd_bytes)
            self.assertEqual(5, len(assets))

    @unittest.skipUnless(
        os.name == "nt" and shutil.which("cmd.exe") and shutil.which("powershell.exe") and os.environ.get("MSA_FINAL_ARCHIVE"),
        "Windows CMD and a final archive are required for the CMD-only integration fixture",
    )
    def test_cmd_only_fixture_downloads_ps1_and_installs_from_empty_directory(self):
        archive = Path(os.environ["MSA_FINAL_ARCHIVE"])
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            assets = root / "assets"
            render_release_assets(archive, assets)
            handler = partial(SimpleHTTPRequestHandler, directory=str(assets))
            server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                public_url = "https://github.com/Saitamasans/testing-skills/releases/download/multi-source-test-audit-v0.1.4/install-multi-source-test-audit.ps1"
                fixture_url = f"http://127.0.0.1:{server.server_address[1]}/install-multi-source-test-audit.ps1"
                fixture_archive_url = f"http://127.0.0.1:{server.server_address[1]}/{archive.name}"
                only_cmd = root / "only-cmd"
                only_cmd.mkdir()
                launcher = only_cmd / "install-multi-source-test-audit.cmd"
                launcher.write_bytes(
                    (assets / "install-multi-source-test-audit.cmd").read_bytes().replace(
                        public_url.encode("utf-8"), fixture_url.encode("utf-8")
                    )
                )
                install = root / "安装 with spaces"
                state = root / "状态 中文"
                env = os.environ.copy()
                env["TESTING_SKILLS_NO_PAUSE"] = "1"
                fake_bin = root / "fake-curl"
                fake_bin.mkdir()
                shutil.copy2(Path(os.environ["SystemRoot"]) / "System32" / "where.exe", fake_bin / "curl.exe")
                fallback_env = env.copy()
                fallback_env["PATH"] = ";".join([
                    str(fake_bin),
                    os.environ["SystemRoot"] + "\\System32",
                    os.environ["SystemRoot"] + "\\System32\\WindowsPowerShell\\v1.0",
                ])
                command = [
                    "cmd.exe", "/d", "/c", "call", str(launcher),
                    "-AllowLocalFixture", "-ReleaseUrl", fixture_archive_url,
                    "-InstallRoot", str(install), "-StateRoot", str(state),
                ]
                result = subprocess.run(
                    command,
                    cwd=only_cmd,
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    check=False,
                    env=fallback_env,
                )
                self.assertEqual(0, result.returncode, result.stdout + result.stderr)
                self.assertIn("multi-source-test-audit 0.1.4", result.stdout + result.stderr)
                receipt = json.loads((state / "installations" / "multi-source-test-audit.json").read_text(encoding="utf-8"))
                self.assertEqual("0.1.4", receipt["version"])
                self.assertEqual("passed", receipt["smoke_status"])
                forced = subprocess.run(
                    command + ["-Force"],
                    cwd=only_cmd,
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    check=False,
                    env=env,
                )
                self.assertEqual(0, forced.returncode, forced.stdout + forced.stderr)
                repaired = subprocess.run(
                    command + ["-Repair"],
                    cwd=only_cmd,
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    check=False,
                    env=env,
                )
                self.assertEqual(0, repaired.returncode, repaired.stdout + repaired.stderr)
                receipt = json.loads((state / "installations" / "multi-source-test-audit.json").read_text(encoding="utf-8"))
                self.assertTrue(receipt["repaired"])
                self.assertEqual({launcher.name}, {path.name for path in only_cmd.iterdir()})
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=5)

    @unittest.skipUnless(
        os.name == "nt" and shutil.which("cmd.exe") and shutil.which("powershell.exe") and os.environ.get("MSA_FINAL_ARCHIVE"),
        "Windows CMD and a final archive are required for the CMD-only failure fixture",
    )
    def test_cmd_only_fixture_reports_wrong_ps1_sha_without_receipt(self):
        archive = Path(os.environ["MSA_FINAL_ARCHIVE"])
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            assets = root / "assets"
            render_release_assets(archive, assets)
            handler = partial(SimpleHTTPRequestHandler, directory=str(assets))
            server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                public_url = "https://github.com/Saitamasans/testing-skills/releases/download/multi-source-test-audit-v0.1.4/install-multi-source-test-audit.ps1"
                fixture_url = f"http://127.0.0.1:{server.server_address[1]}/install-multi-source-test-audit.ps1"
                only_cmd = root / "only-cmd"
                only_cmd.mkdir()
                launcher = only_cmd / "install-multi-source-test-audit.cmd"
                launcher_text = (assets / "install-multi-source-test-audit.cmd").read_text(encoding="utf-8")
                launcher_text = launcher_text.replace(public_url, fixture_url).replace(
                    re.search(r'set "EXPECTED_PS1_SHA256=[0-9a-f]+"', launcher_text, re.I).group(0),
                    'set "EXPECTED_PS1_SHA256=' + ('0' * 64) + '"',
                )
                launcher.write_text(launcher_text, encoding="utf-8", newline="\r\n")
                state = root / "state"
                env = os.environ.copy()
                env["TESTING_SKILLS_NO_PAUSE"] = "1"
                result = subprocess.run(
                    ["cmd.exe", "/d", "/c", "call", str(launcher), "-InstallRoot", str(root / "install"), "-StateRoot", str(state)],
                    cwd=only_cmd,
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    check=False,
                    env=env,
                )
                output = result.stdout + result.stderr
                self.assertNotEqual(0, result.returncode, output)
                self.assertIn("PS1 SHA-256", output)
                self.assertIn("预期 SHA-256", output)
                self.assertIn("实际 SHA-256", output)
                self.assertIn("日志位置", output)
                self.assertFalse((state / "installations" / "multi-source-test-audit.json").exists())
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=5)

    @unittest.skipUnless(
        os.name == "nt" and shutil.which("cmd.exe") and shutil.which("powershell.exe") and os.environ.get("MSA_FINAL_ARCHIVE"),
        "Windows CMD and a final archive are required for the CMD-only failure fixture",
    )
    def test_cmd_only_fixture_reports_ps1_download_failure_with_log(self):
        archive = Path(os.environ["MSA_FINAL_ARCHIVE"])
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            assets = root / "assets"
            render_release_assets(archive, assets)
            handler = partial(SimpleHTTPRequestHandler, directory=str(assets))
            server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                public_url = "https://github.com/Saitamasans/testing-skills/releases/download/multi-source-test-audit-v0.1.4/install-multi-source-test-audit.ps1"
                fixture_url = f"http://127.0.0.1:{server.server_address[1]}/missing.ps1"
                only_cmd = root / "only-cmd"
                only_cmd.mkdir()
                launcher = only_cmd / "install-multi-source-test-audit.cmd"
                launcher.write_bytes(
                    (assets / "install-multi-source-test-audit.cmd").read_bytes().replace(
                        public_url.encode("utf-8"), fixture_url.encode("utf-8")
                    )
                )
                state = root / "state"
                env = os.environ.copy()
                env["TESTING_SKILLS_NO_PAUSE"] = "1"
                result = subprocess.run(
                    ["cmd.exe", "/d", "/c", "call", str(launcher), "-InstallRoot", str(root / "install"), "-StateRoot", str(state)],
                    cwd=only_cmd,
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    check=False,
                    env=env,
                )
                output = result.stdout + result.stderr
                self.assertNotEqual(0, result.returncode, output)
                self.assertIn("安装失败", output)
                self.assertIn("日志位置", output)
                self.assertFalse((state / "installations" / "multi-source-test-audit.json").exists())
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=5)



class MultiSourceAuditRuntimeReleaseContractTest(unittest.TestCase):
    def _run_rendered_fixture_install(self, *, archive: Path, install: Path, state: Path, sha256: str | None = None):
        with tempfile.TemporaryDirectory() as raw:
            assets = Path(raw) / "assets"
            render_release_assets(archive, assets)
            handler = partial(SimpleHTTPRequestHandler, directory=str(assets))
            server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                url = f"http://127.0.0.1:{server.server_address[1]}/{archive.name}"
                command = [
                    "powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass",
                    "-File", str(assets / "install-multi-source-test-audit.ps1"),
                    "-AllowLocalFixture", "-ReleaseUrl", url,
                    "-InstallRoot", str(install), "-StateRoot", str(state),
                ]
                if sha256 is not None:
                    command.extend(["-ReleaseSha256", sha256])
                env = os.environ.copy()
                env["PSModulePath"] = ";".join(
                    [
                        env.get("PSModulePath", ""),
                        r"C:\Windows\System32\WindowsPowerShell\v1.0\Modules",
                    ]
                )
                return subprocess.run(command, capture_output=True, text=True, check=False, env=env)
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=5)

    @unittest.skipUnless(os.environ.get("MSA_FINAL_ARCHIVE"), "set MSA_FINAL_ARCHIVE for full rendered installer integration")
    def test_rendered_installer_really_installs_v014_and_writes_receipt(self):
        archive = Path(os.environ["MSA_FINAL_ARCHIVE"])
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            result = self._run_rendered_fixture_install(
                archive=archive, install=root / "install with spaces", state=root / "state 中文"
            )
            self.assertEqual(0, result.returncode, result.stderr + result.stdout)
            self.assertNotIn("release_not_published", result.stderr + result.stdout)
            receipt = json.loads((root / "state 中文/installations/multi-source-test-audit.json").read_text(encoding="utf-8"))
            self.assertEqual("0.1.4", receipt["version"])
            self.assertEqual("passed", receipt["smoke_status"])

    @unittest.skipUnless(os.environ.get("MSA_FINAL_ARCHIVE"), "set MSA_FINAL_ARCHIVE for full rendered installer integration")
    def test_rendered_installer_rejects_wrong_sha_without_receipt(self):
        archive = Path(os.environ["MSA_FINAL_ARCHIVE"])
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            state = root / "state"
            result = self._run_rendered_fixture_install(
                archive=archive, install=root / "install", state=state, sha256="0" * 64
            )
            self.assertNotEqual(0, result.returncode)
            self.assertIn("SHA-256 mismatch", result.stderr + result.stdout)
            self.assertFalse((state / "installations/multi-source-test-audit.json").exists())

    def test_runtime_manifest_contract_is_explicit_and_hashes_key_files(self):
        manifest = build_runtime_metadata(
            slug="multi-source-test-audit",
            runtime_version="0.1.4",
            python_version="3.12.10",
            dependencies={"openpyxl": "3.1.5", "cryptography": "49.0.0", "cffi": "2.1.0", "et_xmlfile": "2.0.0", "pycparser": "3.0"},
            key_files={"python/python.exe": "a" * 64, "app/multi_source_test_audit/__main__.py": "b" * 64},
        )
        self.assertEqual("multi-source-test-audit", manifest["slug"])
        self.assertEqual("0.1.4", manifest["runtime_version"])
        self.assertEqual("3.12.10", manifest["python_version"])
        self.assertEqual("windows-x64", manifest["platform"])
        self.assertEqual(
            {"openpyxl": "3.1.5", "cryptography": "49.0.0", "cffi": "2.1.0", "et_xmlfile": "2.0.0", "pycparser": "3.0"},
            manifest["dependencies"],
        )
        self.assertEqual("runtime/python/python.exe", manifest["python_executable"])
        self.assertEqual("runtime/app/multi_source_test_audit/__main__.py", manifest["application_entry"])
        self.assertEqual(
            ["schemas/stage-a-analysis.schema.json", "schemas/selected-chain-plan.schema.json"],
            manifest["schemas"],
        )
        self.assertIn("key_files", manifest)
        self.assertTrue(manifest["key_files"])
        for relative, sha256 in manifest["key_files"].items():
            self.assertRegex(relative, r"^[^\\]+(?:/[^\\]+)*$")
            self.assertRegex(sha256, r"^[0-9a-f]{64}$")
        self.assertIn("python312._pth", manifest["isolation"])

    def test_bundle_manifest_has_complete_file_inventory_and_receipt_contract(self):
        manifest = build_bundle_metadata(
            slug="multi-source-test-audit",
            runtime_version="0.1.4",
            files=[{"path": "VERSION", "sha256": "a" * 64, "size": 4}],
        )
        self.assertEqual("multi-source-test-audit", manifest["slug"])
        self.assertEqual("0.1.4", manifest["runtime_version"])
        self.assertTrue(manifest["files"])
        paths = {item["path"] for item in manifest["files"]}
        self.assertEqual(len(paths), len(manifest["files"]))
        for item in manifest["files"]:
            self.assertRegex(item["path"], r"^[^\\/]+(?:/[^\\/]+)*$")
            self.assertRegex(item["sha256"], r"^[0-9a-f]{64}$")
            self.assertIsInstance(item["size"], int)
            self.assertGreaterEqual(item["size"], 0)
        installer = (PACKAGE.parent / "scripts" / "install-multi-source-test-audit.ps1").read_text(encoding="utf-8")
        self.assertIn("[Net.ServicePointManager]::SecurityProtocol", installer)
        self.assertIn("for ($attempt = 1; $attempt -le 3; $attempt++)", installer)
        for field in ["slug", "version", "release_tag", "archive_sha256", "bundle_manifest_sha256", "installation_path", "installed_at", "python_version", "openpyxl_version", "cryptography_version", "cffi_version", "smoke_status", "repaired", "installer_version"]:
            self.assertIn(field, installer)

    def test_release_asset_renderer_injects_archive_identity_and_checksums(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            archive = root / "multi-source-test-audit-0.1.4-windows-x64.zip"
            bundle = root / "bundle" / "multi-source-test-audit"
            (bundle / "runtime").mkdir(parents=True)
            (bundle / "runtime" / "runtime-manifest.json").write_text("{}\n", encoding="utf-8")
            (bundle / "bundle-manifest.json").write_text("{\"files\":[]}\n", encoding="utf-8")
            with zipfile.ZipFile(archive, "w") as output:
                for path in sorted(bundle.parent.rglob("*")):
                    if path.is_file():
                        output.write(path, path.relative_to(bundle.parent).as_posix())
            assets = render_release_assets(archive, root / "assets")
            self.assertEqual(
                {"SHA256SUMS.txt", "install-multi-source-test-audit.cmd", "install-multi-source-test-audit.ps1", "multi-source-test-audit-0.1.4-windows-x64.zip", "release-manifest.json"},
                {path.name for path in assets},
            )
            installer = (root / "assets" / "install-multi-source-test-audit.ps1").read_text(encoding="utf-8")
            self.assertNotIn("__ARCHIVE_SHA256__", installer)
            self.assertIn("$script:PublishedArchiveSha256 = '" + hashlib.sha256(archive.read_bytes()).hexdigest() + "'", installer)
            self.assertIn("$placeholder = '__' + 'ARCHIVE_SHA256__'", installer)
            launcher = (root / "assets" / "install-multi-source-test-audit.cmd").read_text(encoding="utf-8")
            self.assertIn(
                'set "EXPECTED_PS1_SHA256=' + hashlib.sha256((root / "assets" / "install-multi-source-test-audit.ps1").read_bytes()).hexdigest() + '"',
                launcher,
            )
            sums = (root / "assets" / "SHA256SUMS.txt").read_text(encoding="utf-8")
            self.assertIn("multi-source-test-audit-0.1.4-windows-x64.zip", sums)

    @unittest.skipUnless(shutil.which("powershell.exe"), "PowerShell is required for template execution")
    def test_unrendered_template_fails_closed_and_rendered_guard_is_not_replaced(self):
        source = PACKAGE.parent / "scripts" / "install-multi-source-test-audit.ps1"
        text = source.read_text(encoding="utf-8")
        self.assertIn("$script:PublishedArchiveSha256 = '__ARCHIVE_SHA256__'", text)
        self.assertIn("$placeholder = '__' + 'ARCHIVE_SHA256__'", text)
        result = subprocess.run(
            ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(source)],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(30, result.returncode)
        self.assertIn("release_not_published", result.stderr + result.stdout)

    def test_release_workflow_checks_only_rendered_text_not_binary_payload(self):
        workflow = (ROOT / ".github/workflows/publish-multi-source-test-audit-runtime.yml").read_text(encoding="utf-8")
        self.assertIn("$renderedInstaller = Get-Content -LiteralPath", workflow)
        self.assertIn("$renderedInstaller.Contains('__ARCHIVE_SHA256__')", workflow)
        self.assertIn("$renderedLauncher = Get-Content -LiteralPath", workflow)
        self.assertIn("$renderedLauncher.Contains('__INSTALLER_SHA256__')", workflow)
        self.assertIn("CMD does not authorize the rendered PS1 SHA-256", workflow)
        self.assertIn("Execute standalone CMD bootstrapper fixture from an empty directory", workflow)
        self.assertNotIn("Get-ChildItem $assets -File | Select-String", workflow)

    def test_safe_extract_accepts_dos_regular_file_and_rejects_unsafe_variants(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            regular = root / "regular.zip"
            with zipfile.ZipFile(regular, "w") as archive:
                info = zipfile.ZipInfo("python.exe")
                info.create_system = 0
                info.external_attr = 0x81FF0000
                archive.writestr(info, b"regular")
            extract(regular, root / "regular")
            self.assertEqual(b"regular", (root / "regular" / "python.exe").read_bytes())
            for name, entries in {
                "unix-link": [("link", b"target", 3, 0o120777 << 16)],
                "traversal": [("../escape", b"x", 0, 0)],
                "absolute": [("/escape", b"x", 0, 0)],
                "duplicate-case": [("A.txt", b"one", 0, 0), ("a.txt", b"two", 0, 0)],
                "duplicate-slash": [("a/b.txt", b"one", 0, 0), ("a\\b.txt", b"two", 0, 0)],
            }.items():
                archive_path = root / f"{name}.zip"
                with zipfile.ZipFile(archive_path, "w") as archive:
                    for member, body, system, attributes in entries:
                        info = zipfile.ZipInfo(member); info.create_system = system; info.external_attr = attributes
                        archive.writestr(info, body)
                with self.assertRaises(RuntimeError):
                    extract(archive_path, root / name)
    def test_runtime_and_wheel_locks_are_exact_and_complete(self):
        python_lock = json.loads((PACKAGE / "python-runtime-lock.json").read_text(encoding="utf-8"))
        wheels = json.loads((PACKAGE / "wheel-lock.json").read_text(encoding="utf-8"))

        self.assertEqual("0.1.4", python_lock["runtime_version"])
        self.assertEqual("3.12.10", python_lock["python_version"])
        self.assertEqual(
            "4acbed6dd1c744b0376e3b1cf57ce906f9dc9e95e68824584c8099a63025a3c3",
            python_lock["sha256"],
        )
        self.assertEqual(
            {"openpyxl", "cryptography", "cffi", "et_xmlfile", "pycparser"},
            {item["package"] for item in wheels["wheels"]},
        )
        for item in wheels["wheels"]:
            with self.subTest(package=item["package"]):
                self.assertRegex(item["sha256"], r"^[0-9a-f]{64}$")
                self.assertTrue(item["download_url"].startswith("https://"))
                self.assertTrue(item["filename"].endswith(".whl"))
                self.assertTrue(item["license"])
                self.assertIn(item["dependency_type"], {"direct", "transitive"})

    def test_release_identity_has_no_development_version(self):
        version = (ROOT / "skill-sources/multi-source-test-audit/runtime/multi_source_test_audit/version.py").read_text(encoding="utf-8")
        self.assertIn('__version__ = "0.1.4"', version)
        self.assertNotIn("0.1.0.dev0", version)

    def test_release_contract_declares_only_the_expected_windows_asset(self):
        contract = json.loads((PACKAGE / "release-contract.json").read_text(encoding="utf-8"))
        self.assertEqual("multi-source-test-audit", contract["slug"])
        self.assertEqual("0.1.4", contract["version"])
        self.assertEqual(
            "multi-source-test-audit-0.1.4-windows-x64.zip",
            contract["archive_name"],
        )
        self.assertRegex(contract["archive_sha256"], r"^[0-9a-f]{64}$")
        self.assertGreater(contract["archive_size_bytes"], 0)
        licenses = (PACKAGE / "THIRD_PARTY_LICENSES.md").read_text(encoding="utf-8")
        for package in ["openpyxl", "cryptography", "cffi", "et_xmlfile", "pycparser"]:
            self.assertIn(package, licenses)

    def test_license_source_lock_has_separate_verified_sources(self):
        sources = json.loads((PACKAGE / "license-source-lock.json").read_text(encoding="utf-8"))["sources"]
        by_package = {item["package"]: item for item in sources}
        self.assertEqual({"CPython", "openpyxl", "et_xmlfile"}, set(by_package))
        for package, member in [("openpyxl", "openpyxl-3.1.5/LICENCE.rst"), ("et_xmlfile", "et_xmlfile-2.0.0/LICENCE.rst")]:
            item = by_package[package]
            self.assertEqual(member, item["archive_member"])
            self.assertRegex(item["archive_sha256"], r"^[0-9a-f]{64}$")
            self.assertRegex(item["extracted_content_sha256"], r"^[0-9a-f]{64}$")
            self.assertTrue(item["immutable_url"].startswith("https://"))

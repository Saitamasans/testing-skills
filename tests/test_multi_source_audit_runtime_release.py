import hashlib
import json
import os
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
    def test_rendered_installer_really_installs_v011_and_writes_receipt(self):
        archive = Path(os.environ["MSA_FINAL_ARCHIVE"])
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            result = self._run_rendered_fixture_install(
                archive=archive, install=root / "install with spaces", state=root / "state 中文"
            )
            self.assertEqual(0, result.returncode, result.stderr + result.stdout)
            self.assertNotIn("release_not_published", result.stderr + result.stdout)
            receipt = json.loads((root / "state 中文/installations/multi-source-test-audit.json").read_text(encoding="utf-8"))
            self.assertEqual("0.1.1", receipt["version"])
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
            runtime_version="0.1.1",
            python_version="3.12.10",
            dependencies={"openpyxl": "3.1.5", "cryptography": "49.0.0", "cffi": "2.1.0", "et_xmlfile": "2.0.0", "pycparser": "3.0"},
            key_files={"python/python.exe": "a" * 64, "app/multi_source_test_audit/__main__.py": "b" * 64},
        )
        self.assertEqual("multi-source-test-audit", manifest["slug"])
        self.assertEqual("0.1.1", manifest["runtime_version"])
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
            runtime_version="0.1.1",
            files=[{"path": "VERSION", "sha256": "a" * 64, "size": 4}],
        )
        self.assertEqual("multi-source-test-audit", manifest["slug"])
        self.assertEqual("0.1.1", manifest["runtime_version"])
        self.assertTrue(manifest["files"])
        paths = {item["path"] for item in manifest["files"]}
        self.assertEqual(len(paths), len(manifest["files"]))
        for item in manifest["files"]:
            self.assertRegex(item["path"], r"^[^\\/]+(?:/[^\\/]+)*$")
            self.assertRegex(item["sha256"], r"^[0-9a-f]{64}$")
            self.assertIsInstance(item["size"], int)
            self.assertGreaterEqual(item["size"], 0)
        installer = (PACKAGE.parent / "scripts" / "install-multi-source-test-audit.ps1").read_text(encoding="utf-8")
        for field in ["slug", "version", "release_tag", "archive_sha256", "bundle_manifest_sha256", "installation_path", "installed_at", "python_version", "openpyxl_version", "cryptography_version", "cffi_version", "smoke_status", "repaired", "installer_version"]:
            self.assertIn(field, installer)

    def test_release_asset_renderer_injects_archive_identity_and_checksums(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            archive = root / "multi-source-test-audit-0.1.1-windows-x64.zip"
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
                {"SHA256SUMS.txt", "install-multi-source-test-audit.cmd", "install-multi-source-test-audit.ps1", "multi-source-test-audit-0.1.1-windows-x64.zip", "release-manifest.json"},
                {path.name for path in assets},
            )
            installer = (root / "assets" / "install-multi-source-test-audit.ps1").read_text(encoding="utf-8")
            self.assertNotIn("__ARCHIVE_SHA256__", installer)
            self.assertIn("$script:PublishedArchiveSha256 = '" + hashlib.sha256(archive.read_bytes()).hexdigest() + "'", installer)
            self.assertIn("$placeholder = '__' + 'ARCHIVE_SHA256__'", installer)
            sums = (root / "assets" / "SHA256SUMS.txt").read_text(encoding="utf-8")
            self.assertIn("multi-source-test-audit-0.1.1-windows-x64.zip", sums)

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

        self.assertEqual("0.1.1", python_lock["runtime_version"])
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
        self.assertIn('__version__ = "0.1.1"', version)
        self.assertNotIn("0.1.0.dev0", version)

    def test_release_contract_declares_only_the_expected_windows_asset(self):
        contract = json.loads((PACKAGE / "release-contract.json").read_text(encoding="utf-8"))
        self.assertEqual("multi-source-test-audit", contract["slug"])
        self.assertEqual("0.1.1", contract["version"])
        self.assertEqual(
            "multi-source-test-audit-0.1.1-windows-x64.zip",
            contract["archive_name"],
        )
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

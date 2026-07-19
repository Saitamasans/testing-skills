import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile
import unittest
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
NODE = os.environ.get("TESTING_NODE") or shutil.which("node")
RENDERER = ROOT / "packages/testing-runner/scripts/render-windows-installers.mjs"
TAG = "web-api-test-execution-evidence-v1.0.0"
VERSION = "1.0.0"


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


class EighthSkillReleaseWorkflowContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        release_path = ROOT / ".github/workflows/publish-eighth-skill-runtime.yml"
        cls.release = release_path.read_text(encoding="utf-8") if release_path.exists() else ""
        cls.bundle = (
            ROOT / ".github/workflows/build-complete-windows-bundles.yml"
        ).read_text(encoding="utf-8")
        cls.publish_installers = (
            ROOT / ".github/workflows/publish-installers.yml"
        ).read_text(encoding="utf-8")
        runner_release_path = ROOT / ".github/workflows/publish-testing-runner.yml"
        cls.runner_release = (
            runner_release_path.read_text(encoding="utf-8")
            if runner_release_path.exists()
            else ""
        )

    def test_native_build_proves_host_image_ps51_and_space_before_bundle(self):
        for phrase in [
            "windows-2025",
            "windows-11-arm",
            "PROCESSOR_ARCHITECTURE",
            "ImageOS",
            "PSVersionTable.PSEdition",
            "PSVersionTable.PSVersion",
            "Get-PSDrive",
            'node-version: "22.23.1"',
            "node -p process.arch",
            "windows-runtime-lock.test.mjs",
            "build-windows-bundle.mjs",
            "installation-smoke-test.mjs",
            "smoke-diagnostics",
            "*.png",
            "*.zip",
            "*.xlsx",
            "*.html",
            "run-result.json",
            "*.log",
        ]:
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, self.bundle)
        self.assertIn("workflow_call:", self.bundle)
        self.assertNotIn("web-api-test-execution-evidence-v*", self.bundle)
        self.assertNotIn("shell: pwsh", self.bundle)
        self.assertIn("inputs.release_tag", self.bundle)
        self.assertRegex(self.bundle, r"(?s)inputs\.release_tag.*runtime lock release tag")

    def test_rendered_installer_runs_clean_room_on_both_native_architectures(self):
        job = re.search(
            r"(?ms)^  clean-room-install-smoke:\n(.*?)(?=^  [a-z][a-z-]+:\n)",
            self.release,
        )
        self.assertIsNotNone(job)
        text = job.group(1)
        for phrase in [
            "needs: assemble-release",
            "windows-2025",
            "windows-11-arm",
            "complete-windows-bundle-x64",
            "complete-windows-bundle-arm64",
            "install-web-api-test-execution-evidence.ps1",
            "-ManifestSha256",
            "-AllowLocalFixture",
            "empty-path",
            "installation-receipt",
            "*.png",
            "playwright-trace.zip",
            "*.xlsx",
            "*.html",
            "run-result.json",
            "*.jsonl",
            "TESTING_SKILLS_STATE_ROOT",
            "TESTING_SKILLS_INSTALL_ROOT",
            "testing-runner.ps1",
            "HTTP_PROXY",
            "AcceptTcpClientAsync",
        ]:
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, text)
        create_draft = re.search(
            r"(?ms)^  create-draft:\n(.*?)(?=^  [a-z][a-z-]+:\n)",
            self.release,
        )
        self.assertIsNotNone(create_draft)
        self.assertIn("clean-room-install-smoke", create_draft.group(1))

    def test_release_is_serial_draft_verified_protected_and_post_verified(self):
        for phrase in [
            "cancel-in-progress: false",
            "needs: validate-tag",
            "uses: ./.github/workflows/build-complete-windows-bundles.yml",
            "render-windows-installers.mjs",
            "gh release create",
            "--draft",
            "--verify-tag",
            "Verify draft release assets",
            'refs/tags/$RELEASE_TAG^{commit}',
            "environment: release",
            "gh release edit",
            "--draft=false",
            "Post-publish immutable URL verification",
            "releases/download/$tag",
        ]:
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, self.release)
        self.assertNotIn("--clobber", self.release)
        ordered = [
            "gh release create",
            "Verify draft release assets",
            "environment: release",
            "Post-publish immutable URL verification",
        ]
        positions = [self.release.find(phrase) for phrase in ordered]
        self.assertNotIn(-1, positions)
        self.assertEqual(sorted(positions), positions)

    def test_verified_artifact_is_rechecked_after_approval_and_immutability_is_advisory(self):
        create_draft = re.search(
            r"(?ms)^  create-draft:\n(.*?)(?=^  [a-z][a-z-]+:\n)",
            self.release,
        )
        publish = re.search(
            r"(?ms)^  publish-release:\n(.*?)(?=^  [a-z][a-z-]+:\n)",
            self.release,
        )
        post_publish = re.search(
            r"(?ms)^  post-publish-verify:\n(.*)\Z",
            self.release,
        )
        self.assertIsNotNone(create_draft)
        self.assertIsNotNone(publish)
        self.assertIsNotNone(post_publish)

        for job in [create_draft.group(1), publish.group(1)]:
            with self.subTest(job=job[:40]):
                self.assertIn("verified-eighth-runtime-release-assets", job)
                self.assertIn("gh release download", job)
                self.assertIn("diff --no-dereference --recursive", job)
                self.assertIn("sha256sum -c SHA256SUMS.txt", job)
                self.assertIn("target_commitish", job)

        advisory = re.search(
            r"(?ms)^  immutable-release-advisory:\n(.*?)(?=^  [a-z][a-z-]+:\n)",
            self.release,
        )
        self.assertIsNotNone(advisory)
        advisory_text = advisory.group(1)
        for phrase in [
            'gh api "repos/$GITHUB_REPOSITORY/immutable-releases"',
            "GH_TOKEN: ${{ secrets.IMMUTABLE_RELEASES_ADMIN_READ_TOKEN }}",
            "::warning::immutable release settings admin-read token is not configured",
            "::warning::immutable releases are not enabled",
            "exit 0",
        ]:
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, advisory_text)

        protected = publish.group(1)
        for phrase in [
            "environment: release",
            "value.draft",
            "value.tag_name",
            "value.target_commitish",
            "value.assets",
            "draft assets differ from verified artifact",
            'gh release edit "$RELEASE_TAG" --draft=false',
        ]:
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, protected)
        self.assertNotIn("IMMUTABLE_RELEASES_ADMIN_READ_TOKEN", protected)
        self.assertNotIn("immutable-releases", protected)
        edit = 'gh release edit "$RELEASE_TAG" --draft=false'
        if "diff --no-dereference --recursive" in protected and edit in protected:
            self.assertLess(
                protected.index("diff --no-dereference --recursive"),
                protected.index(edit),
            )

        post = post_publish.group(1)
        self.assertIn("releases/tags/$tag", post)
        self.assertIn("published release is not immutable", post)
        self.assertIn(".immutable", post)

    def test_existing_legal_drafts_are_resumed_without_replacing_assets(self):
        for name, workflow in [
            ("runtime", self.release),
            ("runner", self.runner_release),
        ]:
            create_draft = re.search(
                r"(?ms)^  create-draft:\n(.*?)(?=^  [a-z][a-z-]+:\n)",
                workflow,
            )
            self.assertIsNotNone(create_draft)
            text = create_draft.group(1)
            with self.subTest(workflow=name):
                self.assertIn("Existing legal draft found; reusing verified assets", text)
                self.assertIn("gh api", text)
                self.assertIn("value.draft", text)
                self.assertIn("value.tag_name", text)
                self.assertIn("value.target_commitish", text)
                self.assertIn("value.assets", text)
                self.assertIn("gh release download", text)
                self.assertIn("diff --no-dereference --recursive", text)
                self.assertIn("gh release create", text)
                self.assertNotIn("gh release upload", text)
                self.assertNotIn("--clobber", text)
                self.assertNotIn("Release already exists", text)

    def test_immutable_admin_advisory_runs_before_any_draft_creation(self):
        for name, workflow in [
            ("runtime", self.release),
            ("runner", self.runner_release),
        ]:
            advisory = workflow.find("  immutable-release-advisory:")
            draft = workflow.find("  create-draft:")
            with self.subTest(workflow=name):
                self.assertGreaterEqual(advisory, 0)
                self.assertGreater(draft, advisory)
                create_draft = re.search(
                    r"(?ms)^  create-draft:\n(.*?)(?=^  [a-z][a-z-]+:\n)",
                    workflow,
                )
                self.assertIn("immutable-release-advisory", create_draft.group(1))

    def test_permissions_are_scoped_to_mutating_and_attestation_jobs(self):
        self.assertIn("permissions:\n  contents: read", self.release)
        self.assertEqual(2, self.release.count("contents: write"))
        self.assertEqual(1, self.release.count("attestations: write"))
        self.assertEqual(1, self.release.count("id-token: write"))
        self.assertIn("actions/attest-build-provenance@", self.release)
        create_draft = re.search(
            r"(?ms)^  create-draft:\n(.*?)(?=^  [a-z][a-z-]+:\n)",
            self.release,
        )
        publish = re.search(
            r"(?ms)^  publish-release:\n(.*?)(?=^  [a-z][a-z-]+:\n)",
            self.release,
        )
        attest = re.search(
            r"(?ms)^  attest-release-assets:\n(.*?)(?=^  [a-z][a-z-]+:\n)",
            self.release,
        )
        self.assertIsNotNone(create_draft)
        self.assertIsNotNone(publish)
        self.assertIsNotNone(attest)
        self.assertIn("contents: write", create_draft.group(1))
        self.assertIn("contents: write", publish.group(1))
        self.assertNotIn("contents: write", attest.group(1))

    def test_release_contract_has_exact_assets_and_placeholder_gate(self):
        for name in [
            "web-api-test-execution-evidence-1.0.0-windows-x64.zip",
            "web-api-test-execution-evidence-1.0.0-windows-x64.manifest.json",
            "web-api-test-execution-evidence-1.0.0-windows-arm64.zip",
            "web-api-test-execution-evidence-1.0.0-windows-arm64.manifest.json",
            "install-web-api-test-execution-evidence.ps1",
            "install-web-api-test-execution-evidence.cmd",
            "install.ps1",
            "install-all.cmd",
            "SHA256SUMS.txt",
        ]:
            with self.subTest(name=name):
                self.assertIn(name, self.release)
        self.assertIn("unresolved placeholder", self.release)
        self.assertIn("github.sha", self.release)
        self.assertIn("target_commitish", self.release)
        self.assertIn("npm ci --ignore-scripts", self.release)

    def test_runtime_tag_commit_must_be_reachable_from_origin_main(self):
        validate = re.search(
            r"(?ms)^  validate-tag:\n(.*?)(?=^  [a-z][a-z-]+:\n)",
            self.release,
        )
        self.assertIsNotNone(validate)
        text = validate.group(1)

        fetch = "git fetch --no-tags origin main"
        ancestry = 'git merge-base --is-ancestor "$commit" "refs/remotes/origin/main"'
        for phrase in [fetch, ancestry]:
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, text)
        if fetch in text and ancestry in text:
            self.assertLess(text.index(fetch), text.index(ancestry))
            self.assertLess(text.index('commit="$(git rev-parse'), text.index(ancestry))

    def test_manual_release_workflows_fetch_the_reviewed_tag_before_resolving_it(self):
        for name, workflow in [
            ("runtime", self.release),
            ("runner", self.runner_release),
        ]:
            with self.subTest(workflow=name):
                fetch = 'git fetch --force origin "refs/tags/$tag:refs/tags/$tag"'
                resolve = 'commit="$(git rev-parse "refs/tags/$tag^{commit}")"'
                self.assertIn(fetch, workflow)
                self.assertIn(resolve, workflow)
                self.assertLess(workflow.index(fetch), workflow.index(resolve))

    def test_release_workflows_pin_every_third_party_action_to_a_full_commit(self):
        workflows = {
            "bundle": self.bundle,
            "runtime": self.release,
            "runner": self.runner_release,
            "installers": self.publish_installers,
        }
        action_use = re.compile(r"(?m)^\s*-?\s*uses:\s*([^\s#]+)(?:\s+#\s*(v\d+[^\r\n]*))?$")
        for workflow, text in workflows.items():
            self.assertTrue(text, f"{workflow} workflow is missing")
            for target, version_comment in action_use.findall(text):
                if target.startswith("./"):
                    continue
                with self.subTest(workflow=workflow, target=target):
                    self.assertRegex(target, r"^[^@]+@[a-f0-9]{40}$")
                    self.assertRegex(version_comment, r"^v\d+")

    def test_runner_112_release_is_immutable_attested_and_publicly_contract_verified(self):
        for phrase in [
            "testing-runner-v1.1.2",
            "saitamasans-testing-runner-1.1.2.tgz",
            "npm ci --ignore-scripts",
            "npm run pack:runner-release",
            "package.json",
            '"playwright": "1.61.1"',
            "dist/cli.js",
            "installation-smoke-test.mjs",
            "SHA256SUMS.txt",
            "actions/attest-build-provenance@",
            "gh attestation verify",
            "--draft",
            "environment: release",
            "immutable-releases",
            "--draft=false",
            "published Runner release is not immutable",
            "gh release download",
        ]:
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, self.runner_release)
        self.assertNotIn("--clobber", self.runner_release)
        publish = re.search(
            r"(?ms)^  publish-release:\n(.*?)(?=^  [a-z][a-z-]+:\n)",
            self.runner_release,
        )
        self.assertIsNotNone(publish)
        self.assertNotIn("IMMUTABLE_RELEASES_ADMIN_READ_TOKEN", publish.group(1))

    def test_runner_release_installs_its_pinned_ci_browser_before_tests(self):
        job = re.search(
            r"(?ms)^  build-and-contract-test:\n(.*?)(?=^  [a-z][a-z-]+:\n)",
            self.runner_release,
        )
        self.assertIsNotNone(job)
        text = job.group(1)
        install = "node node_modules/playwright/cli.js install chromium"
        test = "npm test --workspace @saitamasans/testing-runner"
        self.assertIn("runs-on: windows-2025", text)
        self.assertIn('test "$(node -p process.arch)" = "x64"', text)
        self.assertIn("timeout-minutes: 45", text)
        self.assertIn(install, text)
        self.assertIn(test, text)
        self.assertNotIn("sha256sum", text)
        self.assertIn("SHA256SUMS.txt", text)
        self.assertLess(text.index(install), text.index(test))

    def test_mutable_installer_publication_reverifies_provenance_and_exact_public_bytes(self):
        for phrase in [
            "concurrency:",
            "cancel-in-progress: false",
            'refs/tags/$RUNTIME_TAG^{commit}',
            "target_commitish",
            "value.assets",
            "exact runtime asset allowlist",
            "gh attestation verify",
            "github.com/$GITHUB_REPOSITORY/.github/workflows/publish-eighth-skill-runtime.yml",
            "git merge-base --is-ancestor",
            "diff --no-dereference --recursive",
            "public mutable installer assets differ from trusted current-main bytes",
        ]:
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, self.publish_installers)

    def test_post_public_verification_installs_through_public_cmd_on_native_x64_and_arm64(self):
        job = re.search(r"(?ms)^  post-publish-verify:\n(.*)\Z", self.release)
        self.assertIsNotNone(job)
        text = job.group(1)
        for phrase in [
            "windows-2025",
            "windows-11-arm",
            "PROCESSOR_ARCHITECTURE",
            "verified-eighth-runtime-release-assets",
            "diff --no-dereference --recursive",
            "install-web-api-test-execution-evidence.cmd",
            "TESTING_SKILLS_INSTALL_ROOT",
            "TESTING_SKILLS_STATE_ROOT",
            "installation-receipt",
            "smoke-result.json",
            "*.png",
            "playwright-trace.zip",
            "*.xlsx",
            "*.html",
            "run-result.json",
            "*.jsonl",
            "HTTP_PROXY",
            "AcceptTcpClientAsync",
            "testing-runner.ps1",
        ]:
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, text)

    def test_renderer_declares_its_zip_parser_dependency(self):
        package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
        runner_package = json.loads(
            (ROOT / "packages/testing-runner/package.json").read_text(encoding="utf-8")
        )
        self.assertEqual("0.10.14", package.get("devDependencies", {}).get("unzipper"))
        self.assertNotIn("unzipper", runner_package["dependencies"])
        lock = json.loads((ROOT / "package-lock.json").read_text(encoding="utf-8"))
        self.assertEqual(
            "0.10.14",
            lock["packages"][""]["devDependencies"]["unzipper"],
        )
        self.assertNotIn(
            "unzipper",
            lock["packages"]["packages/testing-runner"]["dependencies"],
        )
        self.assertEqual("0.10.14", lock["packages"]["node_modules/unzipper"]["version"])


@unittest.skipUnless(NODE, "Node is required for renderer contract tests")
class WindowsInstallerRendererContractTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.x64_bundle = self._bundle("x64")
        self.arm64_bundle = self._bundle("arm64")
        self.x64_manifest = self._manifest("x64", self.x64_bundle)
        self.arm64_manifest = self._manifest("arm64", self.arm64_bundle)

    def tearDown(self):
        self.temp.cleanup()

    def _bundle(self, arch):
        path = self.root / f"web-api-test-execution-evidence-{VERSION}-windows-{arch}.zip"
        payload = {
            "schema_version": 1,
            "bundle": {
                "name": "web-api-test-execution-evidence",
                "version": VERSION,
                "release_tag": TAG,
                "os": "windows",
                "arch": arch,
            },
            "components": {
                "node": {"version": "22.23.1"},
                "runner": {
                    "name": "@saitamasans/testing-runner",
                    "version": "1.1.2",
                    "download_url": (
                        "https://github.com/Saitamasans/testing-skills/releases/download/"
                        "testing-runner-v1.1.2/saitamasans-testing-runner-1.1.2.tgz"
                    ),
                    "sha256": "0db2c917eaf786fa9c03bacc9f33a058ef8a9b429bc111772c7833f82c664a07",
                    "size_bytes": 22769464,
                },
                "playwright": {
                    "version": "1.61.1",
                    "chromium_revision": "1228",
                    "chromium_headless_shell_revision": "1228",
                    "ffmpeg_revision": "1011",
                },
                "skill": {"name": "web-api-test-execution-evidence"},
            },
            "installed_size_bytes": 4,
            "files": [
                {
                    "path": "node/node.exe",
                    "size_bytes": 4,
                    "sha256": hashlib.sha256(b"node").hexdigest(),
                }
            ],
        }
        payload_bytes = (json.dumps(payload, indent=2) + "\n").encode()
        if not hasattr(self, "payload_bytes"):
            self.payload_bytes = {}
        self.payload_bytes[arch] = payload_bytes
        with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as bundle:
            bundle.writestr("bundle-manifest.json", payload_bytes)
        return path

    def _manifest(self, arch, bundle):
        name = f"web-api-test-execution-evidence-{VERSION}-windows-{arch}.manifest.json"
        value = {
            "schema_version": 1,
            "bundle": {
                "name": "web-api-test-execution-evidence",
                "version": VERSION,
                "release_tag": TAG,
                "os": "windows",
                "arch": arch,
            },
            "archive": {
                "file_name": bundle.name,
                "download_url": (
                    "https://github.com/Saitamasans/testing-skills/releases/download/"
                    f"{TAG}/{bundle.name}"
                ),
                "size_bytes": bundle.stat().st_size,
                "sha256": sha256(bundle),
            },
            "payload_manifest": {
                "path": "bundle-manifest.json",
                "size_bytes": len(self.payload_bytes[arch]),
                "sha256": hashlib.sha256(self.payload_bytes[arch]).hexdigest(),
            },
            "installed_size_bytes": 4 + len(self.payload_bytes[arch]),
        }
        path = self.root / name
        path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
        return path

    def _rewrite_bundle(self, arch, payload, *, update_payload_binding, duplicate=False):
        bundle_path = getattr(self, f"{arch}_bundle")
        manifest_path = getattr(self, f"{arch}_manifest")
        payload_bytes = (json.dumps(payload, indent=2) + "\n").encode()
        with zipfile.ZipFile(bundle_path, "w", compression=zipfile.ZIP_DEFLATED) as bundle:
            bundle.writestr("bundle-manifest.json", payload_bytes)
            if duplicate:
                bundle.writestr("BUNDLE-MANIFEST.JSON", payload_bytes)
        companion = json.loads(manifest_path.read_text())
        companion["archive"]["size_bytes"] = bundle_path.stat().st_size
        companion["archive"]["sha256"] = sha256(bundle_path)
        if update_payload_binding:
            companion["payload_manifest"]["size_bytes"] = len(payload_bytes)
            companion["payload_manifest"]["sha256"] = hashlib.sha256(payload_bytes).hexdigest()
        manifest_path.write_text(json.dumps(companion, indent=2) + "\n")

    def _run(self, output, *, cmd_template=None):
        command = [
            NODE,
            str(RENDERER),
            "--lock", str(ROOT / "packages/testing-runner/release/windows-runtime-lock.json"),
            "--x64-manifest", str(self.x64_manifest),
            "--x64-bundle", str(self.x64_bundle),
            "--arm64-manifest", str(self.arm64_manifest),
            "--arm64-bundle", str(self.arm64_bundle),
            "--complete-template", str(ROOT / "installers/templates/install-web-api-test-execution-evidence.ps1.in"),
            "--cmd-template", str(cmd_template or ROOT / "installers/templates/install-web-api-test-execution-evidence.cmd.in"),
            "--generic-template", str(ROOT / "scripts/install.ps1"),
            "--all-template", str(ROOT / "installers/install-all.cmd"),
            "--output", str(output),
        ]
        return subprocess.run(command, capture_output=True, text=True, check=False)

    def test_renders_manifest_to_ps1_to_cmd_to_all_hash_chain(self):
        output = self.root / "release"
        result = self._run(output)
        self.assertEqual(0, result.returncode, result.stdout + result.stderr)

        complete = output / "install-web-api-test-execution-evidence.ps1"
        launcher = output / "install-web-api-test-execution-evidence.cmd"
        generic = output / "install.ps1"
        all_launcher = output / "install-all.cmd"
        self.assertTrue(complete.read_bytes().startswith(b"\xef\xbb\xbf"))
        self.assertEqual(
            (ROOT / "scripts/install-web-api-test-execution-evidence.ps1").read_bytes(),
            (ROOT / "installers/templates/install-web-api-test-execution-evidence.ps1.in").read_bytes(),
        )
        complete_text = complete.read_text(encoding="utf-8-sig")
        self.assertIn(sha256(self.x64_manifest), complete_text)
        self.assertIn(sha256(self.arm64_manifest), complete_text)
        self.assertIn(f"INSTALLER_SHA256={sha256(complete)}", launcher.read_text(encoding="utf-8"))
        self.assertIn(sha256(complete), generic.read_text(encoding="utf-8-sig"))
        all_text = all_launcher.read_text(encoding="utf-8")
        self.assertIn(f"GENERIC_INSTALLER_SHA256={sha256(generic)}", all_text)
        self.assertIn(f"COMPLETE_INSTALLER_SHA256={sha256(complete)}", all_text)
        self.assertIn(f"releases/download/{TAG}/install.ps1", all_text)

        expected = {
            self.x64_bundle.name,
            self.arm64_bundle.name,
            self.x64_manifest.name,
            self.arm64_manifest.name,
            complete.name,
            launcher.name,
            generic.name,
            all_launcher.name,
            "SHA256SUMS.txt",
        }
        self.assertEqual(expected, {item.name for item in output.iterdir()})
        checksum_lines = (output / "SHA256SUMS.txt").read_text().splitlines()
        self.assertEqual(sorted(checksum_lines, key=lambda line: line.split("  ", 1)[1]), checksum_lines)
        self.assertEqual(8, len(checksum_lines))
        for path in [complete, launcher, generic, all_launcher]:
            self.assertNotRegex(path.read_text(encoding="utf-8-sig"), r"__[A-Z0-9_]+__")

    def test_rejects_wrong_architecture_without_writing_release_assets(self):
        value = json.loads(self.x64_manifest.read_text())
        value["bundle"]["arch"] = "arm64"
        self.x64_manifest.write_text(json.dumps(value) + "\n")
        output = self.root / "rejected"

        result = self._run(output)

        self.assertNotEqual(0, result.returncode)
        self.assertIn("architecture", result.stderr)
        self.assertFalse(output.exists())

    def test_rejects_archive_digest_mismatch_without_writing_release_assets(self):
        self.arm64_bundle.write_bytes(b"X" * self.arm64_bundle.stat().st_size)
        output = self.root / "rejected-digest"

        result = self._run(output)

        self.assertNotEqual(0, result.returncode)
        self.assertIn("SHA-256", result.stderr)
        self.assertFalse(output.exists())

    def test_rejects_tampered_inner_manifest_without_writing_release_assets(self):
        payload = json.loads(self.payload_bytes["arm64"])
        payload["installed_size_bytes"] += 1
        self._rewrite_bundle("arm64", payload, update_payload_binding=False)
        output = self.root / "rejected-inner-digest"

        result = self._run(output)

        self.assertNotEqual(0, result.returncode)
        self.assertIn("payload manifest SHA-256", result.stderr)
        self.assertFalse(output.exists())

    def test_rejects_inner_runtime_lock_mismatch_even_when_companion_is_updated(self):
        payload = json.loads(self.payload_bytes["x64"])
        payload["components"]["runner"]["version"] = "9.9.9"
        self._rewrite_bundle("x64", payload, update_payload_binding=True)
        output = self.root / "rejected-inner-runtime"

        result = self._run(output)

        self.assertNotEqual(0, result.returncode)
        self.assertIn("payload manifest runner.version", result.stderr)
        self.assertFalse(output.exists())

    def test_rejects_duplicate_inner_manifest_without_writing_release_assets(self):
        payload = json.loads(self.payload_bytes["x64"])
        self._rewrite_bundle(
            "x64",
            payload,
            update_payload_binding=True,
            duplicate=True,
        )
        output = self.root / "rejected-duplicate-inner-manifest"

        result = self._run(output)

        self.assertNotEqual(0, result.returncode)
        self.assertIn("exactly one bundle-manifest.json", result.stderr)
        self.assertFalse(output.exists())

    def test_rejects_wrong_release_tag_and_origin_without_writing_assets(self):
        for mutation, message in [
            (("bundle", "release_tag", "web-api-test-execution-evidence-v9.9.9"), "release_tag"),
            (("archive", "download_url", "https://example.com/foreign.zip"), "download_url"),
        ]:
            with self.subTest(message=message):
                value = json.loads(self.x64_manifest.read_text())
                section, field, replacement = mutation
                value[section][field] = replacement
                self.x64_manifest.write_text(json.dumps(value) + "\n")
                output = self.root / f"rejected-{message}"

                result = self._run(output)

                self.assertNotEqual(0, result.returncode)
                self.assertIn(message, result.stderr)
                self.assertFalse(output.exists())
                self.x64_manifest = self._manifest("x64", self.x64_bundle)

    def test_rejects_unresolved_template_placeholder_without_writing_assets(self):
        template = self.root / "bad.cmd.in"
        template.write_text(
            (ROOT / "installers/templates/install-web-api-test-execution-evidence.cmd.in").read_text()
            + "\nrem __UNRESOLVED_RELEASE_VALUE__\n",
            encoding="utf-8",
        )
        output = self.root / "rejected-placeholder"

        result = self._run(output, cmd_template=template)

        self.assertNotEqual(0, result.returncode)
        self.assertIn("unresolved placeholder", result.stderr)
        self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main()

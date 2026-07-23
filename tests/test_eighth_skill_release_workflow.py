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
TAG = "web-api-test-execution-evidence-v1.0.2"
VERSION = "1.0.2"


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
        windows_release_ci = ROOT / ".github/workflows/validate-runner-windows-release.yml"
        cls.windows_release_ci = windows_release_ci.read_text(encoding="utf-8") if windows_release_ci.exists() else ""
        packaged_smoke = ROOT / "packages/testing-runner/scripts/verify-release-tarball.mjs"
        cls.packaged_smoke = packaged_smoke.read_text(encoding="utf-8") if packaged_smoke.exists() else ""
        lifecycle = ROOT / "packages/testing-runner/scripts/release-draft-lifecycle.mjs"
        cls.release_lifecycle = lifecycle.read_text(encoding="utf-8") if lifecycle.exists() else ""

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

    def test_native_windows_build_forces_utf8_for_python_generation(self):
        job = re.search(r"(?ms)^  build-and-smoke:\n(.*)\Z", self.bundle)
        self.assertIsNotNone(job)
        self.assertRegex(job.group(1), r'env:\n\s+PYTHONUTF8: "1"')

    def test_x64_release_path_is_independent_from_arm64_validation(self):
        build_x64 = re.search(
            r"(?ms)^  build-x64:\n(.*?)(?=^  [a-z][a-z0-9-]+:\n)",
            self.release,
        )
        arm64 = re.search(
            r"(?ms)^  validate-arm64:\n(.*?)(?=^  [a-z][a-z0-9-]+:\n)",
            self.release,
        )
        assemble = re.search(
            r"(?ms)^  assemble-release:\n(.*?)(?=^  [a-z][a-z0-9-]+:\n)",
            self.release,
        )
        self.assertIsNotNone(build_x64)
        self.assertIsNotNone(arm64)
        self.assertIsNotNone(assemble)
        self.assertIn("architecture: x64", build_x64.group(1))
        self.assertIn("architecture: arm64", arm64.group(1))
        self.assertIn("non_blocking: true", arm64.group(1))
        self.assertIn("needs: [validate-tag, build-x64]", assemble.group(1))
        self.assertNotIn("validate-arm64", assemble.group(1))
        self.assertNotIn("complete-windows-bundle-arm64", assemble.group(1))
        self.assertNotIn("--arm64-manifest", assemble.group(1))
        self.assertNotIn("--arm64-bundle", assemble.group(1))

    def test_rendered_x64_installer_runs_clean_room_on_native_x64(self):
        job = re.search(
            r"(?ms)^  clean-room-install-smoke:\n(.*?)(?=^  [a-z][a-z-]+:\n)",
            self.release,
        )
        self.assertIsNotNone(job)
        text = job.group(1)
        for phrase in [
            "needs: assemble-release",
            "windows-2025",
            "complete-windows-bundle-x64",
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
        self.assertNotIn("windows-11-arm", text)
        self.assertNotIn("complete-windows-bundle-arm64", text)
        self.assertIn(
            "$volumeRoot = [IO.Path]::GetPathRoot($env:RUNNER_TEMP)",
            text,
        )
        self.assertIn(
            '$cleanRoot = Join-Path $volumeRoot ("r-" + [Guid]::NewGuid().ToString("N").Substring(0, 8))',
            text,
        )
        self.assertNotIn(
            '$cleanRoot = Join-Path $PWD "build/clean-room-${{ matrix.arch }}"',
            text,
        )
        self.assertIn("[IO.File]::WriteAllText(", text)
        self.assertIn("$localManifestPath,", text)
        self.assertIn("New-Object Text.UTF8Encoding($false)", text)
        self.assertNotIn(
            "$localManifest | ConvertTo-Json -Depth 20 | Set-Content",
            text,
        )
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
            "release-draft-lifecycle.mjs prepare",
            "release-draft-lifecycle.mjs publish",
            "release_id",
            "Verify draft release assets",
            'refs/tags/$RELEASE_TAG^{commit}',
            "environment: release",
            "Post-publish immutable URL verification",
            "releases/download/$tag",
        ]:
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, self.release)
        self.assertNotIn("--clobber", self.release)
        ordered = [
            "release-draft-lifecycle.mjs prepare",
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
                self.assertIn("release-draft-lifecycle.mjs download", job)
                self.assertIn("diff --no-dereference --recursive", job)
                self.assertIn("sha256sum -c SHA256SUMS.txt", job)
                self.assertIn("TAG_COMMIT", job)

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
            "needs.create-draft.outputs.release_id",
            "release-draft-lifecycle.mjs download",
            "release-draft-lifecycle.mjs publish",
            "draft assets differ from verified artifact",
        ]:
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, protected)
        self.assertNotIn("IMMUTABLE_RELEASES_ADMIN_READ_TOKEN", protected)
        self.assertNotIn("immutable-releases", protected)
        self.assertLess(
            protected.index("diff --no-dereference --recursive"),
            protected.index("release-draft-lifecycle.mjs publish"),
        )

        post = post_publish.group(1)
        self.assertIn("release-draft-lifecycle.mjs verify-public", post)
        self.assertIn("needs.create-draft.outputs.release_id", post)
        self.assertIn("release.immutable !== true", self.release_lifecycle)
        self.assertIn("::warning::", self.release_lifecycle)
        self.assertNotRegex(
            self.release_lifecycle,
            r"immutable\s*!==\s*true\).*throw new Error",
        )

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
                self.assertIn("release_id", text)
                self.assertIn("created_or_reused", text)
                self.assertIn("release-draft-lifecycle.mjs prepare", text)
                self.assertIn("release-draft-lifecycle.mjs download", text)
                self.assertIn("steps.draft.outputs.release_id", text)
                self.assertIn("diff --no-dereference --recursive", text)
                self.assertNotIn("releases/tags/", text)
                self.assertNotIn("gh release download", text)
                self.assertNotIn("gh release upload", text)
                self.assertNotIn("--clobber", text)
                self.assertNotIn("Release already exists", text)

    def test_runner_and_runtime_use_release_id_for_the_entire_draft_lifecycle(self):
        helper = "packages/testing-runner/scripts/release-draft-lifecycle.mjs"
        for name, workflow in [
            ("runtime", self.release),
            ("runner", self.runner_release),
        ]:
            create_draft = re.search(
                r"(?ms)^  create-draft:\n(.*?)(?=^  [a-z][a-z-]+:\n)",
                workflow,
            )
            publish = re.search(
                r"(?ms)^  publish-release:\n(.*?)(?=^  [a-z][a-z-]+:\n)",
                workflow,
            )
            post_publish = re.search(
                r"(?ms)^  post-publish-verify:\n(.*?)(?=^  [a-z][a-z-]+:\n|\Z)",
                workflow,
            )
            self.assertIsNotNone(create_draft)
            self.assertIsNotNone(publish)
            self.assertIsNotNone(post_publish)
            create_text = create_draft.group(1)
            publish_text = publish.group(1)
            post_text = post_publish.group(1)
            with self.subTest(workflow=name):
                for output in ["release_id", "release_url", "created_or_reused"]:
                    self.assertIn(output, create_text)
                self.assertIn(f"node {helper} prepare", create_text)
                self.assertIn(f"node {helper} download", create_text)
                self.assertIn("steps.draft.outputs.release_id", create_text)
                self.assertIn(f"node {helper} download", publish_text)
                self.assertIn(f"node {helper} publish", publish_text)
                self.assertIn("needs.create-draft.outputs.release_id", publish_text)
                self.assertIn(f"node {helper} verify-public", post_text)
                self.assertIn("needs.create-draft.outputs.release_id", post_text)
                for draft_job in [create_text, publish_text]:
                    self.assertNotIn("releases/tags/", draft_job)
                    self.assertNotIn("gh release download", draft_job)
                    self.assertNotIn("gh release edit", draft_job)
                    self.assertNotIn("--clobber", draft_job)
                self.assertNotRegex(
                    post_text,
                    r"immutable\s*!==\s*true\).*throw new Error",
                )

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

    def test_attestation_is_post_publish_advisory_not_a_p0_dependency(self):
        for name, workflow, job_name in [
            ("runtime", self.release, "attest-release-assets"),
            ("runner", self.runner_release, "attest-assets"),
        ]:
            attest = re.search(
                rf"(?ms)^  {job_name}:\n(.*?)(?=^  [a-z][a-z0-9-]+:\n)",
                workflow,
            )
            create_draft = re.search(
                r"(?ms)^  create-draft:\n(.*?)(?=^  [a-z][a-z0-9-]+:\n)",
                workflow,
            )
            publish = re.search(
                r"(?ms)^  publish-release:\n(.*?)(?=^  [a-z][a-z0-9-]+:\n)",
                workflow,
            )
            post = re.search(r"(?ms)^  post-publish-verify:\n(.*)\Z", workflow)
            self.assertIsNotNone(attest)
            self.assertIsNotNone(create_draft)
            self.assertIsNotNone(publish)
            self.assertIsNotNone(post)
            with self.subTest(workflow=name):
                self.assertIn("needs: post-publish-verify", attest.group(1))
                self.assertIn("continue-on-error: true", attest.group(1))
                self.assertIn("::warning::attestation", attest.group(1))
                self.assertNotIn(job_name, create_draft.group(1))
                self.assertNotIn("gh attestation verify", publish.group(1))
                self.assertNotIn("gh attestation verify", post.group(1))

        self.assertNotIn("gh attestation verify", self.publish_installers)

    def test_release_contract_has_exact_assets_and_placeholder_gate(self):
        for name in [
            "web-api-test-execution-evidence-1.0.2-windows-x64.zip",
            "web-api-test-execution-evidence-1.0.2-windows-x64.manifest.json",
            "install-web-api-test-execution-evidence.ps1",
            "install-web-api-test-execution-evidence.cmd",
            "install.ps1",
            "install-all.cmd",
            "SHA256SUMS.txt",
        ]:
            with self.subTest(name=name):
                self.assertIn(name, self.release)
        for name in [
            "web-api-test-execution-evidence-1.0.2-windows-arm64.zip",
            "web-api-test-execution-evidence-1.0.2-windows-arm64.manifest.json",
        ]:
            with self.subTest(excluded=name):
                assemble = re.search(
                    r"(?ms)^  assemble-release:\n(.*?)(?=^  [a-z][a-z0-9-]+:\n)",
                    self.release,
                )
                self.assertNotIn(name, assemble.group(1))
        self.assertIn("unresolved placeholder", self.release)
        self.assertIn("GITHUB_SHA", self.release)
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

    def test_runtime_dispatch_resolves_tag_without_matching_workflow_ref_sha(self):
        validate = re.search(
            r"(?ms)^  validate-tag:\n(.*?)(?=^  [a-z][a-z0-9-]+:\n)",
            self.release,
        )
        self.assertIsNotNone(validate)
        text = validate.group(1)
        equality = 'if [[ "$GITHUB_EVENT_NAME" == "push" ]]; then test "$commit" = "$GITHUB_SHA"; fi'
        self.assertIn(equality, text)
        self.assertNotIn('test "$commit" = "${{ github.sha }}"', text)

        self.assertIn("source_commit:", self.bundle)
        self.assertIn("ref: ${{ inputs.source_commit }}", self.bundle)
        for phrase in [
            "source_commit: ${{ needs.validate-tag.outputs.commit }}",
            "ref: ${{ needs.validate-tag.outputs.commit }}",
        ]:
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, self.release)

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
            "windows-release-ci": self.windows_release_ci,
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

    def test_runner_113_release_is_immutable_and_publicly_contract_verified(self):
        for phrase in [
            "testing-runner-v1.1.4",
            "saitamasans-testing-runner-1.1.4.tgz",
            "runner-1.1.4-release-lock.json",
            "locked-not-published",
            "npm ci --ignore-scripts",
            "npm run pack:runner-release",
            "package.json",
            '"playwright": "1.61.1"',
            "dist/cli.js",
            "installation-smoke-test.mjs",
            "SHA256SUMS.txt",
            "actions/attest-build-provenance@",
            "environment: release",
            "immutable-releases",
            "release-draft-lifecycle.mjs prepare",
            "release-draft-lifecycle.mjs download",
            "release-draft-lifecycle.mjs publish",
            "release-draft-lifecycle.mjs verify-public",
            "release_id",
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
        self.assertIn("release.immutable !== true", self.release_lifecycle)
        self.assertIn("is not reported as immutable", self.release_lifecycle)

    def test_runner_release_uses_the_dynamic_installation_smoke_version_contract(self):
        self.assertNotIn(
            'grep -F "1.1.2" packages/testing-runner/scripts/installation-smoke-test.mjs',
            self.runner_release,
        )
        for fixed_contract in [
            'EXPECTED_VERSION: 1.1.4',
            'RUNNER_ASSET: saitamasans-testing-runner-1.1.4.tgz',
            'pkg.version !== "1.1.4"',
            'cli.includes("1.1.4")',
            '["chromium", "1228"]',
        ]:
            with self.subTest(fixed_contract=fixed_contract):
                self.assertIn(fixed_contract, self.runner_release)

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

    def test_windows_x64_pr_ci_builds_twice_and_executes_the_packaged_tar(self):
        workflow = self.windows_release_ci
        for phrase in [
            "pull_request:",
            "permissions:\n  contents: read",
            "runs-on: windows-2025",
            'node-version: "22.23.1"',
            'npm --version) -cne "10.9.8"',
            "packages/testing-runner/release/package-lock.json",
            "build/release-a",
            "build/release-b",
            "Get-FileHash",
            "runner-1.1.4-release-lock.json",
            "saitamasans-testing-runner-1.1.4.tgz",
            "verify-release-tarball.mjs",
            "CompleteInstallerTest.test_clean_install_is_path_independent_and_writes_receipt_after_smoke",
            "CompleteInstallerTest.test_smoke_failure_retains_diagnostics_but_not_receipt",
            "CompleteInstallerTest.test_activation_failure_removes_staging_and_preserves_previous_install",
            "windows-x64-release-evidence",
        ]:
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, workflow)
        self.assertNotIn("contents: write", workflow)
        self.assertNotIn("Runner build differs from windows-runtime-lock.json", workflow)
        self.assertNotIn("release-a/saitamasans-testing-runner-1.1.2.tgz", workflow)

    def test_windows_x64_pr_ci_executes_the_real_runtime_long_path_installer_fixture(self):
        workflow = (ROOT / ".github/workflows/validate-runner-windows-release.yml").read_text(
            encoding="utf-8"
        )
        self.assertIn(
            "CompleteInstallerTest.test_real_runtime_long_path_installs_through_temporary_short_alias",
            workflow,
        )
        self.assertNotIn("gh release", workflow)
        release_docs = "\n".join(
            path.read_text(encoding="utf-8")
            for path in (ROOT / "docs/superpowers").rglob("*.md")
        )
        self.assertIn("Windows x64 is the P0 release path", release_docs)
        self.assertNotIn("publish only when both architectures pass", release_docs)
        self.assertNotIn("Publication is rejected if either architecture", release_docs)

    def test_packaged_tar_smoke_runs_outside_checkout_and_copies_only_evidence(self):
        for workflow in [self.windows_release_ci, self.runner_release]:
            with self.subTest(workflow=workflow.splitlines()[0]):
                self.assertIn("$env:RUNNER_TEMP", workflow)
                self.assertIn("runner-tar-smoke-", workflow)
                self.assertIn("[Guid]::NewGuid()", workflow)
                self.assertIn("finally", workflow)
                self.assertIn("Copy-Item", workflow)
                self.assertIn("Remove-Item -LiteralPath $smokeRoot -Recurse -Force", workflow)
                self.assertNotIn("build/windows-x64-release-evidence/packaged-tar", workflow)

        for phrase in [
            "workspace_realpath",
            "package_root_realpath",
            "package_outside_workspace",
            "package root must be outside GITHUB_WORKSPACE",
        ]:
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, self.packaged_smoke)

    def test_packaged_tar_smoke_blocks_downloads_and_root_dependencies(self):
        for phrase in [
            "package/node_modules",
            "dependency resolved outside packaged node_modules",
            '"--version"',
            '"plan"',
            '"run"',
            '"verify-report"',
            "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD",
            "blocked external network request",
            "blocked package manager invocation",
            "https://github.com/Saitamasans/testing-skills/releases/download/",
            "https://cdn.playwright.dev/",
            "network_events",
            "package_manager_invocations",
            "empty-path",
            "NODE_PATH",
        ]:
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, self.packaged_smoke)
        build = re.search(
            r"(?ms)^  build-and-contract-test:\n(.*?)(?=^  [a-z][a-z0-9-]+:\n)",
            self.runner_release,
        )
        self.assertIsNotNone(build)
        self.assertIn("verify-release-tarball.mjs", build.group(1))

    def test_runner_111_is_retired_and_113_is_the_current_publishable_target(self):
        retired = "testing-runner-v1.1.1"
        for relative in [
            ".github/workflows",
            "installers",
            "packages/testing-runner",
            "scripts",
            "skill-sources/web-api-test-execution-evidence",
            "skills/web-api-test-execution-evidence",
        ]:
            for path in (ROOT / relative).rglob("*"):
                if not path.is_file() or path.suffix.lower() in {".zip", ".tgz", ".pyc"}:
                    continue
                with self.subTest(path=path.relative_to(ROOT)):
                    self.assertNotIn(retired, path.read_text(encoding="utf-8", errors="ignore"))

        readme = (ROOT / "README.md").read_text(encoding="utf-8")
        self.assertIn("testing-runner-v1.1.1", readme)
        self.assertIn("未发布/作废发布目标", readme)
        self.assertIn("首个可发布目标为 `testing-runner-v1.1.2`", readme)
        self.assertIn('tags:\n      - "testing-runner-v1.1.4"', self.runner_release)
        self.assertNotIn('tags:\n      - "testing-runner-v1.1.1"', self.runner_release)

    def test_installer_entry_reverifies_runtime_and_frozen_release_without_mutation(self):
        for phrase in [
            "concurrency:",
            "cancel-in-progress: false",
            'refs/tags/$RUNTIME_TAG^{commit}',
            "target_commitish",
            "value.assets",
            "exact runtime asset allowlist",
            "git merge-base --is-ancestor",
            'refs/tags/skill-installers-v1^{commit}',
            "skill-installers-v1 is not the expected frozen public release",
            "frozen installer asset allowlist does not match",
            "sha256sum -c SHA256SUMS.txt",
            "frozen skill-installers-v1 remains unchanged",
        ]:
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, self.publish_installers)
        for forbidden in [
            "contents: write",
            "gh release delete-asset",
            "gh release upload",
            "gh release edit",
            "--clobber",
        ]:
            with self.subTest(forbidden=forbidden):
                self.assertNotIn(forbidden, self.publish_installers)

    def test_runtime_public_release_recovery_is_explicit_and_read_only(self):
        self.assertIn("public_release_id:", self.release)
        self.assertIn('RECOVERY_RELEASE_ID: ${{ inputs.public_release_id }}', self.release)
        self.assertNotIn("EXPECTED_PUBLIC_RELEASE_ID", self.release)
        self.assertNotIn("356413719", self.release)
        self.assertIn('[[ ! "$RECOVERY_RELEASE_ID" =~ ^[0-9]+$ ]]', self.release)

        create_draft = re.search(
            r"(?ms)^  create-draft:\n(.*?)(?=^  [a-z][a-z0-9-]+:\n)",
            self.release,
        )
        publish = re.search(
            r"(?ms)^  publish-release:\n(.*?)(?=^  [a-z][a-z0-9-]+:\n)",
            self.release,
        )
        post = re.search(r"(?ms)^  post-publish-verify:\n(.*)\Z", self.release)
        self.assertIsNotNone(create_draft)
        self.assertIsNotNone(publish)
        self.assertIsNotNone(post)

        for job in [create_draft.group(1), publish.group(1)]:
            self.assertIn("inputs.public_release_id == ''", job)
        self.assertIn("assemble-release", post.group(1))
        self.assertIn("clean-room-install-smoke", post.group(1))
        self.assertIn("needs.create-draft.result == 'skipped'", post.group(1))
        self.assertIn("needs.publish-release.result == 'skipped'", post.group(1))
        self.assertIn(
            "inputs.public_release_id || needs.create-draft.outputs.release_id",
            post.group(1),
        )
        self.assertIn("release-draft-lifecycle.mjs verify-public", post.group(1))
        self.assertNotIn("release-draft-lifecycle.mjs prepare", post.group(1))
        self.assertNotIn("release-draft-lifecycle.mjs publish", post.group(1))
        self.assertNotIn("gh release upload", post.group(1))
        self.assertNotIn("--clobber", post.group(1))

    def test_post_public_verification_uses_short_volume_root_and_cleans_it(self):
        job = re.search(r"(?ms)^  post-publish-verify:\n(.*)\Z", self.release)
        self.assertIsNotNone(job)
        text = job.group(1)
        self.assertIn("$volumeRoot = [IO.Path]::GetPathRoot($env:RUNNER_TEMP)", text)
        self.assertIn(
            '$isolated = Join-Path $volumeRoot ("r-" + [Guid]::NewGuid().ToString("N").Substring(0, 8))',
            text,
        )
        self.assertNotIn(
            '$isolated = Join-Path $PWD "build/public-install-${{ matrix.arch }}"',
            text,
        )
        self.assertIn("try {", text)
        self.assertIn("finally {", text)
        self.assertIn("public-install-paths.json", text)
        self.assertIn("dependency_network_attempted", text)
        self.assertIn("Remove-Item -LiteralPath $isolated -Recurse -Force", text)

    def test_post_public_verification_installs_through_public_cmd_on_native_x64(self):
        job = re.search(r"(?ms)^  post-publish-verify:\n(.*)\Z", self.release)
        self.assertIsNotNone(job)
        text = job.group(1)
        for phrase in [
            "windows-2025",
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
        self.assertNotIn("windows-11-arm", text)
        self.assertNotIn("windows-arm64", text)

    def test_mutable_installer_gate_uses_the_x64_p0_runtime_allowlist(self):
        self.assertIn("web-api-test-execution-evidence-1.0.2-windows-x64.zip", self.publish_installers)
        self.assertIn("web-api-test-execution-evidence-1.0.2-windows-x64.manifest.json", self.publish_installers)
        self.assertNotIn("web-api-test-execution-evidence-1.0.2-windows-arm64.zip", self.publish_installers)
        self.assertNotIn("web-api-test-execution-evidence-1.0.2-windows-arm64.manifest.json", self.publish_installers)

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

    def _run_x64_only(self, output):
        command = [
            NODE,
            str(RENDERER),
            "--lock", str(ROOT / "packages/testing-runner/release/windows-runtime-lock.json"),
            "--x64-manifest", str(self.x64_manifest),
            "--x64-bundle", str(self.x64_bundle),
            "--complete-template", str(ROOT / "installers/templates/install-web-api-test-execution-evidence.ps1.in"),
            "--cmd-template", str(ROOT / "installers/templates/install-web-api-test-execution-evidence.cmd.in"),
            "--generic-template", str(ROOT / "scripts/install.ps1"),
            "--all-template", str(ROOT / "installers/install-all.cmd"),
            "--output", str(output),
        ]
        return subprocess.run(command, capture_output=True, text=True, check=False)

    def test_renders_x64_only_release_without_arm64_assets_or_installer_route(self):
        output = self.root / "x64-release"
        result = self._run_x64_only(output)
        self.assertEqual(0, result.returncode, result.stdout + result.stderr)
        names = {item.name for item in output.iterdir()}
        self.assertIn(self.x64_bundle.name, names)
        self.assertIn(self.x64_manifest.name, names)
        self.assertNotIn(self.arm64_bundle.name, names)
        self.assertNotIn(self.arm64_manifest.name, names)
        complete = (output / "install-web-api-test-execution-evidence.ps1").read_text(encoding="utf-8-sig")
        self.assertIn('[ValidateSet("x64")]', complete)
        self.assertNotIn("windows-arm64.manifest.json", complete)
        self.assertNotIn('return "arm64"', complete)
        checksum_lines = (output / "SHA256SUMS.txt").read_text().splitlines()
        self.assertEqual(6, len(checksum_lines))

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

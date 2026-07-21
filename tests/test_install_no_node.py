import hashlib
import json
import os
import re
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
INSTALLER = ROOT / "scripts" / "install.ps1"
MANIFEST_SLUGS = {
    item["slug"]
    for item in json.loads(
        (ROOT / "tooling" / "skills-manifest.json").read_text(encoding="utf-8")
    )["skills"]
}


SYSTEM_ROOT = Path(os.environ.get("SystemRoot", r"C:\Windows"))
WINDOWS_POWERSHELL = (
    SYSTEM_ROOT / "System32" / "WindowsPowerShell" / "v1.0" / "powershell.exe"
)


def find_powershell():
    return str(WINDOWS_POWERSHELL) if WINDOWS_POWERSHELL.is_file() else None


@unittest.skipUnless(find_powershell(), "PowerShell is required for installer runtime tests")
class NoNodeInstallerRuntimeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.powershell = str(Path(find_powershell()).resolve())

    def run_installer(self, install_root, *arguments):
        empty_path = Path(install_root).parent / "empty-path"
        empty_path.mkdir(exist_ok=True)
        environment = os.environ.copy()
        environment["PATH"] = str(empty_path)
        command = [
            self.powershell,
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(INSTALLER),
            *arguments,
            "-SourceDirectory",
            str(ROOT),
            "-InstallRoot",
            str(install_root),
        ]
        return subprocess.run(command, capture_output=True, env=environment, check=False)

    def test_installs_all_manifest_skills_without_node_tools_on_path(self):
        with tempfile.TemporaryDirectory() as directory:
            install_root = Path(directory) / "installed"
            result = self.run_installer(install_root, "-All")

            self.assertEqual(0, result.returncode, result.stderr.decode(errors="replace"))
            self.assertEqual(MANIFEST_SLUGS, {path.name for path in install_root.iterdir() if path.is_dir()})
            for slug in MANIFEST_SLUGS:
                self.assertTrue((install_root / slug / "SKILL.md").is_file(), slug)

            output = (result.stdout + result.stderr).decode("utf-8", errors="replace")
            self.assertIn("仅供开发者", output)
            self.assertNotIn("安装完成，可以执行 Web/API 自动化测试", output)

    def test_installs_only_the_selected_skill(self):
        with tempfile.TemporaryDirectory() as directory:
            install_root = Path(directory) / "installed"
            result = self.run_installer(install_root, "-Skill", "requirement-test-workbench")

            self.assertEqual(0, result.returncode, result.stderr.decode(errors="replace"))
            self.assertEqual(["requirement-test-workbench"], [path.name for path in install_root.iterdir() if path.is_dir()])
            self.assertTrue((install_root / "requirement-test-workbench" / "SKILL.md").is_file())

    def test_source_directory_single_eighth_is_explicitly_developer_only(self):
        with tempfile.TemporaryDirectory() as directory:
            install_root = Path(directory) / "installed"
            result = self.run_installer(
                install_root,
                "-Skill",
                "web-api-test-execution-evidence",
            )

            output = (result.stdout + result.stderr).decode("utf-8", errors="replace")
            self.assertEqual(0, result.returncode, output)
            self.assertTrue((install_root / "web-api-test-execution-evidence" / "SKILL.md").is_file())
            self.assertIn("仅供开发者", output)
            self.assertIn("不能执行 Web/API 自动化测试", output)
            self.assertNotIn("安装完成，可以执行 Web/API 自动化测试", output)
            self.assertNotIn("请重启 Codex、Claude Code 或 CC Switch", output)
            self.assertNotIn("安装完成：新装/替换", output)

    def test_direct_eighth_route_verifies_ambient_and_sibling_complete_installer(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            marker = root / "complete-called.txt"
            complete = root / "verified-complete.ps1"
            complete.write_text(
                "param([string]$InstallRoot,[switch]$Force,[switch]$Repair)\n"
                f"Set-Content -LiteralPath '{str(marker).replace("'", "''")}' -Value $InstallRoot\n"
                "exit 0\n",
                encoding="utf-8-sig",
            )
            complete_hash = hashlib.sha256(complete.read_bytes()).hexdigest()
            rendered = INSTALLER.read_text(encoding="utf-8-sig").replace(
                "__COMPLETE_INSTALLER_SHA256__",
                complete_hash,
            )
            generic = root / "install.ps1"
            generic.write_text(rendered, encoding="utf-8-sig")
            empty_path = root / "empty-path"
            empty_path.mkdir()

            def run(script, *, ambient=None):
                environment = os.environ.copy()
                environment["PATH"] = str(empty_path)
                if ambient:
                    environment["TESTING_SKILLS_COMPLETE_INSTALLER_SCRIPT"] = str(ambient)
                else:
                    environment.pop("TESTING_SKILLS_COMPLETE_INSTALLER_SCRIPT", None)
                return subprocess.run(
                    [
                        self.powershell,
                        "-NoProfile",
                        "-ExecutionPolicy", "Bypass",
                        "-File", str(script),
                        "-Skill", "web-api-test-execution-evidence",
                        "-InstallRoot", str(root / "skills"),
                    ],
                    capture_output=True,
                    env=environment,
                    check=False,
                )

            ambient_result = run(generic, ambient=complete)
            self.assertEqual(0, ambient_result.returncode, (ambient_result.stdout + ambient_result.stderr).decode(errors="replace"))
            self.assertTrue(marker.is_file())

            marker.unlink()
            bad = root / "bad-complete.ps1"
            bad.write_text("exit 0\n", encoding="utf-8-sig")
            rejected = run(generic, ambient=bad)
            rejected_output = (rejected.stdout + rejected.stderr).decode("utf-8", errors="replace")
            self.assertNotEqual(0, rejected.returncode, rejected_output)
            self.assertIn("SHA-256", rejected_output)
            self.assertFalse(marker.exists())

            sibling_root = root / "sibling"
            sibling_root.mkdir()
            sibling_generic = sibling_root / "install.ps1"
            sibling_complete = sibling_root / "install-web-api-test-execution-evidence.ps1"
            sibling_generic.write_text(rendered, encoding="utf-8-sig")
            sibling_complete.write_bytes(complete.read_bytes())
            sibling_result = run(sibling_generic)
            self.assertEqual(0, sibling_result.returncode, (sibling_result.stdout + sibling_result.stderr).decode(errors="replace"))
            self.assertTrue(marker.is_file())

            marker.unlink()
            sibling_complete.write_text("exit 0\n", encoding="utf-8-sig")
            sibling_rejected = run(sibling_generic)
            sibling_output = (sibling_rejected.stdout + sibling_rejected.stderr).decode("utf-8", errors="replace")
            self.assertNotEqual(0, sibling_rejected.returncode, sibling_output)
            self.assertIn("SHA-256", sibling_output)
            self.assertFalse(marker.exists())

    def test_unknown_skill_fails_before_writing_any_package(self):
        with tempfile.TemporaryDirectory() as directory:
            install_root = Path(directory) / "installed"
            result = self.run_installer(install_root, "-Skill", "not-a-real-skill")

            self.assertNotEqual(0, result.returncode)
            self.assertFalse(install_root.exists())

    def test_existing_install_is_preserved_without_force(self):
        with tempfile.TemporaryDirectory() as directory:
            install_root = Path(directory) / "installed"
            first = self.run_installer(install_root, "-Skill", "requirement-test-workbench")
            self.assertEqual(0, first.returncode, first.stderr.decode(errors="replace"))
            marker = install_root / "requirement-test-workbench" / "local-user-file.txt"
            marker.write_text("keep me", encoding="utf-8")

            second = self.run_installer(install_root, "-Skill", "requirement-test-workbench")

            self.assertEqual(0, second.returncode, second.stderr.decode(errors="replace"))
            self.assertEqual("keep me", marker.read_text(encoding="utf-8"))

    def test_force_replaces_the_existing_install_cleanly(self):
        with tempfile.TemporaryDirectory() as directory:
            install_root = Path(directory) / "installed"
            first = self.run_installer(install_root, "-Skill", "requirement-test-workbench")
            self.assertEqual(0, first.returncode, first.stderr.decode(errors="replace"))
            package = install_root / "requirement-test-workbench"
            stale = package / "stale-file.txt"
            stale.write_text("remove me", encoding="utf-8")
            (package / "SKILL.md").write_text("stale", encoding="utf-8")

            second = self.run_installer(install_root, "-Skill", "requirement-test-workbench", "-Force")

            self.assertEqual(0, second.returncode, second.stderr.decode(errors="replace"))
            self.assertFalse(stale.exists())
            self.assertEqual(
                (ROOT / "skills" / "requirement-test-workbench" / "SKILL.md").read_bytes(),
                (package / "SKILL.md").read_bytes(),
            )

    def test_legacy_install_all_wrapper_ignores_a_stale_external_exit_code(self):
        with tempfile.TemporaryDirectory() as directory:
            install_root = Path(directory) / "installed"
            empty_path = Path(directory) / "empty-path"
            empty_path.mkdir()
            environment = os.environ.copy()
            environment["PATH"] = str(empty_path)
            wrapper = str(ROOT / "scripts" / "install-all.ps1").replace("'", "''")
            destination = str(install_root).replace("'", "''")
            command = [
                self.powershell,
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                f"$global:LASTEXITCODE = 7; & '{wrapper}' -InstallRoot '{destination}'",
            ]

            result = subprocess.run(command, capture_output=True, env=environment, check=False)

            self.assertEqual(0, result.returncode, result.stderr.decode(errors="replace"))
            self.assertEqual(MANIFEST_SLUGS, {path.name for path in install_root.iterdir() if path.is_dir()})


class NoNodeInstallerStaticTest(unittest.TestCase):
    def test_direct_eighth_route_precedes_mutable_repository_download(self):
        source = INSTALLER.read_text(encoding="utf-8-sig")
        route = source.index(
            'if (-not $SourceDirectory -and -not $All -and $Skill -ceq $completeSkill)'
        )
        repository_download = source.index('$archiveUrl = "https://codeload.github.com/')
        self.assertLess(route, repository_download)

    def test_remote_entries_trim_bom_while_file_keeps_ps51_utf8_marker(self):
        self.assertTrue(
            INSTALLER.read_bytes().startswith(b"\xef\xbb\xbf"),
            "Windows PowerShell 5.1 needs the UTF-8 BOM when executing the installer with -File",
        )
        trim_bom = ".TrimStart([char]0xFEFF)"
        readme = (ROOT / "README.md").read_text(encoding="utf-8")
        self.assertGreaterEqual(readme.count(trim_bom), 1)
        for launcher in (ROOT / "installers").glob("*.cmd"):
            with self.subTest(launcher=launcher.name):
                text = launcher.read_text(encoding="utf-8")
                if launcher.name in {
                    "install-all.cmd",
                    "install-web-api-test-execution-evidence.cmd",
                }:
                    invocation = "& $generic" if launcher.name == "install-all.cmd" else "& $installer"
                    self.assertIn(invocation, text)
                    self.assertIn("Get-FileHash", text)
                else:
                    self.assertIn(trim_bom, text)

    def test_recommended_installer_does_not_invoke_node_npm_npx_or_git(self):
        source = INSTALLER.read_text(encoding="utf-8")
        for command in ("node", "npm", "npx", "git"):
            self.assertIsNone(
                re.search(rf"(?im)^\s*(?:&\s*)?{command}(?:\.exe)?\b", source),
                command,
            )

    def test_readme_leads_with_zero_node_commands_for_all_and_one(self):
        readme = (ROOT / "README.md").read_text(encoding="utf-8")
        recommended = readme.split("### 高级方式：npx", 1)[0]
        self.assertIn("无需安装 Node.js、npm、npx 或 Git", recommended)
        self.assertIn("scripts/install.ps1", recommended)
        self.assertIn("web-api-test-execution-evidence-v1.0.2/install-all.cmd", recommended)
        self.assertIn(") -Skill 'requirement-test-workbench'", recommended)
        self.assertNotIn("npx skills add", recommended)
        advanced = readme.split("### 高级方式：npx", 1)[1]
        for check in ("node -v", "npm -v", "npx -v"):
            self.assertIn(check, advanced)


if __name__ == "__main__":
    unittest.main()

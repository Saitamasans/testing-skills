import os
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
INSTALLER = ROOT / "scripts" / "install.ps1"
MANIFEST_SLUGS = {
    "single-api-test-full",
    "single-api-test-concise",
    "multi-api-flow-test",
    "requirement-test-workbench",
    "production-verification-test",
    "test-case-quality-audit",
    "requirement-clarification-test",
    "web-api-test-execution-evidence",
}


def find_powershell():
    return shutil.which("powershell.exe") or shutil.which("pwsh")


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

    def test_installs_all_eight_skills_without_node_tools_on_path(self):
        with tempfile.TemporaryDirectory() as directory:
            install_root = Path(directory) / "installed"
            result = self.run_installer(install_root, "-All")

            self.assertEqual(0, result.returncode, result.stderr.decode(errors="replace"))
            self.assertEqual(MANIFEST_SLUGS, {path.name for path in install_root.iterdir() if path.is_dir()})
            for slug in MANIFEST_SLUGS:
                self.assertTrue((install_root / slug / "SKILL.md").is_file(), slug)

    def test_installs_only_the_selected_skill(self):
        with tempfile.TemporaryDirectory() as directory:
            install_root = Path(directory) / "installed"
            result = self.run_installer(install_root, "-Skill", "requirement-test-workbench")

            self.assertEqual(0, result.returncode, result.stderr.decode(errors="replace"))
            self.assertEqual(["requirement-test-workbench"], [path.name for path in install_root.iterdir() if path.is_dir()])
            self.assertTrue((install_root / "requirement-test-workbench" / "SKILL.md").is_file())

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
        self.assertIn(") -All", recommended)
        self.assertIn(") -Skill 'requirement-test-workbench'", recommended)
        self.assertNotIn("npx skills add", recommended)
        advanced = readme.split("### 高级方式：npx", 1)[1]
        for check in ("node -v", "npm -v", "npx -v"):
            self.assertIn(check, advanced)


if __name__ == "__main__":
    unittest.main()

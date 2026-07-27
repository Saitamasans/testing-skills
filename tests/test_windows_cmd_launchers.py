import os
import re
import hashlib
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
INSTALLERS = ROOT / "installers"
SYSTEM_ROOT = Path(os.environ.get("SystemRoot", r"C:\Windows"))
CMD_EXE = SYSTEM_ROOT / "System32" / "cmd.exe"
WINDOWS_POWERSHELL = (
    SYSTEM_ROOT / "System32" / "WindowsPowerShell" / "v1.0" / "powershell.exe"
)


@unittest.skipUnless(
    CMD_EXE.is_file() and WINDOWS_POWERSHELL.is_file(),
    "Windows cmd.exe and Windows PowerShell are required",
)
class WindowsCmdLauncherRuntimeTest(unittest.TestCase):
    def test_every_launcher_starts_when_path_does_not_contain_powershell(self):
        launchers = [
            path for path in sorted(INSTALLERS.glob("*.cmd"))
            if path.name not in {
                "install-all.cmd",
                "install-web-api-test-execution-evidence.cmd",
            }
        ]
        self.assertEqual(8, len(launchers))

        with tempfile.TemporaryDirectory() as directory:
            temp_root = Path(directory)
            empty_path = temp_root / "empty-path"
            empty_path.mkdir()
            marker = temp_root / "launcher-called.txt"
            stub = temp_root / "installer-stub.ps1"
            stub.write_text(
                "param([switch]$All, [string]$Skill)\n"
                f"Set-Content -LiteralPath '{str(marker).replace("'", "''")}' "
                "-Value $(if ($All) { 'all' } else { $Skill })\n",
                encoding="utf-8-sig",
            )

            for launcher in launchers:
                with self.subTest(launcher=launcher.name):
                    marker.unlink(missing_ok=True)
                    environment = os.environ.copy()
                    environment["PATH"] = str(empty_path)
                    environment["TESTING_SKILLS_NO_PAUSE"] = "1"
                    environment["TESTING_SKILLS_INSTALLER_SCRIPT"] = str(stub)

                    result = subprocess.run(
                        [str(CMD_EXE), "/d", "/c", "call", str(launcher)],
                        capture_output=True,
                        env=environment,
                        check=False,
                    )

                    output = (result.stdout + result.stderr).decode(
                        errors="replace"
                    )
                    self.assertEqual(0, result.returncode, output)
                    self.assertTrue(marker.is_file(), output)
                    expected = (
                        "all"
                        if launcher.name == "install-all.cmd"
                        else launcher.stem.removeprefix("install-")
                    )
                    self.assertEqual(expected, marker.read_text().strip())

    def test_complete_launchers_verify_local_transport_fixture_with_empty_path(self):
        for name, expected in (
            ("install-web-api-test-execution-evidence.cmd", "eighth"),
            ("install-all.cmd", "all"),
        ):
            with self.subTest(name=name), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                marker = root / "called.txt"
                generic = root / "generic.ps1"
                complete = root / "complete.ps1"
                generic.write_text(
                    "param([switch]$All)\n"
                    f"Set-Content -LiteralPath '{str(marker).replace("'", "''")}' -Value 'all'\n",
                    encoding="utf-8-sig",
                )
                complete.write_text(
                    f"Set-Content -LiteralPath '{str(marker).replace("'", "''")}' -Value 'eighth'\n",
                    encoding="utf-8-sig",
                )
                source = (INSTALLERS / name).read_text(encoding="utf-8")
                if name == "install-all.cmd":
                    source = re.sub(
                        r"(?i)(GENERIC_INSTALLER_SHA256=)[a-f0-9]{64}",
                        rf"\g<1>{hashlib.sha256(generic.read_bytes()).hexdigest()}",
                        source,
                    )
                    source = re.sub(
                        r"(?i)(COMPLETE_INSTALLER_SHA256=)[a-f0-9]{64}",
                        rf"\g<1>{hashlib.sha256(complete.read_bytes()).hexdigest()}",
                        source,
                    )
                else:
                    source = re.sub(
                        r"(?i)(INSTALLER_SHA256=)[a-f0-9]{64}",
                        rf"\g<1>{hashlib.sha256(complete.read_bytes()).hexdigest()}",
                        source,
                    )
                launcher = root / name
                launcher.write_text(source, encoding="utf-8")
                empty_path = root / "empty"
                empty_path.mkdir()
                env = os.environ.copy()
                env["PATH"] = str(empty_path)
                env["TESTING_SKILLS_NO_PAUSE"] = "1"
                env["TESTING_SKILLS_INSTALLER_SOURCE"] = str(complete)
                env["TESTING_SKILLS_GENERIC_INSTALLER_SOURCE"] = str(generic)
                env["TESTING_SKILLS_COMPLETE_INSTALLER_SOURCE"] = str(complete)
                result = subprocess.run(
                    [str(CMD_EXE), "/d", "/c", "call", str(launcher)],
                    capture_output=True,
                    env=env,
                    check=False,
                )
                self.assertEqual(0, result.returncode, (result.stdout + result.stderr).decode(errors="replace"))
                self.assertEqual(expected, marker.read_text().strip())

    def test_complete_launchers_reject_wrong_local_source_hash(self):
        for name in (
            "install-web-api-test-execution-evidence.cmd",
            "install-all.cmd",
        ):
            with self.subTest(name=name), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                good = root / "good.ps1"
                bad = root / "bad.ps1"
                generic = root / "generic.ps1"
                marker = root / "called.txt"
                good.write_text("exit 0\n", encoding="utf-8-sig")
                bad.write_text(
                    f"Set-Content -LiteralPath '{str(marker).replace("'", "''")}' -Value 'bad'\n",
                    encoding="utf-8-sig",
                )
                generic.write_text("param([switch]$All)\nexit 0\n", encoding="utf-8-sig")
                source = (INSTALLERS / name).read_text(encoding="utf-8")
                if name == "install-all.cmd":
                    source = re.sub(
                        r"(?i)(GENERIC_INSTALLER_SHA256=)[a-f0-9]{64}",
                        rf"\g<1>{hashlib.sha256(good.read_bytes()).hexdigest()}",
                        source,
                    )
                    source = re.sub(
                        r"(?i)(COMPLETE_INSTALLER_SHA256=)[a-f0-9]{64}",
                        rf"\g<1>{hashlib.sha256(good.read_bytes()).hexdigest()}",
                        source,
                    )
                else:
                    source = re.sub(
                        r"(?i)(INSTALLER_SHA256=)[a-f0-9]{64}",
                        rf"\g<1>{hashlib.sha256(good.read_bytes()).hexdigest()}",
                        source,
                    )
                launcher = root / name
                launcher.write_text(source, encoding="utf-8")
                empty_path = root / "empty"
                empty_path.mkdir()
                env = os.environ.copy()
                env["PATH"] = str(empty_path)
                env["TESTING_SKILLS_NO_PAUSE"] = "1"
                env["TESTING_SKILLS_INSTALLER_SOURCE"] = str(bad)
                env["TESTING_SKILLS_GENERIC_INSTALLER_SOURCE"] = str(bad)
                env["TESTING_SKILLS_COMPLETE_INSTALLER_SOURCE"] = str(good)
                result = subprocess.run(
                    [str(CMD_EXE), "/d", "/c", "call", str(launcher)],
                    capture_output=True,
                    env=env,
                    check=False,
                )
                self.assertNotEqual(0, result.returncode)
                self.assertFalse(marker.exists())


class WindowsCmdLauncherStaticTest(unittest.TestCase):
    def test_eighth_launcher_anchors_versioned_installer_url_and_sha256(self):
        launcher = (INSTALLERS / "install-web-api-test-execution-evidence.cmd").read_text(encoding="utf-8")
        self.assertIn(
            "/releases/download/web-api-test-execution-evidence-v1.0.2/"
            "install-web-api-test-execution-evidence.ps1",
            launcher,
        )
        self.assertRegex(launcher, r"(?i)INSTALLER_SHA256=[a-f0-9]{64}")
        self.assertIn("Get-FileHash", launcher)
        self.assertNotIn("TESTING_SKILLS_INSTALLER_SCRIPT", launcher)
        self.assertNotIn("/main/scripts/install.ps1", launcher)
        self.assertIn(
            "installer_sha256=ce198941046242ebe0b945fec010bcc902d54a2e7597e43798105d1556bfd3ef",
            launcher.lower(),
        )

    def test_complete_launchers_configure_tls_and_proxy_before_network(self):
        for name in (
            "install-web-api-test-execution-evidence.cmd",
            "install-all.cmd",
        ):
            with self.subTest(name=name):
                launcher = (INSTALLERS / name).read_text(encoding="utf-8")
                first_request = launcher.index("Invoke-WebRequest")
                self.assertLess(launcher.index("Tls12"), first_request)
                self.assertLess(launcher.index("DefaultWebProxy"), first_request)
                self.assertLess(launcher.index("DefaultNetworkCredentials"), first_request)
                self.assertNotIn("ServerCertificateValidationCallback", launcher)

    def test_all_launcher_routes_through_generic_all_selector(self):
        launcher = (INSTALLERS / "install-all.cmd").read_text(encoding="utf-8")
        self.assertIn('set "INSTALL_SELECTOR=-All"', launcher)
        self.assertNotIn("TESTING_SKILLS_INSTALLER_SCRIPT", launcher)
        self.assertIn("web-api-test-execution-evidence-v1.0.2/scripts/install.ps1", launcher)
        self.assertIn("install-web-api-test-execution-evidence.ps1", launcher)
        self.assertGreaterEqual(len(re.findall(r"(?i)SHA256=[a-f0-9]{64}", launcher)), 2)
        self.assertGreaterEqual(launcher.count("Get-FileHash"), 2)
        self.assertNotIn("/main/scripts/install.ps1", launcher)
        self.assertIn(
            "GENERIC_INSTALLER_SHA256=81cb24681274be68223102899cc497a913a0133aa0b0c382be5a66c2150feaa6",
            launcher,
        )
        self.assertIn(
            "COMPLETE_INSTALLER_SHA256=ce198941046242ebe0b945fec010bcc902d54a2e7597e43798105d1556bfd3ef",
            launcher,
        )


if __name__ == "__main__":
    unittest.main()

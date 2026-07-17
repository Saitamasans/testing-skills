import os
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
        launchers = sorted(INSTALLERS.glob("*.cmd"))
        self.assertEqual(9, len(launchers))

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


if __name__ == "__main__":
    unittest.main()

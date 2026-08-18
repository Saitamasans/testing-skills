from pathlib import Path
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import time


ROOT = Path(__file__).resolve().parents[2]
SKILL = ROOT / "skills/reverse-test-workbench"
BUILDER = SKILL / "scripts/build_artifacts.py"
PREFLIGHT = SKILL / "scripts/preflight_artifacts.py"
RECORDER = SKILL / "scripts/record_artifact_validation.py"
FIXTURE = ROOT / "evals/reverse-test-workbench/fixtures/minimal-run-data.json"


for path in (BUILDER, PREFLIGHT, RECORDER, FIXTURE):
    if not path.exists():
        raise AssertionError(f"required lifecycle resource missing: {path}")

preflight_result = subprocess.run(
    [sys.executable, str(PREFLIGHT)],
    capture_output=True,
    text=True,
    check=True,
)
preflight = json.loads(preflight_result.stdout)
for key in (
    "docx_generation",
    "xlsx_generation",
    "libreoffice",
    "table_validation",
    "image_validation",
    "visual_render_unavailable",
    "fallback",
):
    if key not in preflight:
        raise AssertionError(f"preflight missing {key}")

with tempfile.TemporaryDirectory() as temp_dir:
    output_dir = Path(temp_dir)
    result = subprocess.run(
        [
            sys.executable,
            str(BUILDER),
            "--input",
            str(FIXTURE),
            "--output-dir",
            str(output_dir),
            "--skip-docx",
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    response = json.loads(result.stdout)
    manifest_path = output_dir / "evidence/_artifact-build.json"
    if response.get("status") != "partial" or not manifest_path.exists():
        raise AssertionError("partial generation did not produce an audit manifest")
    if (output_dir / "过程小结.docx").exists():
        raise AssertionError("skip-docx mode generated DOCX")
    if not (output_dir / "测试资产表.xlsx").exists():
        raise AssertionError("skip-docx mode failed to generate XLSX")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest["artifacts"]["docx"]["status"] != "skipped":
        raise AssertionError("manifest did not record skipped DOCX")
    subprocess.run(
        [
            sys.executable,
            str(RECORDER),
            "--run-root",
            str(output_dir),
            "--status",
            "skipped",
            "--reason",
            "LibreOffice unavailable; structure validation retained",
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest["visual_validation"]["status"] != "skipped":
        raise AssertionError("visual validation recorder did not update manifest")

with tempfile.TemporaryDirectory() as temp_dir:
    output_dir = Path(temp_dir)
    subprocess.run(
        [sys.executable, str(BUILDER), "--input", str(FIXTURE), "--output-dir", str(output_dir)],
        capture_output=True,
        text=True,
        check=True,
    )
    evidence = output_dir / "evidence/visual/page-1.png"
    evidence.parent.mkdir(parents=True, exist_ok=True)
    evidence.write_bytes(b"visual evidence")
    passed = subprocess.run(
        [
            sys.executable,
            str(RECORDER),
            "--run-root",
            str(output_dir),
            "--status",
            "passed",
            "--pages",
            "1",
            "--evidence",
            "evidence/visual/page-1.png",
        ],
        capture_output=True,
        text=True,
    )
    if passed.returncode != 0:
        raise AssertionError(f"visual validation with evidence was rejected: {passed.stderr}")
    manifest = json.loads((output_dir / "evidence/_artifact-build.json").read_text(encoding="utf-8"))
    visual = manifest["visual_validation"]
    if visual["status"] != "passed" or visual["pages"] != 1 or visual["artifact"]["sha256"] != manifest["artifacts"]["docx"]["integrity"]["sha256"]:
        raise AssertionError("visual validation did not bind a passed result to the DOCX and evidence")

    (output_dir / "过程小结.docx").write_bytes(b"tampered-docx")
    tampered = subprocess.run(
        [
            sys.executable,
            str(RECORDER),
            "--run-root",
            str(output_dir),
            "--status",
            "passed",
            "--pages",
            "1",
            "--evidence",
            "evidence/visual/page-1.png",
        ],
        capture_output=True,
        text=True,
    )
    if tampered.returncode == 0 or "changed" not in (tampered.stdout + tampered.stderr):
        raise AssertionError("visual validation accepted a DOCX that changed after publication")

with tempfile.TemporaryDirectory() as temp_dir:
    output_dir = Path(temp_dir)
    subprocess.run(
        [sys.executable, str(BUILDER), "--input", str(FIXTURE), "--output-dir", str(output_dir)],
        capture_output=True,
        text=True,
        check=True,
    )
    missing_evidence = subprocess.run(
        [
            sys.executable,
            str(RECORDER),
            "--run-root",
            str(output_dir),
            "--status",
            "passed",
            "--pages",
            "0",
        ],
        capture_output=True,
        text=True,
    )
    if missing_evidence.returncode == 0:
        raise AssertionError("visual validation accepted passed with zero pages and no evidence")

with tempfile.TemporaryDirectory() as temp_dir:
    output_dir = Path(temp_dir)
    old_docx = output_dir / "过程小结.docx"
    old_docx.write_bytes(b"previous-docx")
    subprocess.run(
        [
            sys.executable,
            str(BUILDER),
            "--input",
            str(FIXTURE),
            "--output-dir",
            str(output_dir),
            "--skip-docx",
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    manifest = json.loads(
        (output_dir / "evidence/_artifact-build.json").read_text(encoding="utf-8")
    )
    if old_docx.read_bytes() != b"previous-docx":
        raise AssertionError("partial generation deleted the previous DOCX")
    if manifest["artifacts"]["docx"]["preserved_previous"] is not True:
        raise AssertionError("previous DOCX was not marked as preserved_previous")

spec = importlib.util.spec_from_file_location("rtw_builder", BUILDER)
if spec is None or spec.loader is None:
    raise AssertionError("cannot import artifact builder")
builder = importlib.util.module_from_spec(spec)
sys.path.insert(0, str(BUILDER.parent))
spec.loader.exec_module(builder)

with tempfile.TemporaryDirectory() as temp_dir:
    root = Path(temp_dir)
    bad_docx = root / "bad.docx"
    builder.Document().save(bad_docx)
    try:
        builder._validate_docx_structure(bad_docx)
    except ValueError:
        pass
    else:
        raise AssertionError("DOCX structure validator accepted a document without sections")

    bad_xlsx = root / "bad.xlsx"
    builder.Workbook().save(bad_xlsx)
    try:
        builder._validate_xlsx_structure(bad_xlsx)
    except ValueError:
        pass
    else:
        raise AssertionError("XLSX structure validator accepted the wrong sheet layout")

with tempfile.TemporaryDirectory() as temp_dir:
    root = Path(temp_dir)
    old_docx = root / "过程小结.docx"
    old_xlsx = root / "测试资产表.xlsx"
    old_docx.write_bytes(b"old-docx")
    old_xlsx.write_bytes(b"old-xlsx")
    data = builder.load_and_validate(FIXTURE)
    original_validator = builder._validate_docx_structure

    def fail_docx_validation(path):
        raise ValueError("simulated DOCX structure failure")

    builder._validate_docx_structure = fail_docx_validation
    try:
        try:
            builder.build(data, root)
        except ValueError:
            pass
        else:
            raise AssertionError("integrated build ignored DOCX structure failure")
    finally:
        builder._validate_docx_structure = original_validator
    if old_docx.read_bytes() != b"old-docx" or old_xlsx.read_bytes() != b"old-xlsx":
        raise AssertionError("structure validation failure replaced existing artifacts")

with tempfile.TemporaryDirectory() as temp_dir:
    root = Path(temp_dir)
    stale_owned = root / ".rtw-artifacts-stale"
    stale_owned.mkdir()
    (stale_owned / builder.STAGING_MARKER).write_text(
        '{"owner":"reverse-test-workbench"}', encoding="utf-8"
    )
    old_time = time.time() - 172800
    os.utime(stale_owned, (old_time, old_time))
    os.utime(stale_owned / builder.STAGING_MARKER, (old_time, old_time))
    unmarked = root / ".rtw-artifacts-unmarked"
    unmarked.mkdir()
    fresh_owned = root / ".rtw-artifacts-fresh"
    fresh_owned.mkdir()
    (fresh_owned / builder.STAGING_MARKER).write_text(
        '{"owner":"reverse-test-workbench"}', encoding="utf-8"
    )
    removed = builder._cleanup_stale_staging(root, max_age_seconds=86400)
    if stale_owned.exists() or stale_owned.name not in removed:
        raise AssertionError("stale owned staging directory was not removed")
    if not unmarked.exists() or not fresh_owned.exists():
        raise AssertionError("cleanup removed an unowned or fresh directory")

with tempfile.TemporaryDirectory() as temp_dir:
    root = Path(temp_dir)
    old_a = root / "a.txt"
    old_b = root / "b.txt"
    old_a.write_text("old-a", encoding="utf-8")
    old_b.write_text("old-b", encoding="utf-8")
    stage = root / "stage"
    stage.mkdir()
    new_a = stage / "a.txt"
    new_b = stage / "b.txt"
    new_a.write_text("new-a", encoding="utf-8")
    new_b.write_text("new-b", encoding="utf-8")
    original_replace = builder.os.replace
    calls = 0

    def failing_replace(source, target):
        global calls
        calls += 1
        if calls == 2:
            raise OSError("simulated publish failure")
        return original_replace(source, target)

    builder.os.replace = failing_replace
    try:
        try:
            builder._publish_transaction({new_a: old_a, new_b: old_b}, stage / "backup")
        except OSError:
            pass
        else:
            raise AssertionError("publish transaction did not surface simulated failure")
    finally:
        builder.os.replace = original_replace
    if old_a.read_text(encoding="utf-8") != "old-a" or old_b.read_text(encoding="utf-8") != "old-b":
        raise AssertionError("publish rollback did not restore previous artifacts")

print("artifact lifecycle validation passed")

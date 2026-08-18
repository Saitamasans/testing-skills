from __future__ import annotations

import argparse
import shutil
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "skills" / "reverse-test-workbench"
TARGET = ROOT / "plugins" / "reverse-test-workbench" / "skills" / "reverse-test-workbench"


def _files(root: Path) -> dict[Path, bytes]:
    if not root.exists():
        return {}
    return {
        path.relative_to(root): path.read_bytes()
        for path in sorted(root.rglob("*"))
        if path.is_file()
    }


def sync(check: bool = False) -> None:
    source_files = _files(SOURCE)
    if not source_files:
        raise RuntimeError("公共 Skill 包不存在；请先运行 tooling/build_skills.py")

    target_files = _files(TARGET)
    if check:
        missing = sorted(set(source_files) - set(target_files))
        extra = sorted(set(target_files) - set(source_files))
        changed = sorted(
            relative
            for relative in set(source_files) & set(target_files)
            if source_files[relative] != target_files[relative]
        )
        if missing or extra or changed:
            details = [
                *(f"missing:{path.as_posix()}" for path in missing),
                *(f"extra:{path.as_posix()}" for path in extra),
                *(f"changed:{path.as_posix()}" for path in changed),
            ]
            raise RuntimeError("Codex 适配器镜像漂移: " + ", ".join(details))
        return

    TARGET.parent.mkdir(parents=True, exist_ok=True)
    temporary = Path(tempfile.mkdtemp(prefix="rtw-plugin-mirror-", dir=TARGET.parent))
    staged = temporary / TARGET.name
    try:
        shutil.copytree(SOURCE, staged)
        if TARGET.exists():
            shutil.rmtree(TARGET)
        staged.replace(TARGET)
    finally:
        shutil.rmtree(temporary, ignore_errors=True)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="将通用 reverse-test-workbench Skill 确定性同步到可选 Codex 适配器"
    )
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    try:
        sync(check=args.check)
        print("reverse-test-workbench 适配器镜像校验通过" if args.check else "reverse-test-workbench 适配器镜像已同步")
        return 0
    except Exception as exc:
        print(exc, file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

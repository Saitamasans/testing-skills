"""Build the deterministic, offline Windows x64 runtime for multi-source-test-audit."""
from __future__ import annotations

import argparse, hashlib, json, shutil, stat, tarfile, tempfile, urllib.request, zipfile
from pathlib import Path, PureWindowsPath

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "skill-sources" / "multi-source-test-audit"
PACKAGE = SOURCE / "packaging"
STAMP = (2024, 1, 1, 0, 0, 0)

def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()

def load(name: str) -> dict:
    return json.loads((PACKAGE / name).read_text(encoding="utf-8"))


def build_runtime_metadata(
    *,
    slug: str,
    runtime_version: str,
    python_version: str,
    dependencies: dict[str, str],
    key_files: dict[str, str],
) -> dict:
    """Return the immutable runtime contract embedded in a bundle."""
    return {
        "schema_version": 1,
        "slug": slug,
        "runtime_version": runtime_version,
        "python_version": python_version,
        "platform": "windows-x64",
        "dependencies": dict(sorted(dependencies.items())),
        "python_executable": "runtime/python/python.exe",
        "application_entry": "runtime/app/multi_source_test_audit/__main__.py",
        "schemas": [
            "schemas/stage-a-analysis.schema.json",
            "schemas/selected-chain-plan.schema.json",
        ],
        "key_files": dict(sorted(key_files.items())),
        "isolation": {
            "pth_file": "runtime/python/python312._pth",
            "python312._pth": "runtime/python/python312._pth",
            "pth_contents": ["python312.zip", ".", "Lib/site-packages", "..\\app"],
            "site_imports_disabled": True,
            "system_site_packages_disabled": True,
            "external_pythonpath_ignored": True,
        },
    }


def build_bundle_metadata(*, slug: str, runtime_version: str, files: list[dict]) -> dict:
    """Return the complete controlled-file inventory contract."""
    return {
        "schema_version": 1,
        "slug": slug,
        "runtime_version": runtime_version,
        "files": sorted(files, key=lambda item: item["path"]),
    }

def download(item: dict, cache: Path, offline: bool) -> Path:
    target = cache / item["filename"]
    if not target.exists():
        if offline: raise RuntimeError(f"offline cache miss: {item['filename']}")
        url = item.get("download_url") or item["immutable_url"]
        request = urllib.request.Request(url, headers={"User-Agent":"multi-source-test-audit-builder/0.1.1"})
        with urllib.request.urlopen(request) as response:
            final = response.geturl()
            if not (final.startswith("https://www.python.org/") or final.startswith("https://files.pythonhosted.org/")):
                raise RuntimeError(f"unapproved download redirect: {final}")
            target.write_bytes(response.read())
    expected = item.get("sha256") or item["archive_sha256"]
    if digest(target) != expected: raise RuntimeError(f"sha256 mismatch: {item['filename']}")
    return target

def normalized_license(data: bytes) -> bytes:
    text = data.decode("utf-8-sig").replace("\r\n", "\n").replace("\r", "\n").rstrip("\n") + "\n"
    if len(text.strip()) < 100 or "placeholder" in text.casefold():
        raise RuntimeError("license is empty or placeholder text")
    return text.encode("utf-8")

def extract_license(source: dict, archive: Path, destination: Path) -> None:
    member = source["archive_member"]
    if source["source_type"] == "embeddable_zip":
        with zipfile.ZipFile(archive) as bundle:
            entries = [item for item in bundle.infolist() if item.filename == member]
            if len(entries) != 1: raise RuntimeError(f"license member missing or duplicate: {member}")
            data = bundle.read(entries[0])
    else:
        with tarfile.open(archive, "r:gz") as bundle:
            entries = [item for item in bundle.getmembers() if item.name == member]
            if len(entries) != 1 or not entries[0].isfile() or entries[0].issym():
                raise RuntimeError(f"license member missing or unsafe: {member}")
            stream = bundle.extractfile(entries[0])
            if stream is None: raise RuntimeError(f"license member unreadable: {member}")
            data = stream.read()
    content = normalized_license(data)
    if hashlib.sha256(content).hexdigest() != source["extracted_content_sha256"]:
        raise RuntimeError(f"license content sha256 mismatch: {source['package']}")
    (destination / source["output_filename"]).write_bytes(content)

def extract(archive: Path, destination: Path) -> None:
    with zipfile.ZipFile(archive) as bundle:
        seen=set()
        for entry in bundle.infolist():
            name=PureWindowsPath(entry.filename)
            canonical="/".join(name.parts).casefold()
            if entry.is_dir(): continue
            is_unix_symlink = entry.create_system == 3 and stat.S_ISLNK(entry.external_attr >> 16)
            if name.is_absolute() or name.root or name.drive or ".." in name.parts or canonical in seen or is_unix_symlink:
                raise RuntimeError(f"unsafe archive member: {entry.filename}")
            seen.add(canonical)
            target=destination.joinpath(*name.parts); target.parent.mkdir(parents=True,exist_ok=True)
            with bundle.open(entry) as source, target.open("wb") as output: shutil.copyfileobj(source,output)

def manifest(root: Path, name: str, metadata: dict | None = None) -> dict:
    files=[]
    for path in sorted(item for item in root.rglob("*") if item.is_file()):
        if path.relative_to(root).as_posix() == name:
            continue
        files.append({"path":path.relative_to(root).as_posix(),"sha256":digest(path),"size":path.stat().st_size})
    data={"schema_version":1,**(metadata or {}),"files":files}
    (root/name).write_text(json.dumps(data,ensure_ascii=False,sort_keys=True,separators=(",",":"))+"\n",encoding="utf-8",newline="\n")
    return data

def archive(root: Path, output: Path) -> None:
    with zipfile.ZipFile(output,"w",zipfile.ZIP_DEFLATED,compresslevel=9) as result:
        for path in sorted(item for item in root.rglob("*") if item.is_file()):
            info=zipfile.ZipInfo(path.relative_to(root.parent).as_posix(),STAMP); info.external_attr=0o100644<<16
            result.writestr(info,path.read_bytes(),compress_type=zipfile.ZIP_DEFLATED,compresslevel=9)


def render_release_assets(archive_path: Path, output_dir: Path) -> list[Path]:
    """Render the immutable public assets from a completed runtime archive."""
    contract = load("release-contract.json")
    output_dir.mkdir(parents=True, exist_ok=True)
    archive_path = Path(archive_path)
    archive_name = contract["archive_name"]
    if archive_path.name != archive_name:
        raise RuntimeError(f"unexpected archive name: {archive_path.name}")
    archive_sha = digest(archive_path)
    archive_size = archive_path.stat().st_size
    with zipfile.ZipFile(archive_path) as bundle:
        member = "multi-source-test-audit/bundle-manifest.json"
        if member not in bundle.namelist():
            raise RuntimeError("bundle manifest is missing from runtime archive")
        bundle_manifest_sha = hashlib.sha256(bundle.read(member)).hexdigest()

    installer_source = SOURCE / "scripts" / "install-multi-source-test-audit.ps1"
    installer = installer_source.read_text(encoding="utf-8")
    installer = installer.replace("__ARCHIVE_SHA256__", archive_sha)
    if "__ARCHIVE_SHA256__" in installer:
        raise RuntimeError("unresolved release installer placeholder")
    rendered = output_dir / "install-multi-source-test-audit.ps1"
    rendered.write_text(installer, encoding="utf-8", newline="\n")
    launcher = output_dir / "install-multi-source-test-audit.cmd"
    launcher.write_bytes((SOURCE / "scripts" / "install-multi-source-test-audit.cmd").read_bytes())
    rendered_archive = output_dir / archive_name
    rendered_archive.write_bytes(archive_path.read_bytes())
    release_tag = contract.get("release_tag") or f"{contract['slug']}-v{contract['version']}"
    manifest = {
        "schema_version": 1,
        "slug": contract["slug"],
        "version": contract["version"],
        "release_tag": release_tag,
        "platform": contract["platform"],
        "archive": {
            "file_name": archive_name,
            "size_bytes": archive_size,
            "sha256": archive_sha,
            "download_url": f"https://github.com/Saitamasans/testing-skills/releases/download/{release_tag}/{archive_name}",
        },
        "bundle_manifest": {"path": "multi-source-test-audit/bundle-manifest.json", "sha256": bundle_manifest_sha},
        "assets": ["install-multi-source-test-audit.cmd", "install-multi-source-test-audit.ps1", archive_name, "release-manifest.json", "SHA256SUMS.txt"],
    }
    manifest_path = output_dir / "release-manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, sort_keys=True, indent=2) + "\n", encoding="utf-8", newline="\n")
    assets = [launcher, rendered, rendered_archive, manifest_path]
    sums = output_dir / "SHA256SUMS.txt"
    lines = [f"{digest(path)}  {path.name}" for path in sorted(assets, key=lambda path: path.name)]
    sums.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")
    assets.append(sums)
    return assets

def build(output_dir: Path, cache: Path, offline: bool, verify_only: bool) -> Path:
    py, wheels, contract, license_lock = load("python-runtime-lock.json"), load("wheel-lock.json"), load("release-contract.json"), load("license-source-lock.json")
    cache.mkdir(parents=True,exist_ok=True); python_zip=download({**py,"filename":"python-3.12.10-embed-amd64.zip","download_url":py["url"]},cache,offline)
    wheel_paths=[download(item,cache,offline) for item in wheels["wheels"]]
    license_archives={item["package"]: download(item,cache,offline) for item in license_lock["sources"]}
    if verify_only: return python_zip
    with tempfile.TemporaryDirectory(prefix="msa-runtime-") as temporary:
        root=Path(temporary)/"multi-source-test-audit"; runtime=root/"runtime"/"python"; runtime.mkdir(parents=True)
        extract(python_zip,runtime); (runtime/"python312._pth").write_text("python312.zip\n.\nLib/site-packages\n..\\app\n",encoding="utf-8",newline="\n")
        for wheel in wheel_paths: extract(wheel,runtime/"Lib"/"site-packages")
        licenses=root/"LICENSES"; licenses.mkdir()
        for source in license_lock["sources"]:
            extract_license(source,license_archives[source["package"]],licenses)
        license_names={"cffi":"cffi.txt","cryptography":"cryptography-Apache-2.0.txt","pycparser":"pycparser.txt"}
        for package, target_name in license_names.items():
            candidates=sorted((runtime/"Lib"/"site-packages").glob(f"{package}-*.dist-info/licenses/LICENSE*"))
            if not candidates: raise RuntimeError(f"missing bundled license: {package}")
            shutil.copy2(candidates[0],licenses/target_name)
        crypto=runtime/"Lib"/"site-packages"/"cryptography-49.0.0.dist-info"/"licenses"
        shutil.copy2(crypto/"LICENSE.BSD",licenses/"cryptography-BSD-3-Clause.txt")
        shutil.copytree(SOURCE/"runtime"/"multi_source_test_audit",root/"runtime"/"app"/"multi_source_test_audit")
        shutil.copytree(SOURCE/"schemas",root/"schemas")
        shutil.copytree(SOURCE/"scripts",root/"scripts")
        shutil.copy2(SOURCE/"多源测试审计_Skill.md",root/"SKILL.md")
        shutil.copytree(ROOT/"skills"/contract["slug"]/"agents",root/"agents")
        (root/"VERSION").write_text(contract["version"]+"\n",encoding="utf-8")
        dependencies={item["package"]:item["version"] for item in wheels["wheels"]}
        key_files={
            "runtime/python/python.exe": digest(runtime / "python.exe"),
            "runtime/python/python312._pth": digest(runtime / "python312._pth"),
            "runtime/app/multi_source_test_audit/__main__.py": digest(root / "runtime" / "app" / "multi_source_test_audit" / "__main__.py"),
            "schemas/stage-a-analysis.schema.json": digest(root / "schemas" / "stage-a-analysis.schema.json"),
            "schemas/selected-chain-plan.schema.json": digest(root / "schemas" / "selected-chain-plan.schema.json"),
        }
        for package in dependencies:
            dist_info = next((runtime / "Lib" / "site-packages").glob(f"{package}-*.dist-info/METADATA"), None)
            if dist_info is None:
                raise RuntimeError(f"missing dependency metadata: {package}")
            key_files[f"runtime/python/Lib/site-packages/{dist_info.parent.name}/METADATA"] = digest(dist_info)
        runtime_meta=build_runtime_metadata(
            slug=contract["slug"], runtime_version=contract["version"],
            python_version=py["python_version"], dependencies=dependencies, key_files=key_files,
        )
        manifest(root/"runtime","runtime-manifest.json",runtime_meta)
        bundle_meta=build_bundle_metadata(slug=contract["slug"], runtime_version=contract["version"], files=[])
        bundle_manifest=manifest(root,"bundle-manifest.json",bundle_meta)
        bundle_manifest["files"] = bundle_manifest["files"]
        output_dir.mkdir(parents=True,exist_ok=True); target=output_dir/contract["archive_name"]; archive(root,target); return target

if __name__ == "__main__":
    parser=argparse.ArgumentParser(); parser.add_argument("--output-dir",type=Path,required=True); parser.add_argument("--download-cache",type=Path,required=True); parser.add_argument("--offline",action="store_true"); parser.add_argument("--verify-only",action="store_true"); parser.add_argument("--release-assets-dir",type=Path)
    args=parser.parse_args(); result=build(args.output_dir,args.download_cache,args.offline,args.verify_only)
    payload={"path":str(result),"sha256":digest(result),"size":result.stat().st_size}
    if args.release_assets_dir:
        payload["release_assets"]=[str(path) for path in render_release_assets(result,args.release_assets_dir)]
    print(json.dumps(payload))

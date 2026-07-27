from __future__ import annotations

import base64
import hashlib
import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.error import HTTPError
from urllib.parse import parse_qsl, quote, urlencode, urlsplit, urlunsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

from .atomic_io import atomic_write_json
from .environment_guard import ExecutionTargetPolicy, assert_url_allowed
from .errors import ErrorCode, RuntimePolicyError
from .paths import WritePolicy
from .redaction import REDACTED, redact_cell

_EVIDENCE_ID = re.compile(r"^[A-Za-z0-9_.-]+$")


@dataclass(frozen=True)
class HttpFile:
    filename: str
    content: bytes
    content_type: str

    def __post_init__(self) -> None:
        if not self.filename.strip() or not self.content_type.strip():
            raise ValueError("HTTP file name and content type are required")
        if any(character in self.filename for character in ('"', "\r", "\n")):
            raise ValueError("HTTP file name contains unsafe multipart header characters")
        if "\r" in self.content_type or "\n" in self.content_type:
            raise ValueError("HTTP content type contains unsafe multipart header characters")


@dataclass(frozen=True)
class HttpRequest:
    method: str
    url: str
    headers: dict[str, str] = field(default_factory=dict)
    body: Any = None
    path_params: dict[str, str] = field(default_factory=dict)
    query: dict[str, str | list[str]] = field(default_factory=dict)
    form_fields: dict[str, str] = field(default_factory=dict)
    cookies: dict[str, str] = field(default_factory=dict)
    files: dict[str, HttpFile] = field(default_factory=dict)


@dataclass(frozen=True)
class HttpResponse:
    status_code: int
    headers: dict[str, str]
    body: Any
    raw_body: bytes

    @property
    def ok(self) -> bool:
        return 200 <= self.status_code < 400


def send_http_request(
    request: HttpRequest,
    policy: ExecutionTargetPolicy,
    *,
    evidence_directory: Path | None = None,
    evidence_id: str | None = None,
    write_policy: WritePolicy | None = None,
) -> HttpResponse:
    prepared_url = _prepare_url(request)
    assert_url_allowed(prepared_url, policy)
    body, headers = _encode_request_body(request)
    if request.cookies:
        headers["Cookie"] = "; ".join(
            f"{name}={value}" for name, value in sorted(request.cookies.items())
        )
    _save_request_evidence(
        request.method,
        prepared_url,
        headers,
        body,
        evidence_directory=evidence_directory,
        evidence_id=evidence_id,
        write_policy=write_policy,
    )
    prepared = Request(prepared_url, data=body, headers=headers, method=request.method.upper())
    opener = build_opener(_RejectRedirects())
    try:
        with opener.open(prepared, timeout=30) as response:
            return _read_response(response.status, response.headers, response.read())
    except HTTPError as error:
        if 300 <= error.code < 400:
            raise RuntimePolicyError(
                ErrorCode.REDIRECT_REJECTED,
                "HTTP redirects are rejected because the destination was not pre-approved.",
                details={"location": error.headers.get("Location", "")},
            ) from error
        return _read_response(error.code, error.headers, error.read())


class _RejectRedirects(HTTPRedirectHandler):
    def redirect_request(self, *args: Any, **kwargs: Any) -> None:
        return None


def _encode_body(body: Any, headers: dict[str, str]) -> tuple[bytes | None, dict[str, str]]:
    copied_headers = dict(headers)
    if body is None:
        return None, copied_headers
    if isinstance(body, bytes):
        return body, copied_headers
    if isinstance(body, str):
        return body.encode("utf-8"), copied_headers
    copied_headers.setdefault("Content-Type", "application/json")
    return json.dumps(body, ensure_ascii=False).encode("utf-8"), copied_headers


def _prepare_url(request: HttpRequest) -> str:
    url = request.url
    for name, path_value in sorted(request.path_params.items()):
        marker = "{" + name + "}"
        if marker not in url:
            raise RuntimePolicyError(
                ErrorCode.UNAPPROVED_TARGET,
                "HTTP path parameter does not match a URL template marker.",
                details={"parameter": name},
            )
        url = url.replace(marker, quote(path_value, safe=""))
    if "{" in url or "}" in url:
        raise RuntimePolicyError(
            ErrorCode.UNAPPROVED_TARGET,
            "HTTP URL contains unresolved path parameters.",
        )
    parts = urlsplit(url)
    query_items: list[tuple[str, str]] = list(parse_qsl(parts.query, keep_blank_values=True))
    for name, query_value in request.query.items():
        values = query_value if isinstance(query_value, list) else [query_value]
        query_items.extend((name, item) for item in values)
    return urlunsplit(
        (parts.scheme, parts.netloc, parts.path, urlencode(query_items), parts.fragment)
    )


def _encode_request_body(request: HttpRequest) -> tuple[bytes | None, dict[str, str]]:
    if request.files:
        if request.body is not None:
            raise ValueError("multipart files cannot be combined with a separate body")
        return _encode_multipart(request.form_fields, request.files, request.headers)
    if request.form_fields:
        if request.body is not None:
            raise ValueError("form fields cannot be combined with a separate body")
        headers = dict(request.headers)
        headers.setdefault("Content-Type", "application/x-www-form-urlencoded")
        return urlencode(sorted(request.form_fields.items())).encode("utf-8"), headers
    return _encode_body(request.body, request.headers)


def _encode_multipart(
    fields: dict[str, str],
    files: dict[str, HttpFile],
    headers: dict[str, str],
) -> tuple[bytes, dict[str, str]]:
    for name in (*fields, *files):
        if not name or any(character in name for character in ('"', "\r", "\n")):
            raise ValueError("multipart field name contains unsafe header characters")
    digest = hashlib.sha256()
    for name, value in sorted(fields.items()):
        digest.update(name.encode())
        digest.update(value.encode())
    for name, item in sorted(files.items()):
        digest.update(name.encode())
        digest.update(item.filename.encode())
        digest.update(item.content)
    boundary = f"msta-{digest.hexdigest()[:24]}"
    chunks: list[bytes] = []
    for name, value in sorted(fields.items()):
        chunks.extend(
            [
                f"--{boundary}\r\n".encode(),
                f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode(),
                value.encode(),
                b"\r\n",
            ]
        )
    for name, item in sorted(files.items()):
        chunks.extend(
            [
                f"--{boundary}\r\n".encode(),
                (
                    f'Content-Disposition: form-data; name="{name}"; '
                    f'filename="{item.filename}"\r\n'
                ).encode(),
                f"Content-Type: {item.content_type}\r\n\r\n".encode(),
                item.content,
                b"\r\n",
            ]
        )
    chunks.append(f"--{boundary}--\r\n".encode())
    copied_headers = dict(headers)
    copied_headers["Content-Type"] = f"multipart/form-data; boundary={boundary}"
    return b"".join(chunks), copied_headers


def _save_request_evidence(
    method: str,
    url: str,
    headers: dict[str, str],
    body: bytes | None,
    *,
    evidence_directory: Path | None,
    evidence_id: str | None,
    write_policy: WritePolicy | None,
) -> None:
    supplied = (evidence_directory is not None, evidence_id is not None, write_policy is not None)
    if not any(supplied):
        return
    if not all(supplied) or evidence_id is None or not _EVIDENCE_ID.fullmatch(evidence_id):
        raise RuntimePolicyError(
            ErrorCode.PATH_TRAVERSAL,
            "HTTP evidence requires a controlled directory, policy and safe evidence ID.",
        )
    assert evidence_directory is not None and write_policy is not None
    raw = {
        "method": method.upper(),
        "url": url,
        "headers": headers,
        "body_base64": base64.b64encode(body or b"").decode("ascii"),
    }
    redacted = {
        **raw,
        "url": _redact_url(url),
        "headers": {name: redact_cell(name, value) for name, value in headers.items()},
        "body_base64": REDACTED if body else "",
    }
    atomic_write_json(
        evidence_directory / f"{evidence_id}.raw-request.json",
        raw,
        policy=write_policy,
    )
    atomic_write_json(
        evidence_directory / f"{evidence_id}.redacted-request.json",
        redacted,
        policy=write_policy,
    )


def _redact_url(url: str) -> str:
    parts = urlsplit(url)
    redacted_query = [
        (name, str(redact_cell(name, value)))
        for name, value in parse_qsl(parts.query, keep_blank_values=True)
    ]
    return urlunsplit(
        (parts.scheme, parts.netloc, parts.path, urlencode(redacted_query), parts.fragment)
    )


def _read_response(status: int, headers: Any, raw_body: bytes) -> HttpResponse:
    content_type = headers.get("Content-Type", "")
    text = raw_body.decode("utf-8", errors="replace")
    if "json" in content_type.lower():
        try:
            body: Any = json.loads(text)
        except json.JSONDecodeError:
            body = text
    else:
        body = text
    return HttpResponse(status, dict(headers.items()), body, raw_body)

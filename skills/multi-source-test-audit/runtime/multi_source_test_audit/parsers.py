from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

HTTP_METHODS = {"get", "post", "put", "patch", "delete", "head", "options", "trace"}


@dataclass(frozen=True)
class InterfaceRecord:
    source: str
    path: str
    method: str
    headers: dict[str, Any] = field(default_factory=dict)
    query_parameters: list[dict[str, Any]] = field(default_factory=list)
    path_parameters: list[dict[str, Any]] = field(default_factory=list)
    body: Any = None
    auth: Any = None
    scripts: list[str] = field(default_factory=list)
    variables: dict[str, Any] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)


def parse_interface_file(path: str | Path) -> list[InterfaceRecord]:
    source = Path(path)
    warnings: list[str] = []
    parse_interface_file.last_warnings = warnings  # type: ignore[attr-defined]
    if source.suffix.lower() in {".yaml", ".yml"}:
        warnings.append(
            "YAML parsing requires a bundled parser and is not enabled in this foundation."
        )
        return []
    try:
        payload = json.loads(source.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        warnings.append(f"Unable to parse JSON interface export: {exc}")
        return []
    if isinstance(payload, dict) and isinstance(payload.get("paths"), dict):
        return _parse_openapi(payload, source)
    if isinstance(payload, dict) and isinstance(payload.get("item"), list):
        return _parse_postman(payload, source)
    warnings.append("JSON document is not a supported OpenAPI, Swagger, Apifox or Postman export.")
    return []


def _parse_openapi(payload: dict[str, Any], source: Path) -> list[InterfaceRecord]:
    records: list[InterfaceRecord] = []
    for path, path_item in payload["paths"].items():
        if not isinstance(path_item, dict):
            continue
        shared_parameters = path_item.get("parameters", [])
        for method, operation in path_item.items():
            if method.lower() not in HTTP_METHODS or not isinstance(operation, dict):
                continue
            parameters = [*shared_parameters, *operation.get("parameters", [])]
            path_parameters = [p for p in parameters if p.get("in") == "path"]
            query_parameters = [p for p in parameters if p.get("in") == "query"]
            body = _openapi_body(operation.get("requestBody"))
            security = operation.get("security", payload.get("security"))
            auth = security[0] if isinstance(security, list) and security else security
            records.append(
                InterfaceRecord(
                    source=f"{source}#/paths/{path}/{method}",
                    path=path,
                    method=method.upper(),
                    path_parameters=path_parameters,
                    query_parameters=query_parameters,
                    body=body,
                    auth=auth,
                )
            )
    return records


def _openapi_body(request_body: Any) -> Any:
    if not isinstance(request_body, dict):
        return None
    content = request_body.get("content", {})
    if not isinstance(content, dict) or not content:
        return None
    first_media = next(iter(content.values()))
    if isinstance(first_media, dict):
        return first_media.get("example", first_media.get("examples"))
    return None


def _parse_postman(payload: dict[str, Any], source: Path) -> list[InterfaceRecord]:
    records: list[InterfaceRecord] = []

    def visit(items: list[Any]) -> None:
        for item in items:
            if not isinstance(item, dict):
                continue
            if isinstance(item.get("item"), list):
                visit(item["item"])
            request = item.get("request")
            if not isinstance(request, dict):
                continue
            url = request.get("url", "")
            raw_url = url.get("raw", "") if isinstance(url, dict) else str(url)
            parsed = urlparse(raw_url)
            headers = {
                str(header.get("key")): header.get("value")
                for header in request.get("header", [])
                if isinstance(header, dict) and header.get("key")
            }
            query = url.get("query", []) if isinstance(url, dict) else []
            path = parsed.path or "/"
            records.append(
                InterfaceRecord(
                    source=f"{source}#/item/{item.get('name', 'unnamed')}",
                    path=path,
                    method=str(request.get("method", "GET")).upper(),
                    headers=headers,
                    query_parameters=query if isinstance(query, list) else [],
                    body=request.get("body"),
                    auth=request.get("auth"),
                    scripts=[
                        str(event.get("script", {}).get("exec", ""))
                        for event in item.get("event", [])
                        if isinstance(event, dict)
                    ],
                )
            )

    visit(payload["item"])
    return records


parse_interface_file.last_warnings = []  # type: ignore[attr-defined]

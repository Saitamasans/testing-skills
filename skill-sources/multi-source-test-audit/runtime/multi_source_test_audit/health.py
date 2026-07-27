from __future__ import annotations

import platform
from typing import Any

from .paths import get_runtime_root
from .version import __version__


def health_report() -> dict[str, Any]:
    return {
        "status": "healthy",
        "component": "runtime-foundation",
        "package_version": __version__,
        "python_version": platform.python_version(),
        "runtime_root": str(get_runtime_root()),
        "business_execution_enabled": False,
    }

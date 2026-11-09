"""J.A.R.V.I.S. Cortex OS — Mark-VII Tactical HUD User Interface Package.

Provides zero-dependency access to the self-contained HTML5/Canvas/WebAudio
Mark-VII HUD Dashboard (`dashboard.html`).
"""

from __future__ import annotations

import os
from pathlib import Path

UI_DIR = Path(__file__).resolve().parent
DASHBOARD_HTML_PATH = str(UI_DIR / "dashboard.html")


def get_dashboard_path() -> str:
    """Returns the absolute filesystem path to `dashboard.html`."""
    return DASHBOARD_HTML_PATH


def get_dashboard_html() -> str:
    """Reads and returns the complete UTF-8 HTML5 Mark-VII HUD document."""
    with open(DASHBOARD_HTML_PATH, "r", encoding="utf-8") as fh:
        return fh.read()


__all__ = [
    "UI_DIR",
    "DASHBOARD_HTML_PATH",
    "get_dashboard_path",
    "get_dashboard_html",
]

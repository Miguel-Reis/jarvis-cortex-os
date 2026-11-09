"""J.A.R.V.I.S. Cortex OS — Desktop Sidecar Package."""

from jarvis_os.sidecar.desktop_agent import (
    DesktopSidecar,
    HotkeyBinding,
    WakeWordDetector,
    WakeWordEvent,
    WindowInfo,
)

__all__ = [
    "DesktopSidecar",
    "HotkeyBinding",
    "WakeWordDetector",
    "WakeWordEvent",
    "WindowInfo",
]

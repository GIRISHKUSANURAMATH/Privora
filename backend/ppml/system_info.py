"""Cross-platform host information (no third-party dependencies).

Branches on ``sys.platform`` so that both the runtime and static type checkers (mypy evaluates
``sys.platform`` comparisons for the target platform) only see the API that exists there:
``GlobalMemoryStatusEx`` on Windows, ``sysctl hw.memsize`` on macOS, ``sysconf`` elsewhere.
"""

from __future__ import annotations

import ctypes
import os
import sys


def total_memory_bytes() -> int | None:
    """Physical memory installed, in bytes, or ``None`` if the OS does not report it."""
    if sys.platform == "win32":

        class MEMORYSTATUSEX(ctypes.Structure):
            _fields_ = [
                ("dwLength", ctypes.c_ulong),
                ("dwMemoryLoad", ctypes.c_ulong),
                ("ullTotalPhys", ctypes.c_ulonglong),
                ("ullAvailPhys", ctypes.c_ulonglong),
                ("ullTotalPageFile", ctypes.c_ulonglong),
                ("ullAvailPageFile", ctypes.c_ulonglong),
                ("ullTotalVirtual", ctypes.c_ulonglong),
                ("ullAvailVirtual", ctypes.c_ulonglong),
                ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
            ]

        stat = MEMORYSTATUSEX()
        stat.dwLength = ctypes.sizeof(MEMORYSTATUSEX)
        if not ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(stat)):
            return None
        return int(stat.ullTotalPhys)
    if sys.platform == "darwin":
        size = ctypes.c_uint64(0)
        length = ctypes.c_size_t(ctypes.sizeof(size))
        libc = ctypes.CDLL(None)
        if libc.sysctlbyname(b"hw.memsize", ctypes.byref(size), ctypes.byref(length), None, 0) != 0:
            return None
        return int(size.value)
    try:
        return int(os.sysconf("SC_PAGE_SIZE")) * int(os.sysconf("SC_PHYS_PAGES"))
    except (ValueError, OSError, AttributeError):
        return None


def total_memory_gb() -> float | None:
    """Physical memory in GB (10^9 bytes), rounded to one decimal, or ``None``."""
    b = total_memory_bytes()
    return round(b / 1e9, 1) if b else None

"""Optional heartbeat pings so an external monitor can alert when the server is down.

Point ASSIST_HEARTBEAT_URL at a service like healthchecks.io or an ntfy topic.
If the server stops, the pings stop, and that service raises the alarm. Nothing
happens when the variable is unset.
"""

import logging
import os
import threading

import httpx

log = logging.getLogger("assist.heartbeat")

_thread: threading.Thread | None = None
_stop: threading.Event | None = None

DEFAULT_SECONDS = 60


def heartbeat_url() -> str | None:
    url = os.environ.get("ASSIST_HEARTBEAT_URL", "").strip()
    return url or None


def heartbeat_seconds() -> int:
    try:
        return max(15, int(os.environ.get("ASSIST_HEARTBEAT_SECONDS", DEFAULT_SECONDS)))
    except ValueError:
        return DEFAULT_SECONDS


def start_heartbeat_thread() -> None:
    global _thread, _stop
    url = heartbeat_url()
    if not url or (_thread is not None and _thread.is_alive()):
        return
    stop = threading.Event()
    _stop = stop
    interval = heartbeat_seconds()

    def loop() -> None:
        with httpx.Client() as client:
            while not stop.is_set():
                try:
                    client.get(url, timeout=10)
                except Exception:
                    log.warning("heartbeat ping failed", exc_info=True)
                if stop.wait(interval):
                    return

    _thread = threading.Thread(target=loop, name="assist-heartbeat", daemon=True)
    _thread.start()


def stop_heartbeat_thread() -> None:
    global _thread, _stop
    if _stop is not None:
        _stop.set()
    if _thread is not None:
        _thread.join(timeout=5)
    _thread = None
    _stop = None

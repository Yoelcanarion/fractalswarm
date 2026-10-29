"""Test setup shared by every test.

The API refuses any ``Host`` that is not loopback or the address ``serve`` was given
(``api/guard.py``), and Starlette's TestClient says ``testserver``. Make it say what a browser on
this machine would, so a test that builds ``TestClient(app)`` talks to the API the way the UI does.
Starlette also joins a WebSocket path onto ``ws://testserver`` whatever the client's base URL is;
here it is joined onto the base URL. The guard's own tests pass a ``base_url`` or a ``Host`` of
their own.
"""

from starlette.testclient import TestClient

_init = TestClient.__init__
_websocket_connect = TestClient.websocket_connect


def _loopback_init(self, app, base_url="http://127.0.0.1", *args, **kwargs):
    _init(self, app, base_url, *args, **kwargs)


def _websocket_on_base_url(self, url, subprotocols=None, **kwargs):
    if url.startswith("/"):
        url = f"ws://{self.base_url.netloc.decode('ascii')}{url}"
    return _websocket_connect(self, url, subprotocols, **kwargs)


TestClient.__init__ = _loopback_init
TestClient.websocket_connect = _websocket_on_base_url

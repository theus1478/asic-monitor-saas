import asyncio
import base64
import http.server
import json
import threading

import httpx
import pytest
from websockets.asyncio.server import serve

import tunnel


class FakeAsic(http.server.BaseHTTPRequestHandler):
    seen: list = []

    def log_message(self, *args):
        pass

    def _reply(self, status=200, body=b"", headers=None):
        self.send_response(status)
        for name, value in (headers or {}).items():
            self.send_header(name, value)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        FakeAsic.seen.append((self.path, dict(self.headers)))
        if self.path == "/redirect":
            return self._reply(302, headers={"Location": "http://192.168.1.5/next"})
        if self.path == "/cookies":
            self.send_response(200)
            self.send_header("Set-Cookie", "a=1")
            self.send_header("Set-Cookie", "b=2")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        self._reply(body=b"hello")

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        self._reply(body=b"got:" + self.rfile.read(length))


@pytest.fixture()
def asic():
    FakeAsic.seen = []
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), FakeAsic)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield server.server_address[1]
    server.shutdown()


def miner(port):
    return {"id": "m1", "ip": "127.0.0.1", "web_port": port, "enabled": True}


def frame(**over):
    base = {"t": "req", "id": "r1", "miner_id": "m1", "method": "GET", "path": "/", "headers": {}, "body_b64": "", "public_origin": "https://m-m1.remote.test"}
    base.update(over)
    return base


def run(coro):
    return asyncio.run(coro)


async def fetch(port, **over):
    async with httpx.AsyncClient() as client:
        return await tunnel.fetch_from_miner(client, miner(port), frame(**over))


def test_get_and_post_round_trip(asic):
    reply = run(fetch(asic))
    assert reply["status"] == 200 and base64.b64decode(reply["body_b64"]) == b"hello"
    body = base64.b64encode(b"abc").decode()
    reply = run(fetch(asic, method="POST", path="/x", body_b64=body))
    assert base64.b64decode(reply["body_b64"]) == b"got:abc"


def test_headers_are_rewritten_for_the_asic(asic):
    run(fetch(asic, headers={"host": "m-m1.remote.test", "origin": "https://m-m1.remote.test", "referer": "https://m-m1.remote.test/a", "x-forwarded-for": "1.2.3.4", "accept-encoding": "gzip", "authorization": "Digest x"}))
    _, raw = FakeAsic.seen[-1]
    headers = {name.lower(): value for name, value in raw.items()}
    assert headers["host"] == f"127.0.0.1:{asic}"
    assert headers["origin"] == f"http://127.0.0.1:{asic}"
    assert headers["referer"] == f"http://127.0.0.1:{asic}/a"
    assert headers["accept-encoding"] == "identity"
    assert headers["authorization"] == "Digest x"
    assert "x-forwarded-for" not in headers


def test_redirect_is_not_followed_and_multiple_cookies_kept(asic):
    reply = run(fetch(asic, path="/redirect"))
    assert reply["status"] == 302
    assert ["Location", "http://192.168.1.5/next"] in [[n.title(), v] for n, v in reply["headers"]]
    cookies = [v for n, v in run(fetch(asic, path="/cookies"))["headers"] if n.lower() == "set-cookie"]
    assert cookies == ["a=1", "b=2"]


@pytest.mark.parametrize("over", [{"method": "CONNECT"}, {"path": "http://evil/"}, {"path": "/a b"}, {"path": "//evil.com/x\r\nHost: y"}])
def test_invalid_requests_are_refused(asic, over):
    with pytest.raises(tunnel.TunnelError) as error:
        run(fetch(asic, **over))
    assert error.value.code == "forbidden"


def test_only_registered_ip_literals(asic):
    with pytest.raises(tunnel.TunnelError):
        tunnel.build_upstream_request({"id": "m1", "ip": "example.com", "web_port": 80}, frame())


def test_unknown_or_disabled_miner_is_not_found():
    miners = [miner(80), {"id": "m2", "ip": "10.0.0.2", "enabled": False}]
    assert tunnel.find_miner(miners, "m1") is not None
    assert tunnel.find_miner(miners, "m2") is None
    assert tunnel.find_miner(miners, "outra-fazenda") is None


def test_unreachable_asic():
    with pytest.raises(tunnel.TunnelError) as error:
        run(fetch(1))  # nada escuta na porta 1
    assert error.value.code == "unreachable"


def test_tunnel_serves_frames_over_websocket_and_ignores_foreign_miner(asic):
    """Relay falso: manda 2 requisições (uma de máquina alheia) e confere as respostas."""
    results = {}

    async def main():
        async def relay_handler(ws):
            assert ws.request.headers["Authorization"] == "Bearer tok"
            await ws.send(json.dumps(frame(id="ok")))
            await ws.send(json.dumps(frame(id="alheia", miner_id="outra")))
            for _ in range(2):
                message = json.loads(await ws.recv())
                results[message["id"]] = message
            await ws.close()

        events = []
        state = {"enabled": True, "relay_url": "", "token": "tok", "miners": [miner(asic)], "stopped": False}
        async with serve(relay_handler, "127.0.0.1", 0) as server:
            state["relay_url"] = f"ws://127.0.0.1:{server.sockets[0].getsockname()[1]}/agent"
            client = tunnel.Tunnel(lambda: state, lambda s, m: events.append(s))
            task = asyncio.create_task(client.run())
            for _ in range(100):
                if len(results) == 2:
                    break
                await asyncio.sleep(0.05)
            state["stopped"] = True
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        return events

    events = run(main())
    assert results["ok"]["t"] == "res" and results["ok"]["status"] == 200
    assert results["alheia"] == {"t": "err", "id": "alheia", "code": "forbidden", "message": "Máquina não pertence a esta fazenda."}
    assert "connected" in events

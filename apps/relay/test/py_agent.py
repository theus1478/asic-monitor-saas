"""Coletor real (apps/agent/src/tunnel.py) para o teste ponta a ponta do relay.

Uso: python py_agent.py <relay_ws_url> <token> <ip> <porta_web_maquina_1> <id_1> <porta_web_maquina_2> <id_2>
"""

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "agent" / "src"))

from tunnel import Tunnel  # noqa: E402


async def main() -> None:
    url, token, ip, port1, id1, port2, id2 = sys.argv[1:8]
    state = {
        "enabled": True,
        "relay_url": url,
        "token": token,
        "stopped": False,
        "miners": [
            {"id": id1, "ip": ip, "web_port": int(port1), "enabled": True},
            {"id": id2, "ip": ip, "web_port": int(port2), "enabled": True},
        ],
    }
    await Tunnel(lambda: state, lambda s, m: print(f"tunnel {s}: {m}", flush=True)).run()


asyncio.run(main())

"""ASIC Monitor Agent - aplicativo local com interface.

Acesso protegido pelo token da fazenda (pedido toda vez que o app abre,
valida contra a nuvem e mostra quantas licencas estao disponiveis). Lista
de maquinas com escaneamento de rede (faixa de IP configuravel, valida o
protocolo de verdade em vez de so checar porta aberta) ou cadastro manual,
e um coletor rodando em segundo plano que envia telemetria e processa
comandos de troca de pool / reinicio a cada ciclo.

Empacotado com PyInstaller (veja README.md) como um .exe unico e sem console.
"""
import asyncio
import concurrent.futures
import ipaddress
import json
import os
import queue
import socket
import sys
import threading
import tkinter as tk
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from tkinter import messagebox, ttk

import httpx

from miners import apply_pool_config, poll_miner, reboot_miner, stop_mining_miner

AGENT_VERSION = "0.8.0"
STARTUP_DIR = Path(os.environ.get("APPDATA", "")) / "Microsoft" / "Windows" / "Start Menu" / "Programs" / "Startup"
STARTUP_LAUNCHER_NAME = "ASICMonitorAgent.bat"
MINER_TYPES = ["antminer", "whatsminer", "avalon"]
LAST_LOGIN_PATH_NAME = "last_login.json"


def base_dir() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent


def last_login_path() -> Path:
    return base_dir() / LAST_LOGIN_PATH_NAME


def load_last_login() -> dict:
    try:
        return json.loads(last_login_path().read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def save_last_login(api_url: str, agent_token: str) -> None:
    try:
        last_login_path().write_text(json.dumps({"api_url": api_url, "agent_token": agent_token}), encoding="utf-8")
    except OSError:
        pass


def config_url_from_api_url(api_url: str) -> str:
    base = api_url[: -len("/metrics")] if api_url.endswith("/metrics") else api_url.rstrip("/")
    return base + "/config"


def commands_url_from_api_url(api_url: str) -> str:
    base = api_url[: -len("/metrics")] if api_url.endswith("/metrics") else api_url.rstrip("/")
    return base + "/commands"


def ensure_startup_entry() -> None:
    try:
        STARTUP_DIR.mkdir(parents=True, exist_ok=True)
        launcher = STARTUP_DIR / STARTUP_LAUNCHER_NAME
        exe_path = Path(sys.executable).resolve() if getattr(sys, "frozen", False) else Path(__file__).resolve()
        launcher.write_text(f'@echo off\r\nstart "" /min "{exe_path}"\r\n', encoding="utf-8")
    except OSError:
        pass


# ------------------------- escaneamento de rede -------------------------

def _tcp_open(ip: str, port: int, timeout: float = 0.3) -> bool:
    try:
        with socket.create_connection((ip, port), timeout=timeout):
            return True
    except OSError:
        return False


def _probe_cgminer_family(ip: str, timeout: float = 1.2) -> bool:
    """Confirma que o dispositivo responde ao protocolo cgminer/bmminer (Whatsminer/Avalon),
    não só que a porta 4028 está aberta (roteadores e outros serviços também abrem portas)."""
    try:
        with socket.create_connection((ip, 4028), timeout=timeout) as sock:
            sock.sendall(json.dumps({"command": "summary"}).encode())
            sock.settimeout(timeout)
            data = b""
            while len(data) < 65536:
                chunk = sock.recv(4096)
                if not chunk:
                    break
                data += chunk
        text = data.decode("utf-8", errors="ignore").replace("\x00", "").strip()
        parsed = json.loads(text)
        return isinstance(parsed, dict) and any(key in parsed for key in ("SUMMARY", "STATUS", "Msg"))
    except Exception:
        return False


def _probe_antminer_http(ip: str, timeout: float = 1.2) -> bool:
    """Confirma a API HTTP do Antminer (Vnish/Bitmain), não só que a porta 80 está aberta."""
    try:
        req = urllib.request.Request(f"http://{ip}/api/v1/summary", headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=timeout) as response:
            data = json.loads(response.read().decode("utf-8", errors="ignore"))
        return isinstance(data, dict) and "miner" in data
    except Exception:
        return False


def _cgminer_command(ip: str, command: str, timeout: float = 1.2) -> dict | None:
    """Envia um comando ao socket cgminer/bmminer (porta 4028); None se falhar."""
    try:
        with socket.create_connection((ip, 4028), timeout=timeout) as sock:
            sock.sendall(json.dumps({"command": command}).encode())
            sock.settimeout(timeout)
            data = b""
            while len(data) < 65536:
                chunk = sock.recv(4096)
                if not chunk:
                    break
                data += chunk
        text = data.decode("utf-8", errors="ignore").replace("\x00", "").strip()
        parsed = json.loads(text)
        return parsed if isinstance(parsed, dict) else None
    except Exception:
        return None


def _cgminer_list(resp: dict | None, key: str) -> list:
    """Mesma lógica de miners._get_list: lida com o embrulho 'Msg' do BixBit."""
    if not isinstance(resp, dict):
        return []
    if isinstance(resp.get(key), list):
        return resp[key]
    msg = resp.get("Msg")
    if isinstance(msg, dict) and isinstance(msg.get(key), list):
        return msg[key]
    if isinstance(msg, list) and key == "STATS":
        return msg
    return []


def _classify_cgminer_device(ip: str) -> str:
    """Dispositivo já confirmado como família cgminer (porta 4028 responde ao
    protocolo) - descobre o fabricante real em vez de assumir Whatsminer pra
    tudo. Avalon e Antminer com firmware original (sem VNish - placas AML, Xil
    e BB) falam o mesmo protocolo de socket, então a porta aberta sozinha não
    diferencia o fabricante."""
    stats = _cgminer_command(ip, "estats")
    for block in _cgminer_list(stats, "STATS"):
        if isinstance(block, dict) and any(str(key).startswith("MM ID") for key in block):
            return "avalon"

    summary = _cgminer_command(ip, "summary")
    summary_list = _cgminer_list(summary, "SUMMARY")
    if summary_list and "Miner Type" in summary_list[0]:
        return "whatsminer"

    # Sobrou: família cgminer confirmada, sem "MM ID" (Avalon) nem "Miner Type"
    # (Whatsminer/BixBit) -> Antminer com firmware original (bmminer), o que
    # inclui placas controladoras AML, Xil e BB - todas falam o mesmo socket.
    return "antminer"


def hosts_in_range(start_ip: str, end_ip: str) -> list[str]:
    start = ipaddress.IPv4Address(start_ip)
    end = ipaddress.IPv4Address(end_ip)
    if int(end) < int(start):
        start, end = end, start
    if int(end) - int(start) > 1024:
        raise ValueError("Faixa grande demais (máximo 1024 endereços por vez).")
    return [str(ipaddress.IPv4Address(value)) for value in range(int(start), int(end) + 1)]


def scan_range(start_ip: str, end_ip: str, progress_callback=None) -> list[dict]:
    """Varre a faixa de IP informada e confirma via protocolo real (não só porta aberta)."""
    hosts = hosts_in_range(start_ip, end_ip)
    total = len(hosts)
    found: list[dict] = []

    def probe(ip: str):
        if _tcp_open(ip, 80, timeout=0.3) and _probe_antminer_http(ip):
            return {"ip": ip, "port": 4028, "type": "antminer", "name": ip}
        if _tcp_open(ip, 4028, timeout=0.3) and _probe_cgminer_family(ip):
            return {"ip": ip, "port": 4028, "type": _classify_cgminer_device(ip), "name": ip}
        return None

    with concurrent.futures.ThreadPoolExecutor(max_workers=48) as pool:
        futures = {pool.submit(probe, ip): ip for ip in hosts}
        done = 0
        for future in concurrent.futures.as_completed(futures):
            done += 1
            if progress_callback:
                progress_callback(done, total)
            result = future.result()
            if result:
                found.append(result)
    found.sort(key=lambda item: tuple(int(part) for part in item["ip"].split(".")))
    return found


def guess_local_prefix() -> str:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            local_ip = s.getsockname()[0]
        return ".".join(local_ip.split(".")[:3])
    except OSError:
        return "192.168.0"


# ------------------------- validação do token contra a nuvem -------------------------

def validate_login(api_url: str, agent_token: str) -> dict:
    """Confirma o token com a nuvem e devolve fazenda + licenças. Lança RuntimeError com
    uma mensagem amigável em caso de falha (URL inválida, token errado, rede fora)."""
    if not api_url.startswith("http://") and not api_url.startswith("https://"):
        raise RuntimeError("A URL precisa começar com http:// ou https://.")
    if not agent_token:
        raise RuntimeError("Informe o token do agente.")
    config_url = config_url_from_api_url(api_url)
    try:
        response = httpx.get(config_url, headers={"Authorization": f"Bearer {agent_token}"}, timeout=10)
    except httpx.HTTPError as error:
        raise RuntimeError(f"Não consegui conectar: {error}") from error
    if response.status_code == 401:
        raise RuntimeError("Token inválido — gere um novo em Fazendas > Coletor no painel.")
    if response.status_code != 200:
        raise RuntimeError(f"O servidor respondeu com erro ({response.status_code}).")
    return response.json()


# ------------------------- coletor em segundo plano (só leitura/telemetria) -------------------------

class Collector:
    """Roda o loop assincrono de telemetria numa thread separada da UI e publica
    atualizacoes numa Queue que a janela principal consome via root.after().
    Nao lida com adicionar/remover maquina - isso e feito direto por chamadas
    HTTP simples disparadas pelos botoes, para dar retorno imediato ao usuario."""

    def __init__(self, ui_events: "queue.Queue", config: dict, miners: list[dict]):
        self.ui_events = ui_events
        self.config = config
        self.miners = miners
        self._thread = threading.Thread(target=self._run_loop, daemon=True)
        self._stop = threading.Event()

    def start(self) -> None:
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()

    def set_miners(self, miners: list[dict]) -> None:
        self.miners = miners

    def _run_loop(self) -> None:
        asyncio.run(self._async_main())

    async def _async_main(self) -> None:
        headers = {"Authorization": f"Bearer {self.config['agent_token']}", "X-Agent-Version": AGENT_VERSION}
        config_url = config_url_from_api_url(self.config["api_url"])
        commands_url = commands_url_from_api_url(self.config["api_url"])
        interval = 30

        async with httpx.AsyncClient(timeout=15) as client:
            while not self._stop.is_set():
                await self._sync_miners(client, config_url, headers)
                await self._process_command(client, commands_url, headers)
                await self._poll_and_report(client, self.config["api_url"], headers)
                for _ in range(interval):
                    if self._stop.is_set():
                        break
                    await asyncio.sleep(1)

    async def _sync_miners(self, client, config_url, headers) -> None:
        try:
            response = await client.get(config_url, headers=headers)
            response.raise_for_status()
            data = response.json()
            self.miners = data.get("miners", self.miners)
            self.ui_events.put({"type": "miners_updated", "miners": self.miners, "licensed_machines": data.get("licensed_machines"), "used_machines": data.get("used_machines"), "farm_name": data.get("farm_name")})
        except httpx.HTTPError as error:
            self.ui_events.put({"type": "status", "message": f"Falha ao sincronizar com a nuvem: {error}"})

    async def _process_command(self, client, commands_url, headers) -> None:
        try:
            response = await client.get(commands_url, headers=headers)
            response.raise_for_status()
            command = response.json().get("command")
            if not command:
                return
            kind = command.get("kind")
            miners = command.get("miners", [])
            if kind == "pool_update":
                results = await asyncio.gather(*(apply_pool_config(m, m.get("credentials"), command.get("pools", [])) for m in miners))
            elif kind == "reboot":
                results = await asyncio.gather(*(reboot_miner(m, m.get("credentials")) for m in miners))
            elif kind == "stop_mining":
                results = await asyncio.gather(*(stop_mining_miner(m, m.get("credentials")) for m in miners))
            else:
                return
            report = await client.post(commands_url, headers=headers, json={"command_id": command["id"], "results": list(results)})
            report.raise_for_status()
        except httpx.HTTPError as error:
            self.ui_events.put({"type": "status", "message": f"Falha ao processar comando: {error}"})

    async def _poll_and_report(self, client, api_url, headers) -> None:
        licensed_miners = [m for m in self.miners if m.get("licensed", True)]
        if not licensed_miners:
            self.ui_events.put({"type": "metrics", "metrics": []})
            return
        metrics = await asyncio.gather(*(poll_miner(m) for m in licensed_miners))
        self.ui_events.put({"type": "metrics", "metrics": list(metrics)})
        payload = {"observed_at": datetime.now(timezone.utc).isoformat(), "metrics": list(metrics)}
        try:
            response = await client.post(api_url, headers=headers, json=payload)
            response.raise_for_status()
            self.ui_events.put({"type": "status", "message": f"Última atualização: {datetime.now().strftime('%H:%M:%S')} · {len(metrics)} máquina(s)"})
        except httpx.HTTPError as error:
            self.ui_events.put({"type": "status", "message": f"Falha ao enviar métricas: {error}"})


# ------------------------- interface -------------------------

class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("ASIC Monitor Agent")
        self.geometry("920x600")
        self.minsize(780, 500)
        self.ui_events: "queue.Queue" = queue.Queue()
        self.collector: Collector | None = None
        self.config_data: dict | None = None
        self.miners: list[dict] = []
        self.metrics_by_ip: dict[str, dict] = {}
        self._build_login()

    # ---- login por token ----

    def _build_login(self) -> None:
        for widget in self.winfo_children():
            widget.destroy()
        frame = ttk.Frame(self, padding=40)
        frame.place(relx=0.5, rely=0.5, anchor="center")
        last = load_last_login()

        ttk.Label(frame, text="ASIC Monitor Agent", font=("Segoe UI", 16, "bold")).grid(row=0, column=0, columnspan=2, pady=(0, 4))
        ttk.Label(frame, text="Informe o token da fazenda para acessar").grid(row=1, column=0, columnspan=2, pady=(0, 16))

        ttk.Label(frame, text="URL da API").grid(row=2, column=0, sticky="w")
        url_entry = ttk.Entry(frame, width=40)
        url_entry.insert(0, last.get("api_url", ""))
        url_entry.grid(row=2, column=1, pady=4)

        ttk.Label(frame, text="Token do agente").grid(row=3, column=0, sticky="w")
        token_entry = ttk.Entry(frame, width=40, show="•")
        token_entry.insert(0, last.get("agent_token", ""))
        token_entry.grid(row=3, column=1, pady=4)

        status_label = ttk.Label(frame, text="", foreground="#c0392b")
        status_label.grid(row=4, column=0, columnspan=2, pady=(6, 0))

        def do_login(event=None):
            api_url = url_entry.get().strip()
            agent_token = token_entry.get().strip()
            login_button.config(state="disabled")
            status_label.config(foreground="#2c7a4b", text="Validando...")

            def worker():
                try:
                    data = validate_login(api_url, agent_token)
                except RuntimeError as error:
                    self.after(0, lambda: on_fail(str(error)))
                    return
                self.after(0, lambda: on_success(api_url, agent_token, data))

            def on_fail(message: str):
                login_button.config(state="normal")
                status_label.config(foreground="#c0392b", text=message)

            def on_success(api_url: str, agent_token: str, data: dict):
                save_last_login(api_url, agent_token)
                self.config_data = {"api_url": api_url, "agent_token": agent_token}
                self.miners = data.get("miners", [])
                self._build_main(data)

            threading.Thread(target=worker, daemon=True).start()

        login_button = ttk.Button(frame, text="Entrar", command=do_login)
        login_button.grid(row=5, column=0, columnspan=2, pady=(12, 0))
        url_entry.bind("<Return>", do_login)
        token_entry.bind("<Return>", do_login)
        url_entry.focus_set()

        # Login automatico: se ja existe uma sessao salva de uma vez anterior,
        # tenta entrar sozinho, sem exigir clique - essencial pro coletor voltar
        # a monitorar assim que o Windows liga (fica na pasta Inicializar,
        # minimizado) sem esperar alguem aparecer na frente do PC pra clicar
        # "Entrar". Se falhar (token revogado, rede fora), cai de volta nesta
        # mesma tela de login pra tentativa manual - nao trava em lugar nenhum.
        if last.get("api_url") and last.get("agent_token"):
            status_label.config(foreground="#2c7a4b", text="Entrando automaticamente com a sessão salva...")
            self.after(150, do_login)

    # ---- janela principal ----

    def _build_main(self, login_data: dict) -> None:
        for widget in self.winfo_children():
            widget.destroy()
        ensure_startup_entry()

        top = ttk.Frame(self, padding=(14, 10))
        top.pack(fill="x")
        farm_name = login_data.get("farm_name") or "Fazenda"
        self.header_label = ttk.Label(top, text=farm_name, font=("Segoe UI", 12, "bold"))
        self.header_label.pack(side="left")
        self.license_label = ttk.Label(top, text="")
        self.license_label.pack(side="left", padx=(14, 0))
        ttk.Button(top, text="Sair", command=self._logout).pack(side="right")
        self.status_label = ttk.Label(top, text="Conectando...")
        self.status_label.pack(side="right", padx=(0, 14))
        self._update_license_label(login_data.get("licensed_machines"), login_data.get("used_machines"))

        toolbar = ttk.Frame(self, padding=(14, 0))
        toolbar.pack(fill="x")
        ttk.Button(toolbar, text="+ Adicionar manualmente", command=self._open_add_manual).pack(side="left", padx=(0, 8), pady=8)
        ttk.Button(toolbar, text="⌕ Escanear rede", command=self._open_scan).pack(side="left", padx=(0, 8))
        ttk.Button(toolbar, text="Remover selecionada", command=self._remove_selected).pack(side="left")

        columns = ("ip", "port", "type", "license", "status", "hashrate", "power")
        self.tree = ttk.Treeview(self, columns=columns, show="tree headings", height=16)
        self.tree.heading("#0", text="Nome")
        self.tree.heading("ip", text="IP")
        self.tree.heading("port", text="Porta")
        self.tree.heading("type", text="Fabricante")
        self.tree.heading("license", text="Licença")
        self.tree.heading("status", text="Status")
        self.tree.heading("hashrate", text="TH/s")
        self.tree.heading("power", text="Consumo (W)")
        for col, width in (("#0", 150), ("ip", 120), ("port", 60), ("type", 90), ("license", 90), ("status", 80), ("hashrate", 80), ("power", 100)):
            self.tree.column(col, width=width, anchor="w" if col in ("#0", "ip", "type") else "center")
        self.tree.pack(fill="both", expand=True, padx=14, pady=(0, 14))

        self._render_tree()
        self.collector = Collector(self.ui_events, self.config_data, self.miners)
        self.collector.start()
        self.after(300, self._drain_events)

    def _logout(self) -> None:
        if self.collector:
            self.collector.stop()
            self.collector = None
        self._build_login()

    def _update_license_label(self, licensed, used) -> None:
        if licensed is None or used is None:
            self.license_label.config(text="")
            return
        over = used > licensed
        self.license_label.config(text=f"{used}/{licensed} licenças usadas" + (" · limite atingido" if over else ""), foreground="#c0392b" if over else "#2c7a4b")

    # ---- adicionar / remover (chamadas diretas, feedback imediato) ----

    def _request(self, method: str, path: str, json_body: dict, on_done):
        """Faz a chamada HTTP numa thread separada e chama on_done(ok, data_or_error) na UI thread."""
        config = self.config_data
        url = config_url_from_api_url(config["api_url"]) if path == "config" else config["api_url"]

        def worker():
            try:
                headers = {"Authorization": f"Bearer {config['agent_token']}"}
                with httpx.Client(timeout=15) as client:
                    response = client.request(method, url, headers=headers, json=json_body)
                if response.status_code == 401:
                    self.after(0, lambda: on_done(False, "Token inválido ou expirado."))
                    return
                if response.status_code >= 400:
                    message = response.json().get("error", f"Erro {response.status_code}") if response.headers.get("content-type", "").startswith("application/json") else f"Erro {response.status_code}"
                    self.after(0, lambda: on_done(False, message))
                    return
                self.after(0, lambda: on_done(True, response.json()))
            except httpx.HTTPError as error:
                self.after(0, lambda: on_done(False, str(error)))

        threading.Thread(target=worker, daemon=True).start()

    def _apply_config_response(self, data: dict) -> None:
        self.miners = data.get("miners", self.miners)
        if self.collector:
            self.collector.set_miners(self.miners)
        self._update_license_label(data.get("licensed_machines"), data.get("used_machines"))
        self._render_tree()

    def _open_add_manual(self) -> None:
        dialog = tk.Toplevel(self)
        dialog.title("Adicionar máquina")
        dialog.transient(self)
        dialog.grab_set()
        frame = ttk.Frame(dialog, padding=20)
        frame.pack(fill="both", expand=True)

        ttk.Label(frame, text="Nome").pack(anchor="w")
        name_entry = ttk.Entry(frame, width=40)
        name_entry.pack(fill="x", pady=(2, 10))

        ttk.Label(frame, text="IP").pack(anchor="w")
        ip_entry = ttk.Entry(frame, width=40)
        ip_entry.pack(fill="x", pady=(2, 10))

        ttk.Label(frame, text="Porta").pack(anchor="w")
        port_entry = ttk.Entry(frame, width=40)
        port_entry.insert(0, "4028")
        port_entry.pack(fill="x", pady=(2, 10))

        ttk.Label(frame, text="Fabricante").pack(anchor="w")
        type_var = tk.StringVar(value=MINER_TYPES[0])
        ttk.Combobox(frame, textvariable=type_var, values=MINER_TYPES, state="readonly").pack(fill="x", pady=(2, 14))

        status_label = ttk.Label(frame, text="", foreground="#c0392b")
        status_label.pack(anchor="w")

        def confirm():
            ip = ip_entry.get().strip()
            if not ip:
                status_label.config(text="Informe o IP.")
                return
            try:
                ipaddress.IPv4Address(ip)
            except ValueError:
                status_label.config(text="IP inválido — use o formato 192.168.0.10.")
                return
            try:
                port = int(port_entry.get() or 4028)
            except ValueError:
                status_label.config(text="Porta inválida.")
                return
            miner = {"name": name_entry.get().strip() or ip, "ip": ip, "port": port, "type": type_var.get()}
            confirm_button.config(state="disabled")
            status_label.config(foreground="#2c7a4b", text="Enviando...")

            def done(ok: bool, result):
                if ok:
                    self._apply_config_response(result)
                    dialog.destroy()
                    messagebox.showinfo("Adicionar máquina", f"{ip} adicionada.")
                else:
                    confirm_button.config(state="normal")
                    status_label.config(foreground="#c0392b", text=str(result))

            self._request("POST", "config", {"miners": [miner]}, done)

        confirm_button = ttk.Button(frame, text="OK", command=confirm)
        confirm_button.pack(anchor="e")
        name_entry.bind("<Return>", lambda event: confirm())
        ip_entry.bind("<Return>", lambda event: confirm())
        port_entry.bind("<Return>", lambda event: confirm())
        ip_entry.focus_set()

        # Tamanho calculado depois que todos os campos existem, nao um valor
        # fixo chutado - com fonte/DPI maiores que o normal, um tamanho fixo
        # cortava o botao OK pra fora da janela (ele existia, so nao dava pra
        # ver nem clicar sem redimensionar a janela manualmente).
        dialog.update_idletasks()
        dialog.geometry(f"360x{dialog.winfo_reqheight()}")
        dialog.resizable(False, False)

    def _open_scan(self) -> None:
        dialog = tk.Toplevel(self)
        dialog.title("Escanear rede")
        dialog.geometry("560x480")
        dialog.transient(self)
        frame = ttk.Frame(dialog, padding=16)
        frame.pack(fill="both", expand=True)

        default_prefix = guess_local_prefix()
        range_row = ttk.Frame(frame)
        range_row.pack(fill="x")
        ttk.Label(range_row, text="IP inicial").grid(row=0, column=0, sticky="w")
        start_entry = ttk.Entry(range_row, width=18)
        start_entry.insert(0, f"{default_prefix}.1")
        start_entry.grid(row=1, column=0, padx=(0, 12))
        ttk.Label(range_row, text="IP final").grid(row=0, column=1, sticky="w")
        end_entry = ttk.Entry(range_row, width=18)
        end_entry.insert(0, f"{default_prefix}.254")
        end_entry.grid(row=1, column=1)
        ttk.Label(frame, text="Confirma o protocolo real do dispositivo (não só a porta aberta) — evita listar roteadores, impressoras etc.", wraplength=520, foreground="#666").pack(anchor="w", pady=(8, 10))

        progress = ttk.Progressbar(frame, mode="determinate", maximum=254)
        progress.pack(fill="x", pady=(0, 10))
        status = ttk.Label(frame, text="Pronto para escanear.")
        status.pack(anchor="w")

        results_frame = ttk.Frame(frame)
        results_frame.pack(fill="both", expand=True, pady=(10, 10))
        results_list = tk.Listbox(results_frame, selectmode="multiple")
        results_list.pack(fill="both", expand=True)
        found_devices: list[dict] = []
        add_status = ttk.Label(frame, text="", foreground="#c0392b")

        def on_progress(done, total):
            self.after(0, lambda: (progress.configure(value=done, maximum=total), status.configure(text=f"Escaneando... {done}/{total}")))

        def run_scan():
            start_ip, end_ip = start_entry.get().strip(), end_entry.get().strip()
            try:
                ipaddress.IPv4Address(start_ip)
                ipaddress.IPv4Address(end_ip)
            except ValueError:
                messagebox.showerror("Escanear rede", "IP inicial ou final inválido.")
                return
            scan_button.config(state="disabled")
            results_list.delete(0, "end")
            found_devices.clear()

            def worker():
                try:
                    devices = scan_range(start_ip, end_ip, progress_callback=on_progress)
                except ValueError as error:
                    self.after(0, lambda: messagebox.showerror("Escanear rede", str(error)))
                    self.after(0, lambda: scan_button.config(state="normal"))
                    return
                found_devices.extend(devices)
                self.after(0, populate_results)

            threading.Thread(target=worker, daemon=True).start()

        def populate_results():
            scan_button.config(state="normal")
            status.config(text=f"{len(found_devices)} dispositivo(s) confirmado(s). Selecione os que quer adicionar.")
            for device in found_devices:
                results_list.insert("end", f"{device['ip']}  ·  sugestão: {device['type']}")

        def add_selected():
            selected_indices = results_list.curselection()
            if not selected_indices:
                add_status.config(text="Selecione ao menos um dispositivo.")
                return
            miners = [found_devices[i] for i in selected_indices]
            add_button.config(state="disabled")
            add_status.config(foreground="#2c7a4b", text="Adicionando...")

            def done(ok: bool, result):
                if ok:
                    self._apply_config_response(result)
                    dialog.destroy()
                    messagebox.showinfo("Escanear rede", f"{len(miners)} máquina(s) adicionada(s).")
                else:
                    add_button.config(state="normal")
                    add_status.config(foreground="#c0392b", text=str(result))

            self._request("POST", "config", {"miners": miners}, done)

        button_row = ttk.Frame(frame)
        button_row.pack(fill="x")
        scan_button = ttk.Button(button_row, text="Escanear", command=run_scan)
        scan_button.pack(side="left")
        add_button = ttk.Button(button_row, text="Adicionar selecionadas", command=add_selected)
        add_button.pack(side="right")
        add_status.pack(anchor="e")

    def _remove_selected(self) -> None:
        selection = self.tree.selection()
        if not selection:
            messagebox.showinfo("Remover máquina", "Selecione uma máquina na lista primeiro.")
            return
        item_id = selection[0]
        ip = self.tree.set(item_id, "ip")
        name = self.tree.item(item_id, "text")
        if not messagebox.askyesno("Remover máquina", f"Remover {name} ({ip}) do monitoramento?"):
            return

        def done(ok: bool, result):
            if ok:
                self._apply_config_response(result)
                messagebox.showinfo("Remover máquina", f"{name} removida.")
            else:
                messagebox.showerror("Remover máquina", str(result))

        self._request("DELETE", "config", {"ip": ip}, done)

    # ---- eventos vindos da thread do coletor ----

    def _drain_events(self) -> None:
        try:
            while True:
                event = self.ui_events.get_nowait()
                self._handle_event(event)
        except queue.Empty:
            pass
        self.after(300, self._drain_events)

    def _handle_event(self, event: dict) -> None:
        kind = event.get("type")
        if kind == "miners_updated":
            self.miners = event["miners"]
            self._update_license_label(event.get("licensed_machines"), event.get("used_machines"))
            self._render_tree()
        elif kind == "metrics":
            self.metrics_by_ip = {m.get("ip"): m for m in event["metrics"]}
            self._render_tree()
        elif kind == "status":
            self.status_label.config(text=event["message"])

    def _render_tree(self) -> None:
        selected_ip = None
        selection = self.tree.selection()
        if selection:
            selected_ip = self.tree.set(selection[0], "ip")
        self.tree.delete(*self.tree.get_children())
        restore_id = None
        for miner in self.miners:
            licensed = miner.get("licensed", True)
            metric = self.metrics_by_ip.get(miner.get("ip"), {})
            online = metric.get("online")
            status_text = "online" if online else ("offline" if metric else "—")
            hashrate = metric.get("hashrate_ths")
            power = metric.get("power_w")
            item_id = self.tree.insert("", "end", text=miner.get("name", miner.get("ip")), values=(
                miner.get("ip"), miner.get("port"), miner.get("type"),
                "OK" if licensed else "🔒 pendente",
                status_text if licensed else "—",
                f"{hashrate:.2f}" if licensed and isinstance(hashrate, (int, float)) else "—",
                f"{power:.0f}" if licensed and isinstance(power, (int, float)) else "—",
            ))
            if miner.get("ip") == selected_ip:
                restore_id = item_id
        if restore_id:
            self.tree.selection_set(restore_id)


def main() -> None:
    app = App()
    app.mainloop()


if __name__ == "__main__":
    main()

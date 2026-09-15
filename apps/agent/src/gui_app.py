"""ASIC Monitor Agent - aplicativo local com interface.

Login proprio (usuario/senha guardados so nesta maquina), lista de maquinas
com escaneamento de rede ou cadastro manual, e um coletor rodando em segundo
plano que sincroniza a lista com a nuvem e envia telemetria a cada ciclo.

Empacotado com PyInstaller (veja README.md) como um .exe unico e sem console.
"""
import asyncio
import concurrent.futures
import hashlib
import json
import os
import queue
import secrets
import socket
import sys
import threading
import tkinter as tk
from datetime import datetime, timezone
from pathlib import Path
from tkinter import messagebox, ttk

import httpx

from miners import apply_pool_config, poll_miner, reboot_miner

AGENT_VERSION = "0.4.0"
STARTUP_DIR = Path(os.environ.get("APPDATA", "")) / "Microsoft" / "Windows" / "Start Menu" / "Programs" / "Startup"
STARTUP_LAUNCHER_NAME = "ASICMonitorAgent.bat"
MINER_TYPES = ["antminer", "whatsminer", "avalon"]


def base_dir() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent


def config_path() -> Path:
    return base_dir() / "config.json"


def auth_path() -> Path:
    return base_dir() / "local_auth.json"


def ensure_startup_entry() -> None:
    try:
        STARTUP_DIR.mkdir(parents=True, exist_ok=True)
        launcher = STARTUP_DIR / STARTUP_LAUNCHER_NAME
        exe_path = Path(sys.executable).resolve() if getattr(sys, "frozen", False) else Path(__file__).resolve()
        launcher.write_text(f'@echo off\r\nstart "" /min "{exe_path}"\r\n', encoding="utf-8")
    except OSError:
        pass


# ------------------------- login local -------------------------

def _hash_password(password: str, salt: bytes) -> str:
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 100_000).hex()


def has_local_account() -> bool:
    return auth_path().exists()


def create_local_account(username: str, password: str) -> None:
    salt = secrets.token_bytes(16)
    data = {"username": username, "salt": salt.hex(), "hash": _hash_password(password, salt)}
    auth_path().write_text(json.dumps(data), encoding="utf-8")


def verify_local_account(username: str, password: str) -> bool:
    try:
        data = json.loads(auth_path().read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return False
    if data.get("username") != username:
        return False
    salt = bytes.fromhex(data.get("salt", ""))
    return _hash_password(password, salt) == data.get("hash")


# ------------------------- configuracao da nuvem -------------------------

def load_config() -> dict | None:
    path = config_path()
    if not path.exists():
        return None
    try:
        config = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    url = str(config.get("api_url", ""))
    if not url.startswith("http://") and not url.startswith("https://"):
        return None
    if not config.get("agent_token"):
        return None
    return config


def save_config(api_url: str, agent_token: str) -> None:
    config_path().write_text(json.dumps({"api_url": api_url.strip(), "agent_token": agent_token.strip()}, indent=2), encoding="utf-8")


def config_url_from_api_url(api_url: str) -> str:
    base = api_url[: -len("/metrics")] if api_url.endswith("/metrics") else api_url.rstrip("/")
    return base + "/config"


def commands_url_from_api_url(api_url: str) -> str:
    base = api_url[: -len("/metrics")] if api_url.endswith("/metrics") else api_url.rstrip("/")
    return base + "/commands"


# ------------------------- escaneamento de rede -------------------------

def _tcp_open(ip: str, port: int, timeout: float = 0.3) -> bool:
    try:
        with socket.create_connection((ip, port), timeout=timeout):
            return True
    except OSError:
        return False


def scan_subnet(prefix: str, progress_callback=None) -> list[dict]:
    """Varre prefix.1 a prefix.254 nas portas 4028 (cgminer) e 80 (Antminer HTTP).
    Roda em threads (I/O bound) - rapido mesmo com 254 hosts."""
    found = []
    hosts = [f"{prefix}.{last}" for last in range(1, 255)]
    total = len(hosts)

    def probe(ip: str):
        has_socket = _tcp_open(ip, 4028)
        has_http = _tcp_open(ip, 80)
        return ip, has_socket, has_http

    with concurrent.futures.ThreadPoolExecutor(max_workers=64) as pool:
        futures = {pool.submit(probe, ip): ip for ip in hosts}
        done = 0
        for future in concurrent.futures.as_completed(futures):
            done += 1
            if progress_callback:
                progress_callback(done, total)
            ip, has_socket, has_http = future.result()
            if has_http:
                found.append({"ip": ip, "port": 4028, "type": "antminer", "name": ip})
            elif has_socket:
                found.append({"ip": ip, "port": 4028, "type": "whatsminer", "name": ip})
    found.sort(key=lambda item: tuple(int(part) for part in item["ip"].split(".")))
    return found


# ------------------------- coletor em segundo plano -------------------------

class Collector:
    """Roda o loop assincrono numa thread separada da UI e publica atualizacoes
    numa Queue thread-safe que a janela principal consome via root.after()."""

    def __init__(self, events: "queue.Queue"):
        self.events = events
        self.config: dict | None = None
        self.miners: list[dict] = []
        self.poll_interval_seconds = 30
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()

    def start(self, config: dict) -> None:
        self.config = config
        self._stop.clear()
        self._thread = threading.Thread(target=self._run_loop, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()

    def request_add_miners(self, miners: list[dict]) -> None:
        self.events.put({"type": "register", "miners": miners})

    def request_remove_miner(self, ip: str) -> None:
        self.events.put({"type": "unregister", "ip": ip})

    def _run_loop(self) -> None:
        asyncio.run(self._async_main())

    async def _async_main(self) -> None:
        config = self.config
        headers = {"Authorization": f"Bearer {config['agent_token']}", "X-Agent-Version": AGENT_VERSION}
        config_url = config_url_from_api_url(config["api_url"])
        commands_url = commands_url_from_api_url(config["api_url"])

        async with httpx.AsyncClient(timeout=15) as client:
            while not self._stop.is_set():
                await self._drain_control_events(client, config_url, headers)
                await self._sync_miners(client, config_url, headers)
                await self._process_command(client, commands_url, headers)
                await self._poll_and_report(client, config["api_url"], headers)
                for _ in range(self.poll_interval_seconds):
                    if self._stop.is_set():
                        break
                    await asyncio.sleep(1)

    async def _drain_control_events(self, client, config_url, headers) -> None:
        while True:
            try:
                event = self.events.get_nowait()
            except queue.Empty:
                return
            if event["type"] == "register":
                try:
                    response = await client.post(config_url, headers=headers, json={"miners": event["miners"]})
                    response.raise_for_status()
                    self.miners = response.json().get("miners", self.miners)
                    self.events.put({"type": "miners_updated", "miners": self.miners})
                except httpx.HTTPError as error:
                    self.events.put({"type": "error", "message": f"Falha ao cadastrar máquina: {error}"})
            elif event["type"] == "unregister":
                try:
                    response = await client.request("DELETE", config_url, headers=headers, json={"ip": event["ip"]})
                    response.raise_for_status()
                    self.miners = [m for m in self.miners if m.get("ip") != event["ip"]]
                    self.events.put({"type": "miners_updated", "miners": self.miners})
                except httpx.HTTPError as error:
                    self.events.put({"type": "error", "message": f"Falha ao remover máquina: {error}"})

    async def _sync_miners(self, client, config_url, headers) -> None:
        try:
            response = await client.get(config_url, headers=headers)
            response.raise_for_status()
            data = response.json()
            remote = data.get("miners")
            if remote is not None:
                self.miners = remote
                self.events.put({"type": "miners_updated", "miners": self.miners})
            interval = data.get("poll_interval_seconds")
            if isinstance(interval, int) and interval >= 10:
                self.poll_interval_seconds = interval
        except httpx.HTTPError as error:
            self.events.put({"type": "error", "message": f"Falha ao sincronizar com a nuvem: {error}"})

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
                results = await asyncio.gather(*(reboot_miner(m) for m in miners))
            else:
                return
            report = await client.post(commands_url, headers=headers, json={"command_id": command["id"], "results": list(results)})
            report.raise_for_status()
        except httpx.HTTPError as error:
            self.events.put({"type": "error", "message": f"Falha ao processar comando: {error}"})

    async def _poll_and_report(self, client, api_url, headers) -> None:
        if not self.miners:
            self.events.put({"type": "metrics", "metrics": []})
            return
        metrics = await asyncio.gather(*(poll_miner(m) for m in self.miners))
        self.events.put({"type": "metrics", "metrics": list(metrics)})
        payload = {"observed_at": datetime.now(timezone.utc).isoformat(), "metrics": list(metrics)}
        try:
            response = await client.post(api_url, headers=headers, json=payload)
            response.raise_for_status()
            self.events.put({"type": "sent", "count": len(metrics)})
        except httpx.HTTPError as error:
            self.events.put({"type": "error", "message": f"Falha ao enviar métricas: {error}"})


# ------------------------- interface -------------------------

class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("ASIC Monitor Agent")
        self.geometry("880x560")
        self.minsize(760, 480)
        self.events: "queue.Queue" = queue.Queue()
        self.collector = Collector(self.events)
        self._build_login()

    # ---- login ----

    def _build_login(self) -> None:
        for widget in self.winfo_children():
            widget.destroy()
        frame = ttk.Frame(self, padding=40)
        frame.place(relx=0.5, rely=0.5, anchor="center")
        creating = not has_local_account()

        ttk.Label(frame, text="ASIC Monitor Agent", font=("Segoe UI", 16, "bold")).grid(row=0, column=0, columnspan=2, pady=(0, 4))
        ttk.Label(frame, text="Crie um acesso local" if creating else "Entrar").grid(row=1, column=0, columnspan=2, pady=(0, 16))

        ttk.Label(frame, text="Usuário").grid(row=2, column=0, sticky="w")
        user_entry = ttk.Entry(frame, width=28)
        user_entry.grid(row=2, column=1, pady=4)

        ttk.Label(frame, text="Senha").grid(row=3, column=0, sticky="w")
        pass_entry = ttk.Entry(frame, width=28, show="•")
        pass_entry.grid(row=3, column=1, pady=4)

        confirm_entry = None
        if creating:
            ttk.Label(frame, text="Confirmar senha").grid(row=4, column=0, sticky="w")
            confirm_entry = ttk.Entry(frame, width=28, show="•")
            confirm_entry.grid(row=4, column=1, pady=4)

        error_label = ttk.Label(frame, text="", foreground="#c0392b")
        error_label.grid(row=5, column=0, columnspan=2, pady=(6, 0))

        def submit(event=None):
            username = user_entry.get().strip()
            password = pass_entry.get()
            if not username or not password:
                error_label.config(text="Preencha usuário e senha.")
                return
            if creating:
                if len(password) < 4:
                    error_label.config(text="Senha muito curta (mínimo 4 caracteres).")
                    return
                if password != confirm_entry.get():
                    error_label.config(text="As senhas não conferem.")
                    return
                create_local_account(username, password)
                self._build_main()
                return
            if verify_local_account(username, password):
                self._build_main()
            else:
                error_label.config(text="Usuário ou senha incorretos.")

        button_row = 6 if creating else 5
        ttk.Button(frame, text="Criar conta" if creating else "Entrar", command=submit).grid(row=button_row, column=0, columnspan=2, pady=(12, 0))
        user_entry.bind("<Return>", submit)
        pass_entry.bind("<Return>", submit)
        if confirm_entry:
            confirm_entry.bind("<Return>", submit)
        user_entry.focus_set()

    # ---- janela principal ----

    def _build_main(self) -> None:
        for widget in self.winfo_children():
            widget.destroy()

        top = ttk.Frame(self, padding=(14, 10))
        top.pack(fill="x")
        self.status_label = ttk.Label(top, text="Configure a nuvem para começar.", font=("Segoe UI", 10))
        self.status_label.pack(side="left")
        ttk.Button(top, text="Configurações da nuvem", command=self._open_cloud_settings).pack(side="right")

        toolbar = ttk.Frame(self, padding=(14, 0))
        toolbar.pack(fill="x")
        ttk.Button(toolbar, text="+ Adicionar manualmente", command=self._open_add_manual).pack(side="left", padx=(0, 8), pady=8)
        ttk.Button(toolbar, text="⌕ Escanear rede", command=self._open_scan).pack(side="left", padx=(0, 8))
        ttk.Button(toolbar, text="Remover selecionada", command=self._remove_selected).pack(side="left")

        columns = ("ip", "port", "type", "status", "hashrate", "power")
        self.tree = ttk.Treeview(self, columns=columns, show="tree headings", height=16)
        self.tree.heading("#0", text="Nome")
        self.tree.heading("ip", text="IP")
        self.tree.heading("port", text="Porta")
        self.tree.heading("type", text="Fabricante")
        self.tree.heading("status", text="Status")
        self.tree.heading("hashrate", text="TH/s")
        self.tree.heading("power", text="Consumo (W)")
        for col, width in (("#0", 160), ("ip", 130), ("port", 70), ("type", 100), ("status", 90), ("hashrate", 90), ("power", 110)):
            self.tree.column(col, width=width, anchor="w" if col in ("#0", "ip", "type", "status") else "center")
        self.tree.pack(fill="both", expand=True, padx=14, pady=(0, 14))

        self.miners: list[dict] = []
        self.metrics_by_ip: dict[str, dict] = {}

        config = load_config()
        if config:
            self.status_label.config(text=f"Conectado a {config['api_url']}")
            self.collector.start(config)
        ensure_startup_entry()
        self.after(400, self._drain_events)

    def _open_cloud_settings(self) -> None:
        config = load_config() or {}
        dialog = tk.Toplevel(self)
        dialog.title("Configurações da nuvem")
        dialog.geometry("460x200")
        dialog.transient(self)
        frame = ttk.Frame(dialog, padding=20)
        frame.pack(fill="both", expand=True)

        ttk.Label(frame, text="URL da API (ex: https://seu-dominio.vercel.app/api/agent/metrics)").pack(anchor="w")
        url_entry = ttk.Entry(frame, width=54)
        url_entry.insert(0, config.get("api_url", ""))
        url_entry.pack(fill="x", pady=(2, 12))

        ttk.Label(frame, text="Token do agente (gerado no painel, em Fazendas)").pack(anchor="w")
        token_entry = ttk.Entry(frame, width=54)
        token_entry.insert(0, config.get("agent_token", ""))
        token_entry.pack(fill="x", pady=(2, 12))

        def save():
            url = url_entry.get().strip()
            token = token_entry.get().strip()
            if not url.startswith("http://") and not url.startswith("https://"):
                messagebox.showerror("Configurações da nuvem", "A URL precisa começar com http:// ou https://.")
                return
            if not token:
                messagebox.showerror("Configurações da nuvem", "Informe o token do agente.")
                return
            save_config(url, token)
            self.collector.stop()
            self.collector = Collector(self.events)
            self.collector.start({"api_url": url, "agent_token": token})
            self.status_label.config(text=f"Conectado a {url}")
            dialog.destroy()

        ttk.Button(frame, text="Salvar", command=save).pack(anchor="e")

    def _open_add_manual(self) -> None:
        dialog = tk.Toplevel(self)
        dialog.title("Adicionar máquina")
        dialog.geometry("360x260")
        dialog.transient(self)
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

        def confirm():
            if not load_config():
                messagebox.showwarning("Adicionar máquina", "Configure a nuvem (URL e token) antes de adicionar máquinas.")
                return
            ip = ip_entry.get().strip()
            if not ip:
                messagebox.showerror("Adicionar máquina", "Informe o IP.")
                return
            miner = {"name": name_entry.get().strip() or ip, "ip": ip, "port": int(port_entry.get() or 4028), "type": type_var.get()}
            self.collector.request_add_miners([miner])
            dialog.destroy()

        ttk.Button(frame, text="Adicionar", command=confirm).pack(anchor="e")

    def _open_scan(self) -> None:
        dialog = tk.Toplevel(self)
        dialog.title("Escanear rede")
        dialog.geometry("520x440")
        dialog.transient(self)
        frame = ttk.Frame(dialog, padding=16)
        frame.pack(fill="both", expand=True)

        ttk.Label(frame, text="Prefixo da rede (ex: 192.168.0)").pack(anchor="w")
        default_prefix = self._guess_local_prefix()
        prefix_entry = ttk.Entry(frame, width=24)
        prefix_entry.insert(0, default_prefix)
        prefix_entry.pack(anchor="w", pady=(2, 10))

        progress = ttk.Progressbar(frame, mode="determinate", maximum=254)
        progress.pack(fill="x", pady=(0, 10))
        status = ttk.Label(frame, text="Pronto para escanear.")
        status.pack(anchor="w")

        results_frame = ttk.Frame(frame)
        results_frame.pack(fill="both", expand=True, pady=(10, 10))
        results_list = tk.Listbox(results_frame, selectmode="multiple")
        results_list.pack(fill="both", expand=True)
        found_devices: list[dict] = []

        def on_progress(done, total):
            self.after(0, lambda: (progress.configure(value=done), status.configure(text=f"Escaneando... {done}/{total}")))

        def run_scan():
            prefix = prefix_entry.get().strip()
            if prefix.count(".") != 2:
                messagebox.showerror("Escanear rede", "Use o formato 192.168.0 (sem o último número).")
                return
            scan_button.config(state="disabled")
            results_list.delete(0, "end")
            found_devices.clear()

            def worker():
                devices = scan_subnet(prefix, progress_callback=on_progress)
                found_devices.extend(devices)
                self.after(0, populate_results)

            threading.Thread(target=worker, daemon=True).start()

        def populate_results():
            scan_button.config(state="normal")
            status.config(text=f"{len(found_devices)} dispositivo(s) encontrado(s). Selecione os que quer adicionar.")
            for device in found_devices:
                results_list.insert("end", f"{device['ip']}  ·  sugestão: {device['type']}")

        def add_selected():
            if not load_config():
                messagebox.showwarning("Escanear rede", "Configure a nuvem (URL e token) antes de adicionar máquinas.")
                return
            selected_indices = results_list.curselection()
            if not selected_indices:
                messagebox.showinfo("Escanear rede", "Selecione ao menos um dispositivo.")
                return
            miners = [found_devices[i] for i in selected_indices]
            self.collector.request_add_miners(miners)
            dialog.destroy()

        button_row = ttk.Frame(frame)
        button_row.pack(fill="x")
        scan_button = ttk.Button(button_row, text="Escanear", command=run_scan)
        scan_button.pack(side="left")
        ttk.Button(button_row, text="Adicionar selecionadas", command=add_selected).pack(side="right")

    @staticmethod
    def _guess_local_prefix() -> str:
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
                s.connect(("8.8.8.8", 80))
                local_ip = s.getsockname()[0]
            return ".".join(local_ip.split(".")[:3])
        except OSError:
            return "192.168.0"

    def _remove_selected(self) -> None:
        selection = self.tree.selection()
        if not selection:
            return
        for item_id in selection:
            ip = self.tree.set(item_id, "ip")
            if messagebox.askyesno("Remover máquina", f"Remover {ip} do monitoramento?"):
                self.collector.request_remove_miner(ip)

    # ---- eventos vindos da thread do coletor ----

    def _drain_events(self) -> None:
        try:
            while True:
                event = self.events.get_nowait()
                self._handle_event(event)
        except queue.Empty:
            pass
        self.after(400, self._drain_events)

    def _handle_event(self, event: dict) -> None:
        kind = event.get("type")
        if kind == "miners_updated":
            self.miners = event["miners"]
            self._render_tree()
        elif kind == "metrics":
            self.metrics_by_ip = {m.get("ip"): m for m in event["metrics"]}
            self._render_tree()
        elif kind == "sent":
            self.status_label.config(text=f"Última atualização: {datetime.now().strftime('%H:%M:%S')} · {event['count']} máquina(s)")
        elif kind == "error":
            self.status_label.config(text=event["message"])

    def _render_tree(self) -> None:
        self.tree.delete(*self.tree.get_children())
        for miner in self.miners:
            metric = self.metrics_by_ip.get(miner.get("ip"), {})
            online = metric.get("online")
            status_text = "online" if online else ("offline" if metric else "—")
            hashrate = metric.get("hashrate_ths")
            power = metric.get("power_w")
            self.tree.insert("", "end", text=miner.get("name", miner.get("ip")), values=(
                miner.get("ip"), miner.get("port"), miner.get("type"), status_text,
                f"{hashrate:.2f}" if isinstance(hashrate, (int, float)) else "—",
                f"{power:.0f}" if isinstance(power, (int, float)) else "—",
            ))


def main() -> None:
    app = App()
    app.mainloop()


if __name__ == "__main__":
    main()

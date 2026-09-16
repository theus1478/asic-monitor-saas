import importlib

import pytest


@pytest.fixture()
def gui_app(tmp_path, monkeypatch):
    module = importlib.import_module("gui_app")
    monkeypatch.setattr(module, "base_dir", lambda: tmp_path)
    return module


def test_last_login_round_trip(gui_app):
    assert gui_app.load_last_login() == {}
    gui_app.save_last_login("https://example.com/api/agent/metrics", "tok123")
    assert gui_app.load_last_login() == {"api_url": "https://example.com/api/agent/metrics", "agent_token": "tok123"}


def test_config_url_helpers(gui_app):
    assert gui_app.config_url_from_api_url("https://example.com/api/agent/metrics") == "https://example.com/api/agent/config"
    assert gui_app.commands_url_from_api_url("https://example.com/api/agent/metrics") == "https://example.com/api/agent/commands"


def test_hosts_in_range_ascending(gui_app):
    assert gui_app.hosts_in_range("192.168.0.1", "192.168.0.3") == ["192.168.0.1", "192.168.0.2", "192.168.0.3"]


def test_hosts_in_range_swaps_reversed_order(gui_app):
    assert gui_app.hosts_in_range("192.168.0.5", "192.168.0.3") == ["192.168.0.3", "192.168.0.4", "192.168.0.5"]


def test_hosts_in_range_single_host(gui_app):
    assert gui_app.hosts_in_range("10.0.0.9", "10.0.0.9") == ["10.0.0.9"]


def test_hosts_in_range_rejects_huge_span(gui_app):
    with pytest.raises(ValueError):
        gui_app.hosts_in_range("10.0.0.0", "10.10.0.0")


def test_validate_login_rejects_bad_url(gui_app):
    with pytest.raises(RuntimeError, match="http"):
        gui_app.validate_login("not-a-url", "token")


def test_validate_login_rejects_empty_token(gui_app):
    with pytest.raises(RuntimeError, match="token"):
        gui_app.validate_login("https://example.com/api/agent/metrics", "")


def test_classify_cgminer_device_detects_avalon_by_mm_id(gui_app, monkeypatch):
    def fake_command(ip, command, timeout=1.2):
        if command == "estats":
            return {"STATS": [{"MM ID0": "AUC01"}]}
        return {"SUMMARY": [{}]}

    monkeypatch.setattr(gui_app, "_cgminer_command", fake_command)
    assert gui_app._classify_cgminer_device("192.168.0.10") == "avalon"


def test_classify_cgminer_device_detects_whatsminer_by_miner_type(gui_app, monkeypatch):
    def fake_command(ip, command, timeout=1.2):
        if command == "estats":
            return None
        return {"SUMMARY": [{"Miner Type": "M30S++VE30"}]}

    monkeypatch.setattr(gui_app, "_cgminer_command", fake_command)
    assert gui_app._classify_cgminer_device("192.168.0.11") == "whatsminer"


def test_classify_cgminer_device_falls_back_to_antminer_stock_firmware(gui_app, monkeypatch):
    """Nem 'MM ID' (Avalon) nem 'Miner Type' (Whatsminer) -> Antminer com
    firmware original (placas AML, Xil e BB), que fala o mesmo socket."""
    monkeypatch.setattr(gui_app, "_cgminer_command", lambda ip, command, timeout=1.2: None)
    assert gui_app._classify_cgminer_device("192.168.0.12") == "antminer"

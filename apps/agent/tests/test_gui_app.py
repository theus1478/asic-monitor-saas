import importlib

import pytest


@pytest.fixture()
def gui_app(tmp_path, monkeypatch):
    module = importlib.import_module("gui_app")
    monkeypatch.setattr(module, "base_dir", lambda: tmp_path)
    return module


def test_local_account_round_trip(gui_app):
    assert not gui_app.has_local_account()
    gui_app.create_local_account("admin", "senha-forte")
    assert gui_app.has_local_account()
    assert gui_app.verify_local_account("admin", "senha-forte")
    assert not gui_app.verify_local_account("admin", "senha-errada")
    assert not gui_app.verify_local_account("outro", "senha-forte")


def test_config_round_trip(gui_app):
    assert gui_app.load_config() is None
    gui_app.save_config("https://example.com/api/agent/metrics", "tok123")
    config = gui_app.load_config()
    assert config == {"api_url": "https://example.com/api/agent/metrics", "agent_token": "tok123"}


def test_config_url_helpers(gui_app):
    assert gui_app.config_url_from_api_url("https://example.com/api/agent/metrics") == "https://example.com/api/agent/config"
    assert gui_app.commands_url_from_api_url("https://example.com/api/agent/metrics") == "https://example.com/api/agent/commands"

import base64
import hashlib
import unittest
from unittest.mock import AsyncMock, patch

import miners
import service


class PoolControlTests(unittest.IsolatedAsyncioTestCase):
    def test_commands_url_matches_metrics_url(self):
        self.assertEqual(
            service.commands_url_from_api_url("https://example.com/api/agent/metrics"),
            "https://example.com/api/agent/commands",
        )

    def test_whatsminer_v3_matches_official_aes_vector(self):
        digest = hashlib.sha256(b"set.miner.poolsabcdefgQbVy1Ou32118015").digest()
        plaintext = b'[{"pool":"stratum+tcp://192.168.2.3:3834","worker":"work1","passwd":"123"}]'
        encrypted = base64.b64encode(miners._aes_ecb_encrypt(plaintext, digest, zero_padding=True)).decode()
        expected = "ieq1bCRfvw7f/Xbiy5lRsa38H5IKuOlgkkhRk5ZoZXyDxG2u//kYjZ+Nt8WxH/oOkwt0ZvVNiUFIxWFYuYXXTNg2ZZ8h7SCq8BggIMkM8zn="
        self.assertEqual(base64.b64decode(encrypted), base64.b64decode(expected))

    async def test_dispatches_antminer_with_supplied_credentials(self):
        pools = [{"url": "stratum+tcp://pool.test:3333", "worker": "wallet.rig", "password": "x"}]
        credentials = {"username": "admin", "password": "admin"}
        with patch.object(miners, "_set_antminer_pools", new=AsyncMock(return_value="ok")) as apply:
            result = await miners.apply_pool_config({"id": "1", "name": "S19", "ip": "192.168.1.10", "type": "antminer"}, credentials, pools)
        self.assertTrue(result["success"])
        apply.assert_awaited_once_with("192.168.1.10", credentials, pools)

    async def test_returns_per_miner_failure_without_credentials(self):
        result = await miners.apply_pool_config({"id": "1", "name": "S19", "ip": "192.168.1.10", "type": "antminer"}, None, [])
        self.assertFalse(result["success"])
        self.assertIn("Credenciais", result["message"])

    async def test_reboot_antminer_without_password_uses_open_endpoint(self):
        with patch.object(miners, "_http_post_status_sync", return_value=(200, b"")) as post:
            result = await miners.reboot_miner({"id": "1", "name": "S19", "ip": "192.168.1.10", "type": "antminer"})
        self.assertTrue(result["success"])
        post.assert_called_once_with("http://192.168.1.10/api/v1/system/reboot")

    async def test_reboot_antminer_with_password_authenticates_first(self):
        unlock_response = AsyncMock()
        unlock_response.status_code = 200
        unlock_response.json = lambda: {"token": "tok-abc"}
        reboot_response = AsyncMock()
        reboot_response.status_code = 200

        fake_client = AsyncMock()
        fake_client.post = AsyncMock(side_effect=[unlock_response, reboot_response])
        fake_client.__aenter__ = AsyncMock(return_value=fake_client)
        fake_client.__aexit__ = AsyncMock(return_value=False)

        with patch("miners.httpx.AsyncClient", return_value=fake_client):
            result = await miners.reboot_miner({"id": "1", "name": "S19", "ip": "192.168.1.10", "type": "antminer"}, {"username": "admin", "password": "real-pass"})

        self.assertTrue(result["success"])
        self.assertIn("VNish autenticado", result["message"])
        fake_client.post.assert_any_call("http://192.168.1.10/api/v1/unlock", json={"pw": "real-pass"})
        fake_client.post.assert_any_call("http://192.168.1.10/api/v1/system/reboot", headers={"Authorization": "Bearer tok-abc"})

    async def test_reboot_whatsminer_sends_plain_cgminer_command(self):
        response = {"STATUS": [{"STATUS": "S", "Msg": "restart flag set"}]}
        with patch.object(miners, "api_call", new=AsyncMock(return_value=response)) as call:
            result = await miners.reboot_miner({"id": "1", "name": "M30", "ip": "192.168.1.11", "port": 4028, "type": "whatsminer"})
        self.assertTrue(result["success"])
        self.assertIn("restart flag set", result["message"])
        call.assert_awaited_once_with("192.168.1.11", 4028, "reboot")

    async def test_reboot_whatsminer_treats_dropped_connection_as_likely_success(self):
        with patch.object(miners, "api_call", new=AsyncMock(side_effect=ConnectionResetError("reset"))):
            result = await miners.reboot_miner({"id": "1", "name": "M30", "ip": "192.168.1.11", "type": "whatsminer"})
        self.assertTrue(result["success"])
        self.assertIn("provável", result["message"])

    async def test_reboot_whatsminer_reports_device_rejection(self):
        response = {"STATUS": [{"STATUS": "E", "Msg": "unknown command"}]}
        with patch.object(miners, "api_call", new=AsyncMock(return_value=response)):
            result = await miners.reboot_miner({"id": "1", "name": "M30", "ip": "192.168.1.11", "type": "whatsminer"})
        self.assertFalse(result["success"])
        self.assertIn("unknown command", result["message"])


if __name__ == "__main__":
    unittest.main()

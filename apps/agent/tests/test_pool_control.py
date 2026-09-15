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

    async def test_reboot_antminer_uses_open_reboot_endpoint(self):
        with patch.object(miners, "_http_post_status_sync", return_value=(200, b"")) as post:
            result = await miners.reboot_miner({"id": "1", "name": "S19", "ip": "192.168.1.10", "type": "antminer"})
        self.assertTrue(result["success"])
        post.assert_called_once_with("http://192.168.1.10/api/v1/reboot")

    async def test_reboot_whatsminer_reports_unsupported(self):
        result = await miners.reboot_miner({"id": "1", "name": "M30", "ip": "192.168.1.11", "type": "whatsminer"})
        self.assertFalse(result["success"])
        self.assertIn("não suportado", result["message"])


if __name__ == "__main__":
    unittest.main()

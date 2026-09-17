import unittest

import miners


class ParserBoardsAndCoolingTests(unittest.TestCase):
    def test_antminer_vnish_reports_per_board_temp_and_declared_cooling_mode(self):
        summary = {
            "miner": {
                "miner_type": "Antminer S19j Pro",
                "instant_hashrate": 103.5,
                "average_hashrate": 103.0,
                "chip_temp": {"max": 68},
                "chains": [
                    {"id": 0, "chip_temp": {"max": 65}, "pcb_temp": {"max": 55}, "hashrate_rt": 34.5},
                    {"id": 1, "chip_temp": {"max": 68}, "pcb_temp": {"max": 57}, "hashrate_rt": 34.5},
                    {"id": 2, "chip_temp": {"max": 63}, "pcb_temp": {"max": 54}, "hashrate_rt": 34.5},
                ],
                "cooling": {"fans": [{"rpm": 0}, {"rpm": 0}], "settings": {"mode": {"name": "Immersion"}}},
                "miner_status": {"miner_state_time": 3600},
                "power_consumption": 3050,
                "pools": [],
            }
        }
        rec = miners.parse_antminer_vnish("J PRO", "192.168.0.1", 4028, summary)
        self.assertEqual(len(rec["boards"]), 3)
        self.assertEqual([b["chip_temp_c"] for b in rec["boards"]], [65, 68, 63])
        self.assertEqual(rec["temp_c"], 68)
        self.assertEqual(rec["cooling_mode"], "immersion")
        self.assertFalse(rec["cooling_inferred"])

    def test_antminer_never_reports_voltage_or_current(self):
        """Bitmain nao expoe tensao/corrente na API - nunca deve aparecer um
        valor sintetico (230V nominal) como se fosse leitura real."""
        summary = {"miner": {"miner_type": "Antminer S19j Pro", "power_consumption": 3050, "chains": [], "pools": []}}
        rec = miners.parse_antminer_vnish("J PRO", "192.168.0.1", 4028, summary)
        self.assertIsNone(rec["voltage_v"])
        self.assertIsNone(rec["current_a"])
        self.assertIsNone(rec["volt_source"])

    def test_whatsminer_infers_air_cooling_from_spinning_fans(self):
        summary = {"SUMMARY": [{
            "MHS av": 10000, "Elapsed": 3600, "Accepted": 100, "Rejected": 1,
            "Chip Temp Max": 75, "Fan Speed In": 3200, "Fan Speed Out": 3400, "Power": 3400,
        }]}
        devs = {"DEVS": [
            {"Slot": 0, "Chip Temp Max": 74, "Temperature": 55, "MHS av": 3300},
            {"Slot": 1, "Chip Temp Max": 75, "Temperature": 56, "MHS av": 3300},
        ]}
        rec = miners.parse_whatsminer("M30S++", "192.168.0.2", 4028, summary, {}, devs)
        self.assertEqual(len(rec["boards"]), 2)
        self.assertEqual(rec["boards"][1]["chip_temp_c"], 75)
        self.assertEqual(rec["cooling_mode"], "air")
        self.assertTrue(rec["cooling_inferred"])

    def test_whatsminer_infers_immersion_when_fans_are_stopped(self):
        summary = {"SUMMARY": [{"MHS av": 10000, "Fan Speed In": 0, "Fan Speed Out": 0}]}
        rec = miners.parse_whatsminer("M30S++", "192.168.0.2", 4028, summary, {}, {})
        self.assertEqual(rec["cooling_mode"], "immersion")

    def test_whatsminer_stock_firmware_falls_back_to_generic_temp_fan_and_power_estimate(self):
        """Firmware original (BTMiner) sem os campos custom do BixBit (PSU
        Vin0/Iin0, Power, Chip Temp Max, Fan Speed In/Out) - o parser ainda
        precisa achar temperatura/fan por padrao generico e estimar consumo
        pela eficiencia do modelo, igual ja faz pro Antminer sem VNish."""
        summary = {"SUMMARY": [{"MHS av": 68000, "Elapsed": 3600, "Accepted": 200, "Rejected": 1}]}
        devs = {"DEVS": [{"Slot": 0, "temp1": 32, "temp2_1": 78, "fan1": 3600, "fan2": 3500}]}
        version = {"VERSION": [{"Type": "M30S++"}]}
        rec = miners.parse_whatsminer("M30S++", "192.168.0.3", 4028, summary, {}, devs, version)
        self.assertEqual(rec["boards"][0]["chip_temp_c"], 78)
        self.assertEqual(rec["temp_c"], 78)
        self.assertTrue(rec["power_estimated"])
        self.assertIsNotNone(rec["power_w"])

    def test_whatsminer_falls_back_to_version_command_for_model(self):
        summary = {"SUMMARY": [{"MHS av": 10000}]}
        version = {"VERSION": [{"Type": "M30S++VE30"}]}
        rec = miners.parse_whatsminer("M30S++", "192.168.0.4", 4028, summary, {}, {}, version)
        self.assertEqual(rec["model"], "M30S++VE30")

    def test_whatsminer_stock_firmware_uses_documented_edevs_get_version_get_psu_commands(self):
        """Firmware original (BTMiner) que so responde 'summary' com hashrate
        (sem PSU/temp/modelo do BixBit, sem 'devs' nem 'version' classicos) -
        o parser precisa completar via 'edevs'/'get_version'/'get_psu', os
        comandos documentados no manual oficial da API BTMiner (mesma porta
        4028, nomes diferentes)."""
        summary = {"SUMMARY": [{"MHS av": 84983730.62, "Elapsed": 2648, "Accepted": 500, "Rejected": 1}]}
        edevs = {"DEVS": [
            {"Slot": 0, "Temperature": 80.0, "MHS av": 10342284.80},
            {"Slot": 1, "Temperature": 81.5, "MHS av": 10259948.84},
        ]}
        get_version = {"Msg": {"api_ver": "2.0.3", "fw_ver": "20220125.13.Rel", "miner_type": "M30S+VE40"}}
        psu = {"Msg": {"iin": "8718", "vin": "22400", "pin": "3000"}}
        rec = miners.parse_whatsminer("M30S+", "192.168.1.144", 4028, summary, {}, None, None, edevs, get_version, psu)
        self.assertEqual(rec["model"], "M30S+VE40")
        self.assertEqual(len(rec["boards"]), 2)
        self.assertEqual(rec["boards"][1]["chip_temp_c"], 81.5)
        self.assertEqual(rec["temp_c"], 81.5)
        self.assertEqual(rec["power_w"], 3000.0)
        self.assertFalse(rec["power_estimated"])
        self.assertEqual(rec["voltage_v"], 224.0)
        self.assertEqual(rec["current_a"], 8.72)

    def test_antminer_stock_parses_generic_bmminer_temp_and_fan_fields(self):
        """Firmware original (sem VNish - placas AML, Xil e BB) fala o socket
        cgminer padrao com nomes de campo do Bitmain, diferentes do Whatsminer."""
        summary = {"SUMMARY": [{"GHS av": 103500, "GHS 5s": 104000, "Elapsed": 3600, "Accepted": 500, "Rejected": 3}]}
        stats = {"STATS": [{"STATS": 0}, {
            "STATS": 1, "Type": "Antminer S19 Pro",
            "temp1": 32, "temp2": 34, "temp3": 33,
            "temp2_1": 68, "temp2_2": 70, "temp2_3": 66,
            "fan1": 3200, "fan2": 3300,
        }]}
        rec = miners.parse_antminer_stock("S19 PRO", "192.168.0.4", 4028, summary, stats, {})
        self.assertEqual(rec["type"], "antminer")
        self.assertEqual(rec["model"], "Antminer S19 Pro")
        self.assertAlmostEqual(rec["hashrate_ths"], 104.0)
        self.assertEqual(rec["temp_c"], 70)
        self.assertEqual(sorted(rec["fans_rpm"]), [3200, 3300])
        self.assertIsNone(rec["voltage_v"])
        self.assertTrue(rec["power_estimated"])

    def test_antminer_stock_without_stats_has_no_temp_or_fans(self):
        summary = {"SUMMARY": [{"GHS av": 50000, "Elapsed": 100}]}
        rec = miners.parse_antminer_stock("S19", "192.168.0.5", 4028, summary, {}, {})
        self.assertIsNone(rec["temp_c"])
        self.assertEqual(rec["fans_rpm"], [])
        self.assertIsNone(rec["model"])

    def test_whatsminer_luci_parses_summary_devices_temp_and_pool_from_real_panel_layout(self):
        """Layout obtido de uma captura real do painel LuCI (firmware original
        sem API no socket 4028) - ver miners.py e README.md."""
        html = """
        <fieldset class="cbi-section"><legend>Summary</legend>
          <input id="cbid.table.1.elapsed" value="2m 36s" />
          <input id="cbid.table.1.thsav" value="109.000" />
          <input id="cbid.table.1.accepted" value="17" />
          <input id="cbid.table.1.rejected" value="0" />
          <input id="cbid.table.1.liquid_cool" value="true" />
          <input id="cbid.table.1.power" value="3,504" />
        </fieldset>
        <fieldset class="cbi-section"><legend>Devices</legend>
          <input id="cbid.table.1.name" value="SM0" />
          <input id="cbid.table.1.thsav" value="37.880" />
          <input id="cbid.table.2.name" value="SM1" />
          <input id="cbid.table.2.thsav" value="34.970" />
          <input id="cbid.table.3.name" value="Total" />
          <input id="cbid.table.3.thsav" value="109.020" />
        </fieldset>
        <fieldset class="cbi-section">
          <input id="cbid.table.1.name" value="SM0" />
          <input id="cbid.table.1.temp" value="59.44" />
          <input id="cbid.table.2.name" value="SM1" />
          <input id="cbid.table.2.temp" value="58.94" />
        </fieldset>
        <fieldset class="cbi-section"><legend>Pools</legend>
          <input id="cbid.table.1.url" value="stratum+tcp://pool.example.com:9200" />
          <input id="cbid.table.1.user" value="worker.1" />
          <input id="cbid.table.1.status" value="Alive" />
          <input id="cbid.table.1.stratumactive" value="true" />
        </fieldset>
        """
        rec = miners.parse_whatsminer_luci("WhatsMiner_4467", "192.168.1.144", 4028, html)
        self.assertEqual(rec["type"], "whatsminer")
        self.assertAlmostEqual(rec["hashrate_avg_ths"], 109.0)
        self.assertEqual(rec["uptime_s"], 156)
        self.assertEqual(rec["accepted"], 17)
        self.assertEqual(rec["power_w"], 3504.0)
        self.assertFalse(rec["power_estimated"])
        self.assertEqual(rec["cooling_mode"], "immersion")
        self.assertEqual(len(rec["boards"]), 2)
        self.assertEqual(rec["boards"][0]["chip_temp_c"], 59.44)
        self.assertEqual(rec["temp_c"], 59.4)
        self.assertEqual(rec["pool"], "stratum+tcp://pool.example.com:9200")
        self.assertEqual(rec["worker"], "worker.1")

    def test_avalon_parses_per_board_temp_from_mm_string_and_infers_cooling(self):
        mm = "MM ID0[AUC01]Ver[1246-N-90-...]MTavg[62 64 61]MTmax[70 72 69]MGHS[38000 39000 37500]PS[0 0000 1200 0000 0000]Fan1[3200]Fan2[3300]"
        stats = {"STATS": [{"MM ID0": mm}]}
        rec = miners.parse_avalon("A1246", "192.168.0.3", 4028, {}, stats, {})
        self.assertEqual(len(rec["boards"]), 3)
        self.assertEqual([b["chip_temp_c"] for b in rec["boards"]], [62, 64, 61])
        self.assertEqual(rec["cooling_mode"], "air")
        self.assertTrue(rec["cooling_inferred"])


if __name__ == "__main__":
    unittest.main()

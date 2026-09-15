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
        self.assertTrue(rec["cooling_inferred"])

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

import importlib.util
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "ble-provision-wifi-audio.py"
SPEC = importlib.util.spec_from_file_location("ble_provision_wifi_audio", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


class BleProvisionWifiAudioTests(unittest.TestCase):
    def test_accepts_xiaozhi_bootstrap_and_legacy_dock_schemes(self):
        for endpoint in (
            "http://192.168.0.11:8766/xiaozhi/ota",
            "https://dock.example/xiaozhi/ota",
            "ws://192.168.0.11:8765/xiaozhi/v1",
            "wss://dock.example/xiaozhi/v1",
        ):
            self.assertEqual(MODULE.validate_endpoint(endpoint), endpoint)

    def test_rejects_non_network_endpoint(self):
        with self.assertRaisesRegex(ValueError, "XiaoZhi bootstrap"):
            MODULE.validate_endpoint("file:///tmp/config")

    def test_requires_exact_device_configuration_notification(self):
        notifications = [
            '{"cmd":"notifyState","data":{"type":5,"state":"wifiAudioConfigured"}}',
        ]
        self.assertTrue(MODULE.notification_has_state(notifications, "wifiAudioConfigured"))
        self.assertFalse(MODULE.notification_has_state(notifications, "xiaozhiLocalConfigured"))
        self.assertFalse(MODULE.notification_has_state(["<non-text notification>"], "wifiAudioConfigured"))


if __name__ == "__main__":
    unittest.main()

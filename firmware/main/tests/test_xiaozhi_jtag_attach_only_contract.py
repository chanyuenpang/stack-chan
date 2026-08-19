import re
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
SCRIPT_PATH = REPO_ROOT / "ops" / "bin" / "probe-xiaozhi-dock-jtag-attach-only.ps1"
SCRIPT = SCRIPT_PATH.read_text(encoding="utf-8")


class XiaozhiJtagAttachOnlyContractTests(unittest.TestCase):
    def test_default_dry_run_returns_before_the_only_openocd_call(self):
        self.assertRegex(SCRIPT, r"\[string\]\$Stage\s*=\s*'DryRun'")
        dry_run = SCRIPT.index("if ($Stage -eq 'DryRun')")
        invocation = SCRIPT.index("$attachOutput = Invoke-TapOnlyOpenOcd")
        self.assertLess(dry_run, invocation)
        self.assertIn("OpenOCD was not started", SCRIPT[dry_run:invocation])
        calls = list(
            re.finditer(
                r"(?m)^\s*(?:\$\w+\s*=\s*)?Invoke-TapOnlyOpenOcd\b", SCRIPT
            )
        )
        self.assertEqual(len(calls), 1)
        self.assertGreater(calls[0].start(), dry_run)

    def test_attach_loads_only_the_usb_jtag_interface_and_no_target_config(self):
        for marker in (
            "interface\\esp_usb_jtag.cfg",
            "adapter serial {$ExpectedAdapterSerial}",
            "adapter speed 1000",
            "gdb port disabled",
            "tcl port disabled",
            "telnet port disabled",
            "reset_config none",
        ):
            self.assertIn(marker, SCRIPT)
        for forbidden in (
            "board/esp32s3-builtin.cfg",
            "target/esp32s3.cfg",
            "program_esp",
            "program_esp_bins",
            "esptool",
            "COM7",
        ):
            self.assertNotIn(forbidden, SCRIPT)

    def test_tap_plan_is_exact_and_fails_closed_without_hard_reset_fallback(self):
        plan = SCRIPT.split("$attachCommands = @(", 1)[1].split("\n)", 1)[0]
        expected_plan = [
            "'noinit'",
            "'gdb port disabled'",
            "'tcl port disabled'",
            "'telnet port disabled'",
            '"adapter serial {$ExpectedAdapterSerial}"',
            "'adapter speed 1000'",
            "'reset_config none'",
            "'proc init_reset {mode} { error \"STACKCHAN_TARGET_RESET_FORBIDDEN\" }'",
            "'proc jtag_init {} { jtag arp_init }'",
            '"jtag newtap esp32s3 tap0 -irlen 5 -expected-id $expectedTapId"',
            '"jtag newtap esp32s3 tap1 -irlen 5 -expected-id $expectedTapId"',
            "'init'",
            "'scan_chain'",
            "'echo STACKCHAN_TAP_ONLY_COMPLETE'",
            "'shutdown'",
        ]
        actual_plan = [
            line.strip().removesuffix(",")
            for line in plan.splitlines()
            if line.strip()
        ]
        self.assertEqual(actual_plan, expected_plan)
        for forbidden in (
            "'reset halt'",
            "'reset run'",
            "'reset init'",
            "'halt'",
            "'resume'",
            "flash probe",
            "flash read_bank",
            "read_memory",
            "esp_get_mac",
            "target create",
            "targets",
            "mww",
            "mdw",
        ):
            self.assertNotIn(forbidden, plan)
        self.assertNotIn("arp_init-reset", SCRIPT)

    def test_unavoidable_tap_reset_is_explicit_and_requires_confirmation(self):
        self.assertIn("Test-Logic-Reset", SCRIPT)
        self.assertIn("[switch]$ConfirmUsbJtagContact", SCRIPT)
        self.assertIn("[switch]$ConfirmJtagTapStateMachineReset", SCRIPT)
        contact_confirmation = SCRIPT.index("if (-not $ConfirmUsbJtagContact)")
        reset_confirmation = SCRIPT.index("if (-not $ConfirmJtagTapStateMachineReset)")
        evidence_creation = SCRIPT.index("[void](New-Item -ItemType Directory")
        invocation = SCRIPT.index("$attachOutput = Invoke-TapOnlyOpenOcd")
        dry_run = SCRIPT.index("if ($Stage -eq 'DryRun')")
        self.assertLess(dry_run, contact_confirmation)
        self.assertLess(contact_confirmation, reset_confirmation)
        self.assertLess(reset_confirmation, evidence_creation)
        self.assertLess(evidence_creation, invocation)
        self.assertEqual(SCRIPT.count("[void](New-Item -ItemType Directory"), 1)
        self.assertIn("cannot fall back to init_reset", SCRIPT)
        self.assertIn("SRST-deassert (`srst0`)", SCRIPT)
        self.assertIn("never requests SRST assertion", SCRIPT)

    def test_capability_matrix_does_not_overclaim_cpu_or_live_device_state(self):
        for fact in (
            "CPU examination/liveness",
            "MAC",
            "Flash ID/live layout",
            "Running OTA slot",
            "eFuse security state",
            "Application remained healthy",
        ):
            row = next(line for line in SCRIPT.splitlines() if f"Fact = '{fact}'" in line)
            self.assertIn("Contact = 'no'", row)
        self.assertIn("No CPU target is created", SCRIPT)
        self.assertIn("Needs application running-partition API", SCRIPT)
        self.assertIn("otadata read would show configured boot selection", SCRIPT)
        self.assertIn("not necessarily", SCRIPT)

    def test_timeout_cleanup_is_exact_process_only_and_never_target_recovery(self):
        self.assertIn("[System.Diagnostics.ProcessStartInfo]::new()", SCRIPT)
        self.assertIn("$process.WaitForExit($CommandTimeoutSeconds * 1000)", SCRIPT)
        self.assertGreaterEqual(SCRIPT.count("$process.Kill($true)"), 2)
        self.assertIn("$process.Dispose()", SCRIPT)
        self.assertIn("No target recovery command was attempted", SCRIPT)
        self.assertIn("Could not prove exact-PID cleanup", SCRIPT)
        self.assertIn("a debug owner may remain", SCRIPT)
        self.assertIn("CLEANUP FAILURE PID", SCRIPT)
        self.assertNotIn("& $openOcdPath", SCRIPT)

    def test_tool_identity_and_adapter_routing_are_pinned(self):
        self.assertIn(
            "7461DBBEC251F1D4A2189C3C57B74A45B2FE64DEC1EC1B9EDDCB348A2AB2EBAB",
            SCRIPT,
        )
        self.assertIn(
            "9C2201DDCDB416A471E8D7F8BF309E4F20C364BBF416CA67D6475A8495934722",
            SCRIPT,
        )
        self.assertIn("OPENOCD_USB_ADAPTER_LOCATION must be unset", SCRIPT)
        self.assertIn("$startInfo.Environment.Remove('OPENOCD_USB_ADAPTER_LOCATION')", SCRIPT)
        argv = SCRIPT.split("foreach ($argument in @(", 1)[1].split(")) {", 1)[0]
        self.assertLess(
            argv.index("'-c', 'noinit'"),
            argv.index("'-f', $interfaceConfigForOpenOcd"),
        )
        self.assertEqual(SCRIPT.count("'-f', $interfaceConfigForOpenOcd"), 2)
        self.assertNotIn("'-f', 'interface/esp_usb_jtag.cfg'", SCRIPT)
        self.assertIn("$interfaceConfig.Replace('\\', '/')", SCRIPT)
        self.assertIn("Future OpenOCD argv (one token per line)", SCRIPT)

    def test_openocd_log_and_evidence_paths_reject_tcl_metacharacters(self):
        self.assertIn("function Assert-SafeOpenOcdOptionPath", SCRIPT)
        self.assertIn("'^[A-Za-z]:/[A-Za-z0-9_./-]+$'", SCRIPT)
        self.assertIn("$logFullPath.Replace('\\', '/')", SCRIPT)
        self.assertIn("'-l', $logPathForOpenOcd", SCRIPT)
        self.assertGreaterEqual(
            SCRIPT.count("Assert-SafeOpenOcdOptionPath -PathValue"), 2
        )
        validator = SCRIPT.index("Assert-SafeOpenOcdOptionPath -PathValue $evidencePathForOpenOcd")
        evidence_creation = SCRIPT.index("[void](New-Item -ItemType Directory")
        self.assertLess(validator, evidence_creation)
        self.assertIsNotNone(
            re.fullmatch(r"[A-Za-z]:/[A-Za-z0-9_./-]+", "D:/evidence_20260812")
        )
        for unsafe_path in (
            "D:/evidence with spaces",
            "D:/evidence;reset halt",
            "D:/evidence[exec reset]",
            "D:/evidence$variable",
            r"D:\evidence-backslash",
        ):
            self.assertIsNone(re.fullmatch(r"[A-Za-z]:/[A-Za-z0-9_./-]+", unsafe_path))

    def test_attach_output_rejects_any_cpu_examination_halt_or_target_reset(self):
        self.assertIn("$uniqueTapNames.Count -ne 2", SCRIPT)
        self.assertIn("$uniqueTapNames -notcontains 'tap0'", SCRIPT)
        self.assertIn("$uniqueTapNames -notcontains 'tap1'", SCRIPT)
        self.assertIn("$unexpectedTapEvidence.Count -ne 0", SCRIPT)
        duplicate_tap0 = [
            ("tap0", "0x120034e5"),
            ("tap0", "0x120034e5"),
        ]
        unique_names = {name for name, tap_id in duplicate_tap0 if tap_id == "0x120034e5"}
        self.assertNotEqual(unique_names, {"tap0", "tap1"})
        self.assertIn("STACKCHAN_TAP_ONLY_COMPLETE", SCRIPT)
        self.assertIn("Examination succeed|target halted|reset halt|reset run", SCRIPT)
        self.assertIn("Not proved: CPU, MAC, flash, running slot, eFuse", SCRIPT)


if __name__ == "__main__":
    unittest.main()

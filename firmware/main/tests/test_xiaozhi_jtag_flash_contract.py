import unittest
import re
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
SCRIPT_PATH = REPO_ROOT / "ops" / "bin" / "flash-xiaozhi-dock-candidate-jtag.ps1"
SCRIPT = SCRIPT_PATH.read_text(encoding="utf-8")


class XiaozhiJtagFlashContractTests(unittest.TestCase):
    def test_default_stage_is_local_only_and_returns_before_openocd(self):
        self.assertRegex(SCRIPT, r"\[string\]\$Stage\s*=\s*'Offline'")
        offline_gate = SCRIPT.index("if ($Stage -eq 'Offline')")
        openocd_call = SCRIPT.index("$probeOutput = Invoke-OpenOcdOneShot")
        self.assertLess(offline_gate, openocd_call)
        self.assertIn("OFFLINE PREFLIGHT PASSED", SCRIPT[offline_gate:openocd_call])
        self.assertIn("return", SCRIPT[offline_gate:openocd_call])
        call_positions = [
            match.start()
            for match in re.finditer(
                r"(?m)^\s*(?:\$\w+\s*=\s*)?Invoke-OpenOcdOneShot\s+-", SCRIPT
            )
        ]
        self.assertGreaterEqual(len(call_positions), 6)
        self.assertTrue(all(position > offline_gate for position in call_positions))

    def test_transport_is_pinned_and_never_uses_the_serial_flash_path(self):
        for marker in (
            "v0.12.0-esp32-20260424",
            "board/esp32s3-builtin.cfg",
            "VID_303A&PID_1001&MI_02",
            "adapter serial {$ExpectedAdapterSerial}",
            "adapter speed 10000",
            "gdb port disabled",
            "tcl port disabled",
            "telnet port disabled",
        ):
            self.assertIn(marker, SCRIPT)
        for forbidden in (
            "COM7",
            "esptool",
            "program_esp_bins",
            "verify_image",
            "flash verify_bank",
            "0x8000",
            "0x9000",
            "0xd000",
            "0xf000",
            "0x510000",
            "0xa00000",
            "0xe00000",
            "flash write_image",
            "flash erase_",
            "write_flash",
            "erase_flash",
        ):
            self.assertNotIn(forbidden, SCRIPT)

        self.assertNotIn("& $openOcdPath", SCRIPT)
        self.assertIn("[System.Diagnostics.ProcessStartInfo]::new()", SCRIPT)
        self.assertIn("$process.WaitForExit($TimeoutSeconds * 1000)", SCRIPT)
        self.assertIn("$process.Kill($true)", SCRIPT)
        self.assertIn("'-l', $logFullPath", SCRIPT)
        self.assertIn("$supervisorLogPath", SCRIPT)
        self.assertIn("Could not append OpenOCD supervisor evidence", SCRIPT)
        self.assertIn("conservatively attempted exact-PID termination", SCRIPT)
        self.assertIn("Final bounded cleanup terminated exact OpenOCD PID", SCRIPT)
        self.assertIn("no target reset was attempted", SCRIPT)
        cleanup = SCRIPT.split("finally {", 1)[1].split("function Assert-ProbeEvidence", 1)[0]
        self.assertLess(
            cleanup.index("$process.Kill($true)"),
            cleanup.index("& $writeSupervisorEvidence $cleanupResult"),
        )
        self.assertLess(cleanup.index("$process.Dispose()"), len(cleanup))
        openocd_invocations = len(re.findall(r"Invoke-OpenOcdOneShot\s+-", SCRIPT))
        bounded_invocations = len(
            re.findall(r"Invoke-OpenOcdOneShot\s+-TimeoutSeconds\s+", SCRIPT)
        )
        self.assertEqual(openocd_invocations, bounded_invocations)

    def test_dynamic_tcl_values_are_strictly_validated(self):
        self.assertEqual(
            SCRIPT.count("[ValidatePattern('^(?:[0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$')]"),
            2,
        )
        self.assertIn("Assert-SafeTclLiteral -Value $fullPath", SCRIPT)
        self.assertIn("Assert-SafeTclLiteral -Value $evidenceFullPath", SCRIPT)
        for marker in (
            "[char]'['",
            "[char]']'",
            "[char]'{'",
            "[char]'}'",
            "[char]'$'",
            "[char]';'",
            "[char]'\"'",
            "[char]13",
            "[char]10",
        ):
            self.assertIn(marker, SCRIPT)

    def test_probe_proves_identity_but_is_explicitly_disruptive(self):
        probe_call_index = SCRIPT.index("$probeOutput = Invoke-OpenOcdOneShot")
        for confirmation in (
            "$ConfirmedPlaintextFlashAndEfuses",
            "$ConfirmedOta0IsIntendedTarget",
            "$ConfirmAppOnlyJtagWrite",
        ):
            self.assertLess(SCRIPT.index(confirmation, SCRIPT.index("if ($Stage -eq 'Execute')")), probe_call_index)
        probe = SCRIPT.split("$probeOutput = Invoke-OpenOcdOneShot", 1)[1].split(
            "if ($Stage -eq 'Probe')", 1
        )[0]
        for marker in (
            "-ConfirmDisruptiveProbe",
            "reset halt",
            "flash probe 0",
            "flash banks",
            "targets",
            "echo STACKCHAN_TARGET_MAC=[esp_get_mac format]",
            "reset run",
            "0x120034e5",
            "Chip revision v0\\.2",
        ):
            self.assertIn(marker, SCRIPT if marker == "-ConfirmDisruptiveProbe" else probe + SCRIPT[: SCRIPT.index("$probeOutput")])
        self.assertIn(
            '"(?im)^STACKCHAN_TARGET_MAC=$([regex]::Escape($ExpectedMac))\\s*$"',
            SCRIPT,
        )

    def test_execute_orders_backup_program_readback_hash_then_reset(self):
        execute = SCRIPT.split("$sampleA =", 1)[1]
        ordered = (
            "read-sample-a.bin",
            "pre-ota0.bin",
            "Controlled candidate-app.bin changed before program_esp",
            "program_esp {$programCandidateTcl} 0x20000 verify exit",
            "post-app.bin",
            "$readbackHash -ne $expectedHash",
            "Join-Path $evidenceFullPath 'reset.log'",
        )
        positions = [execute.index(marker) for marker in ordered]
        self.assertEqual(positions, sorted(positions))
        self.assertIn("$backup.Length -ne $appPartitionSize", execute)
        self.assertIn("$readback.Length -ne $ExpectedLength", execute)
        self.assertIn("The target was deliberately not reset", execute)
        self.assertNotRegex(execute, r"finally\s*\{[^}]*reset run")
        self.assertIn("Verify OK|Existing flash content matches", execute)
        self.assertIn("Independent readback length or SHA-256 mismatch", execute)
        self.assertEqual(
            SCRIPT.count('"program_esp {$programCandidateTcl} 0x20000 verify exit"'),
            1,
        )
        catch_block = execute.split("catch {", 1)[1]
        self.assertNotIn("reset run", catch_block)

    def test_program_input_is_a_controlled_raw_esp32s3_app_bin(self):
        for marker in (
            "GetExtension($candidateResolved) -ine '.bin'",
            "$imageHeader[0] -ne 0xE9",
            "$expectedEsp32S3ImageChipId = [uint16]9",
            "$imageChipId -ne $expectedEsp32S3ImageChipId",
            "Join-Path $evidenceFullPath 'candidate-app.bin'",
            "Copy-Item -LiteralPath $candidateResolved -Destination $programCandidatePath",
            "$programCandidateHash -ne $expectedHash",
            "$programCandidateTcl = ConvertTo-TclPath -Path $programCandidatePath",
        ):
            self.assertIn(marker, SCRIPT)
        staging = SCRIPT.index("Join-Path $evidenceFullPath 'candidate-app.bin'")
        probe = SCRIPT.index("$probeOutput = Invoke-OpenOcdOneShot")
        program = SCRIPT.index('"program_esp {$programCandidateTcl} 0x20000 verify exit"')
        self.assertLess(staging, probe)
        self.assertLess(probe, program)

    def test_fixed_raw_slot_and_inactive_ota_semantics_are_explicit(self):
        self.assertIn("$appOffset = [long]0x20000", SCRIPT)
        self.assertIn("$appPartitionSize = [long]0x4f0000", SCRIPT)
        self.assertIn("Raw JTAG does not update", SCRIPT)
        self.assertRegex(SCRIPT, r"not\s+an inactive-slot OTA")
        self.assertIn("dynamically choose the non-running", SCRIPT)
        self.assertIn("ConfirmedOta0IsIntendedTarget", SCRIPT)
        self.assertNotIn("ota_1 at", SCRIPT)


if __name__ == "__main__":
    unittest.main()

import re
import subprocess
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
SCRIPT_PATH = REPO_ROOT / "ops" / "bin" / "flash-xiaozhi-dock-app-only-resumable.ps1"
MODULE_PATH = REPO_ROOT / "ops" / "lib" / "StackChanAppOnlyTransaction.psm1"
HOST_TEST = Path(__file__).parent / "host" / "stackchan_app_only_transaction_fault_test.ps1"


class XiaozhiAppOnlyTransactionRecoveryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.script = SCRIPT_PATH.read_text(encoding="utf-8")
        cls.module = MODULE_PATH.read_text(encoding="utf-8")

    def test_default_stage_is_offline_before_any_serial_or_evidence_access(self):
        self.assertRegex(self.script, r"\[string\]\$Stage\s*=\s*'Offline'")
        gate = self.script.index("if ($Stage -eq 'Offline')")
        serial = self.script.index("Get-CimInstance Win32_SerialPort")
        evidence = self.script.index("New-Item -ItemType Directory")
        self.assertLess(gate, serial)
        self.assertLess(gate, evidence)
        self.assertIn("return", self.script[gate : min(serial, evidence)])

    def test_live_wrapper_is_fixed_app_only_and_calls_one_transaction_core(self):
        for marker in (
            "$appOffset = [long]0x20000",
            "$appPartitionSize = [long]0x4f0000",
            "$chunkSize = [long]0x100000",
            "ConfirmedOta0IsIntendedTarget",
            "ConfirmSerialDeviceDisruption",
            "VID_303A&PID_1001&MI_00",
            "Invoke-StackChanAppOnlyTransaction",
        ):
            self.assertIn(marker, self.script)
        self.assertEqual(self.script.count("Invoke-StackChanAppOnlyTransaction"), 1)
        self.assertNotIn("program_esp_bins", self.script)
        for address in ("0x0','", "0xd000','", "0xa00000','"):
            self.assertNotIn(address, self.script)

    def test_live_wrapper_captures_transport_helper_across_module_scope(self):
        transport = self.script.split("$transport = {", 1)[1].split(
            "Import-Module $modulePath", 1
        )[0]
        self.assertIn("$invokeLiveEspTool = ${function:Invoke-LiveEspTool}", self.script)
        self.assertNotIn("Invoke-LiveEspTool -Name", transport)
        self.assertEqual(transport.count("& $invokeLiveEspTool -Name"), 3)

    def test_live_esptool_is_bounded_and_exact_process_cleanup_is_fail_closed(self):
        for marker in (
            "[System.Diagnostics.ProcessStartInfo]::new()",
            "$startInfo.ArgumentList.Add('-m')",
            "$process.WaitForExit($TimeoutSeconds * 1000)",
            "$process.Kill($true)",
            "$process.WaitForExit(5000)",
            "esptool_timeout",
            "exact_pid_cleanup_failed",
        ):
            self.assertIn(marker, self.script)
        self.assertNotIn("& $pythonPath -m esptool", self.script)
        cleanup = self.script.split("function Invoke-LiveEspTool", 1)[1].split(
            "$identity = Invoke-LiveEspTool", 1
        )[0]
        self.assertLess(cleanup.index("$process.Kill($true)"), cleanup.index("$process.Dispose()"))

    def test_evidence_path_is_absolute_and_bounded_to_runtime_subtree(self):
        gate = self.script.index("EvidenceDirectory must be an absolute child")
        offline = self.script.index("if ($Stage -eq 'Offline')")
        self.assertLess(gate, offline)
        for marker in (
            "[IO.Path]::IsPathFullyQualified($EvidenceDirectory)",
            "Join-Path $workspace '.claw\\runtime'",
            "[IO.Path]::GetRelativePath($runtimeRoot, $evidenceResolved)",
            "$relativeEvidence -eq '.'",
            "$relativeEvidence.StartsWith('..')",
        ):
            self.assertIn(marker, self.script)

    def test_state_machine_reserves_write_and_reset_before_transport(self):
        write_reserve = self.module.index("$state.write_count = 1")
        write_call = self.module.index("operation = 'write_flash'")
        reset_reserve = self.module.index("$state.hard_reset_count = 1")
        verify_call = self.module.index("operation = 'verify_flash'")
        self.assertLess(write_reserve, write_call)
        self.assertLess(reset_reserve, verify_call)
        self.assertIn("write_uncertain", self.module)
        self.assertIn("verify_uncertain", self.module)
        self.assertIn("Existing transaction already reserved its only write", self.module)

    def test_backup_and_readback_are_both_chunked_and_manifested(self):
        for marker in (
            "backup_chunks",
            "readback_chunks",
            '"$Prefix-chunk-{0:D2}.bin"',
            '"$Prefix-chunk-{0:D2}.partial"',
            "preflash-ota0.bin",
            "Get-CombinedSha256",
            "Write-AtomicJson",
        ):
            self.assertIn(marker, self.module)
        self.assertNotRegex(self.script, r"read_flash[^\n]+0x4f0000")

    def test_assembled_full_slot_backup_is_rehashed_before_write_is_armed(self):
        join = self.module.index("Join-ChunkFiles -Plan $backupPlan")
        assembled_hash = self.module.index("Get-FileHash -LiteralPath $backupPath")
        write_reserve = self.module.index("$state.write_count = 1")
        self.assertLess(join, assembled_hash)
        self.assertLess(assembled_hash, write_reserve)
        self.assertIn("Combined backup SHA256 mismatch", self.module)

    def test_failure_paths_do_not_reset_or_repeat_write(self):
        self.assertNotRegex(self.module, r"catch\s*\{[^}]*hard_reset")
        self.assertNotRegex(self.module, r"finally\s*\{[^}]*hard_reset")
        self.assertIn("if ($state.write_count -eq 0)", self.module)
        self.assertIn("if ($state.hard_reset_count -ne 0)", self.module)

    def test_completed_or_reset_uncertain_transaction_stops_before_serial(self):
        result_gate = self.script.index("if (Test-Path -LiteralPath $existingResultPath)")
        reset_gate = self.script.index("$existingState.hard_reset_count -ne 0")
        serial = self.script.index("Get-CimInstance Win32_SerialPort")
        self.assertLess(result_gate, serial)
        self.assertLess(reset_gate, serial)
        self.assertIn("return", self.script[result_gate:serial])
        self.assertIn("do not reopen serial", self.script[reset_gate:serial])

    def test_fault_injection_executes_real_state_machine(self):
        completed = subprocess.run(
            ["pwsh", "-NoProfile", "-File", str(HOST_TEST)],
            check=True,
            capture_output=True,
            text=True,
            timeout=60,
        )
        self.assertIn("fault injection: PASS", completed.stdout)

    def test_powershell_files_parse(self):
        for path in (SCRIPT_PATH, MODULE_PATH, HOST_TEST):
            command = (
                "$tokens=$null;$errors=$null;"
                "[System.Management.Automation.Language.Parser]::ParseFile("
                f"'{str(path).replace("'", "''")}',[ref]$tokens,[ref]$errors)|Out-Null;"
                "if($errors.Count){$errors|ForEach-Object{$_.Message};exit 1}"
            )
            subprocess.run(
                ["pwsh", "-NoProfile", "-Command", command],
                check=True,
                capture_output=True,
                text=True,
                timeout=20,
            )


if __name__ == "__main__":
    unittest.main()

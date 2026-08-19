import hashlib
import json
import re
import subprocess
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
SCRIPT_PATH = REPO_ROOT / "ops" / "bin" / "verify-xiaozhi-app-slot-chunked.ps1"


class XiaozhiSerialReadbackRecoveryContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.script = SCRIPT_PATH.read_text(encoding="utf-8")

    def test_default_offline_stage_returns_before_serial_or_evidence_access(self):
        self.assertRegex(self.script, r"\[string\]\$Stage\s*=\s*'Offline'")
        offline = self.script.index("if ($Stage -eq 'Offline')")
        serial = self.script.index("Get-CimInstance Win32_SerialPort")
        invoke = self.script.index("Invoke-EspTool -Name")
        evidence = self.script.index("New-Item -ItemType Directory")
        self.assertLess(offline, serial)
        self.assertLess(offline, invoke)
        self.assertLess(offline, evidence)
        gate = self.script[offline : min(serial, invoke, evidence)]
        self.assertIn("return", gate)
        self.assertIn("OFFLINE PREFLIGHT PASSED", gate)

    def test_offline_plan_is_exact_and_has_no_side_effect_directory(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            temp = Path(temp_dir)
            candidate = temp / "candidate.bin"
            image = bytearray(0x230123)
            image[0] = 0xE9
            image[12:14] = (9).to_bytes(2, "little")
            candidate.write_bytes(image)
            digest = hashlib.sha256(image).hexdigest().upper()
            evidence = temp / "must-not-exist"
            completed = subprocess.run(
                [
                    "pwsh",
                    "-NoProfile",
                    "-File",
                    str(SCRIPT_PATH),
                    "-CandidatePath",
                    str(candidate),
                    "-ExpectedSha256",
                    digest,
                    "-ExpectedLength",
                    str(len(image)),
                    "-EvidenceDirectory",
                    str(evidence),
                ],
                check=True,
                capture_output=True,
                text=True,
                timeout=20,
            )
            plan_line = next(line for line in completed.stdout.splitlines() if line.startswith("{"))
            plan = json.loads(plan_line)
            self.assertEqual(plan["stage"], "Offline")
            self.assertEqual(plan["offset"], "0x20000")
            self.assertEqual(plan["chunk_size"], 0x100000)
            self.assertEqual(plan["chunks"], 3)
            self.assertEqual(plan["covered_length"], len(image))
            self.assertFalse(evidence.exists())

    def test_execute_is_no_write_and_requires_explicit_fixed_slot_authority(self):
        for marker in (
            "[switch]$ConfirmSerialDeviceDisruption",
            "[switch]$ConfirmedOta0IsIntendedTarget",
            "$appOffset = [long]0x20000",
            "$appPartitionSize = [long]0x4f0000",
            "VID_303A&PID_1001&MI_00",
            "44:1b:f6:e2:78:a8",
        ):
            self.assertIn(marker, self.script)
        for forbidden in (
            "write_flash",
            "erase_flash",
            "erase_region",
            "0x0',",
            "0xd000',",
            "0xa00000',",
        ):
            self.assertNotIn(forbidden, self.script)

    def test_readback_is_bounded_chunked_resumable_and_fail_closed(self):
        self.assertIn("$chunkSize = [long]0x100000", self.script)
        self.assertIn("read_flash", self.script)
        self.assertNotRegex(
            self.script,
            r"'read_flash'\s*,\s*\$appOffset\s*,\s*\(\[string\]\$ExpectedLength\)",
        )
        for marker in (
            "Get-ChunkPlan",
            "readback-chunk-{0:D2}.bin",
            "readback-chunk-{0:D2}.partial",
            "Move-Item -LiteralPath $partialPath -Destination $finalPath",
            "completed_chunks",
            "Get-CombinedSha256",
            "Existing completed chunk evidence is inconsistent",
        ):
            self.assertIn(marker, self.script)
        self.assertRegex(self.script, r"if \(\$combinedSha -ne \$expectedHash\)[\s\S]+?throw")

    def test_manifest_exists_before_the_first_disruptive_serial_attempt(self):
        manifest_write = self.script.index(
            "Write-AtomicJson -Path $manifestPath -Value $manifest"
        )
        attempt_directory = self.script.index(
            "New-Item -ItemType Directory -Path $attemptDirectory"
        )
        identity = self.script.index("Invoke-EspTool -Name '01-identity'")
        self.assertLess(manifest_write, attempt_directory)
        self.assertLess(manifest_write, identity)

    def test_verify_precedes_the_only_optional_reset_and_failures_never_reset(self):
        verify = self.script.index("'verify_flash','0x20000',$candidateResolved")
        reset_marker = self.script.index("FINAL_HARD_RESET_COMPLETE")
        self.assertLess(verify, reset_marker)
        self.assertIn("[switch]$FinalHardReset", self.script)
        self.assertIn("--after',$afterVerify", self.script)
        self.assertIn("FINAL_RESET_DEFERRED", self.script)
        self.assertNotRegex(self.script, r"finally\s*\{[^}]*hard_reset")
        self.assertNotRegex(self.script, r"catch\s*\{[^}]*hard_reset")

    def test_script_has_valid_powershell_syntax(self):
        command = (
            "$tokens=$null;$errors=$null;"
            "[System.Management.Automation.Language.Parser]::ParseFile("
            f"'{str(SCRIPT_PATH).replace("'", "''")}',[ref]$tokens,[ref]$errors)|Out-Null;"
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

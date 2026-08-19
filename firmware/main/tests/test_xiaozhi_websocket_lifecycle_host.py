import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


TEST_ROOT = Path(__file__).resolve().parent
MODEL_SOURCE = TEST_ROOT / "host" / "websocket_lifecycle_model_test.cpp"


def visual_studio_environment_script() -> Path | None:
    roots = [
        Path(os.environ.get("ProgramFiles", r"C:\Program Files")),
        Path(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")),
    ]
    candidates: list[Path] = []
    for root in roots:
        candidates.extend(
            root.glob("Microsoft Visual Studio/2022/*/VC/Auxiliary/Build/vcvars64.bat")
        )
    return sorted(candidates)[-1] if candidates else None


class XiaozhiWebsocketLifecycleHostTests(unittest.TestCase):
    def test_deterministic_lifecycle_specification(self):
        self.assertTrue(MODEL_SOURCE.is_file())
        with tempfile.TemporaryDirectory(prefix="stackchan-p03-host-") as temporary:
            temporary_root = Path(temporary)
            executable = temporary_root / "websocket_lifecycle_model.exe"

            if os.name == "nt" and visual_studio_environment_script() is not None:
                vcvars = visual_studio_environment_script()
                command = (
                    f'call "{vcvars}" >nul && '
                    f'cl /nologo /std:c++20 /EHsc /W4 "{MODEL_SOURCE}" '
                    f'/Fe:"{executable}"'
                )
                compile_result = subprocess.run(
                    f"cmd.exe /d /c {command}",
                    cwd=temporary_root,
                    capture_output=True,
                    text=True,
                    timeout=60,
                )
            else:
                compiler = shutil.which("c++") or shutil.which("g++") or shutil.which("clang++")
                self.assertIsNotNone(compiler, "a host C++20 compiler is required")
                compile_result = subprocess.run(
                    [
                        compiler,
                        "-std=c++20",
                        "-pthread",
                        "-Wall",
                        "-Wextra",
                        "-Werror",
                        str(MODEL_SOURCE),
                        "-o",
                        str(executable),
                    ],
                    cwd=temporary_root,
                    capture_output=True,
                    text=True,
                    timeout=60,
                )

            self.assertEqual(
                compile_result.returncode,
                0,
                compile_result.stdout + compile_result.stderr,
            )
            run_result = subprocess.run(
                [str(executable)],
                cwd=temporary_root,
                capture_output=True,
                text=True,
                timeout=10,
            )
            self.assertEqual(run_result.returncode, 0, run_result.stdout + run_result.stderr)
            self.assertIn("websocket lifecycle model: ok", run_result.stdout)


if __name__ == "__main__":
    unittest.main()

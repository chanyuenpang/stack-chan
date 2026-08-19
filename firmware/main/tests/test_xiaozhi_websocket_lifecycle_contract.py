import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


FIRMWARE_ROOT = Path(__file__).resolve().parents[2]
REPOSITORY_ROOT = FIRMWARE_ROOT.parent
ESP_ML307 = FIRMWARE_ROOT / "managed_components" / "78__esp-ml307"

ESP_TCP_SOURCE = (ESP_ML307 / "src" / "esp" / "esp_tcp.cc").read_text(encoding="utf-8")
ESP_TCP_HEADER = (ESP_ML307 / "src" / "esp" / "esp_tcp.h").read_text(encoding="utf-8")
ESP_SSL_SOURCE = (ESP_ML307 / "src" / "esp" / "esp_ssl.cc").read_text(encoding="utf-8")
ESP_SSL_HEADER = (ESP_ML307 / "src" / "esp" / "esp_ssl.h").read_text(encoding="utf-8")
TCP_HEADER = (ESP_ML307 / "include" / "tcp.h").read_text(encoding="utf-8")
WEB_SOCKET_SOURCE = (ESP_ML307 / "src" / "web_socket.cc").read_text(encoding="utf-8")
WEB_SOCKET_HEADER = (ESP_ML307 / "include" / "web_socket.h").read_text(encoding="utf-8")
WEBSOCKET_PROTOCOL = (
    FIRMWARE_ROOT / "xiaozhi-esp32" / "main" / "protocols" / "websocket_protocol.cc"
).read_text(encoding="utf-8")
APPLICATION = (FIRMWARE_ROOT / "xiaozhi-esp32" / "main" / "application.cc").read_text(
    encoding="utf-8"
)
FIRMWARE_CMAKE = (FIRMWARE_ROOT / "CMakeLists.txt").read_text(encoding="utf-8")

ESP_LIFECYCLE_PATCH_PATH = (
    FIRMWARE_ROOT / "patches" / "esp-ml307-local-dock-websocket-lifecycle.patch"
)
XIAOZHI_LIFECYCLE_PATCH_PATH = (
    FIRMWARE_ROOT / "patches" / "xiaozhi-local-dock-websocket-owner-lifecycle.patch"
)


def function_body(source: str, signature: str) -> str:
    """Return one C++ function body using balanced braces, not the next token."""
    signature_start = source.index(signature)
    body_start = source.index("{", signature_start)
    depth = 0
    for index in range(body_start, len(source)):
        if source[index] == "{":
            depth += 1
        elif source[index] == "}":
            depth -= 1
            if depth == 0:
                return source[body_start + 1:index]
    raise AssertionError(f"unterminated function: {signature}")


def patch_paths(patch_text: str) -> set[str]:
    return set(re.findall(r"^diff --git a/(.+?) b/", patch_text, flags=re.MULTILINE))


class XiaozhiWebsocketLifecycleContractTests(unittest.TestCase):
    def test_websocket_callbacks_are_stable_for_the_receive_task_lifetime(self):
        destructor = function_body(WEB_SOCKET_SOURCE, "WebSocket::~WebSocket()")
        self.assertIn("if (tcp_)", destructor)
        self.assertNotIn("if (connected_)", destructor)
        self.assertNotIn("tcp_->OnStream", destructor)
        self.assertNotIn("tcp_->OnDisconnected", destructor)
        self.assertIn("tcp_->Disconnect();", destructor)
        self.assertLess(
            destructor.index("tcp_->Disconnect();"),
            destructor.index("vEventGroupDelete(handshake_event_group_)")
        )

        connect = function_body(WEB_SOCKET_SOURCE, "bool WebSocket::Connect")
        transport_connect = connect.index("tcp_->Connect(host, std::stoi(port))")
        self.assertLess(connect.index("tcp_->OnStream("), transport_connect)
        self.assertLess(connect.index("tcp_->OnDisconnected("), transport_connect)

    def test_tcp_join_is_independent_of_protocol_and_socket_state(self):
        disconnect_wrapper = function_body(ESP_TCP_SOURCE, "void EspTcp::Disconnect()")
        disconnect = function_body(ESP_TCP_SOURCE, "void EspTcp::DoDisconnect")
        self.assertIn("DoDisconnect(!is_receive_task);", disconnect_wrapper)
        self.assertNotIn("if (!connected_)", disconnect)
        self.assertIn("connected_.exchange(false,", disconnect)
        self.assertIn("shutdown(", disconnect)
        self.assertIn("SHUT_RDWR", disconnect)
        self.assertIn("WaitForReceiveTask", disconnect)
        self.assertNotRegex(
            disconnect,
            r"if\s*\(tcp_fd_.+?\)\s*\{[^{}]*WaitForReceiveTask",
        )
        self.assertLess(disconnect.index("shutdown("), disconnect.index("WaitForReceiveTask"))
        self.assertLess(disconnect.index("WaitForReceiveTask"), disconnect.index("close("))
        self.assertRegex(
            disconnect,
            r"if\s*\(wait_for_task\)\s*\{\s*WaitForReceiveTask\(\);\s*\}",
        )

    def test_tcp_exit_latch_is_the_last_transport_object_access(self):
        self.assertIn("enum class ReceiveTaskState", ESP_TCP_HEADER)
        self.assertIn("std::atomic<ReceiveTaskState> receive_task_state_", ESP_TCP_HEADER)
        task_entry = function_body(ESP_TCP_SOURCE, "void EspTcp::ReceiveTaskEntry")
        wake = task_entry.index("xEventGroupSetBits")
        exited = task_entry.index("memory_order_release")
        task_delete = task_entry.index("vTaskDelete(NULL)")
        self.assertLess(wake, exited)
        self.assertLess(exited, task_delete)
        exited_statement = (
            "receive_task_state_.store(ReceiveTaskState::Exited, "
            "std::memory_order_release);"
        )
        self.assertIn(exited_statement, task_entry)
        self.assertEqual(task_entry.split(exited_statement, 1)[1].strip(), "vTaskDelete(NULL);")

        join = function_body(ESP_TCP_SOURCE, "void EspTcp::WaitForReceiveTask")
        self.assertIn("memory_order_acquire", join)
        self.assertIn("portMAX_DELAY", join)
        self.assertIn("xTaskGetCurrentTaskHandle()", join)
        self.assertIn("vTaskDelay(1)", join)
        self.assertNotIn("taskYIELD", join)
        self.assertNotIn("vTaskDelete(receive_task_handle_)", join)
        self.assertRegex(
            join,
            r"if\s*\(receive_state\s*!=\s*ReceiveTaskState::Exited\s*&&\s*"
            r"receive_task_handle_\s*!=\s*nullptr\s*&&\s*"
            r"receive_task_handle_\s*==\s*xTaskGetCurrentTaskHandle\(\)\)\s*"
            r"\{\s*return;\s*\}",
        )
        wait_loop = join.index("while (receive_state != ReceiveTaskState::Exited)")
        self.assertEqual(len(re.findall(r"\breturn\s*;", join)), 2)
        self.assertTrue(all(match.start() < wait_loop for match in re.finditer(r"\breturn\s*;", join)))
        self.assertLess(
            wait_loop,
            join.index("receive_task_handle_ = nullptr"),
        )

    def test_tls_uses_the_same_fail_closed_owner_join(self):
        self.assertIn("enum class ReceiveTaskState", ESP_SSL_HEADER)
        self.assertIn("std::atomic<ReceiveTaskState> receive_task_state_", ESP_SSL_HEADER)
        disconnect = function_body(ESP_SSL_SOURCE, "void EspSsl::Disconnect()")
        self.assertIn("connected_.exchange(false,", disconnect)
        self.assertIn("shutdown(", disconnect)
        self.assertIn("WaitForReceiveTask", disconnect)
        self.assertLess(disconnect.index("WaitForReceiveTask"), disconnect.index("esp_tls_conn_destroy"))
        self.assertRegex(
            disconnect,
            r"if\s*\(!is_receive_task\)\s*\{\s*WaitForReceiveTask\(\);\s*\}",
        )

        task_entry = function_body(ESP_SSL_SOURCE, "void EspSsl::ReceiveTaskEntry")
        self.assertLess(task_entry.index("xEventGroupSetBits"), task_entry.index("memory_order_release"))
        self.assertLess(task_entry.index("memory_order_release"), task_entry.index("vTaskDelete(NULL)"))
        exited_statement = (
            "receive_task_state_.store(ReceiveTaskState::Exited, "
            "std::memory_order_release);"
        )
        self.assertEqual(task_entry.split(exited_statement, 1)[1].strip(), "vTaskDelete(NULL);")

        join = function_body(ESP_SSL_SOURCE, "void EspSsl::WaitForReceiveTask")
        self.assertIn("memory_order_acquire", join)
        self.assertIn("portMAX_DELAY", join)
        self.assertIn("xTaskGetCurrentTaskHandle()", join)
        self.assertIn("vTaskDelay(1)", join)
        self.assertNotIn("taskYIELD", join)
        self.assertNotIn("vTaskDelete(receive_task_handle_)", join)
        self.assertRegex(
            join,
            r"if\s*\(receive_state\s*!=\s*ReceiveTaskState::Exited\s*&&\s*"
            r"receive_task_handle_\s*!=\s*nullptr\s*&&\s*"
            r"receive_task_handle_\s*==\s*xTaskGetCurrentTaskHandle\(\)\)\s*"
            r"\{\s*return;\s*\}",
        )
        wait_loop = join.index("while (receive_state != ReceiveTaskState::Exited)")
        self.assertEqual(len(re.findall(r"\breturn\s*;", join)), 2)
        self.assertTrue(all(match.start() < wait_loop for match in re.finditer(r"\breturn\s*;", join)))
        self.assertLess(wait_loop, join.index("receive_task_handle_ = nullptr"))

    def test_task_creation_failure_never_reports_a_live_connection(self):
        tcp_connect = function_body(ESP_TCP_SOURCE, "bool EspTcp::Connect")
        ssl_connect = function_body(ESP_SSL_SOURCE, "bool EspSsl::Connect")
        for connect in (tcp_connect, ssl_connect):
            self.assertIn("const BaseType_t receive_task_result = xTaskCreate", connect)
            self.assertIn("if (receive_task_result != pdPASS)", connect)
            self.assertIn("connected_ = false", connect)
            self.assertIn("receive_task_handle_ = nullptr", connect)
            self.assertIn("return false", connect)

    def test_disconnect_notification_uses_one_atomic_transition(self):
        self.assertIn("std::atomic<bool> connected_", TCP_HEADER)
        self.assertIn("std::atomic<bool> connected_", WEB_SOCKET_HEADER)
        self.assertIn("connected_.exchange(false,", ESP_TCP_SOURCE)
        self.assertIn("connected_.exchange(false,", ESP_SSL_SOURCE)
        self.assertGreaterEqual(WEB_SOCKET_SOURCE.count("connected_.exchange(false,"), 2)

    def test_protocol_owner_is_drained_before_its_event_group(self):
        destructor = function_body(WEBSOCKET_PROTOCOL, "WebsocketProtocol::~WebsocketProtocol()")
        self.assertIn("websocket_.reset();", destructor)
        self.assertLess(
            destructor.index("websocket_.reset();"),
            destructor.index("vEventGroupDelete(event_group_handle_)")
        )

    def test_receive_callbacks_only_defer_owner_cleanup(self):
        protocol_data = WEBSOCKET_PROTOCOL.split(
            "websocket_->OnData([this]", 1
        )[1].split("websocket_->OnDisconnected", 1)[0]
        protocol_disconnect = WEBSOCKET_PROTOCOL.split(
            "websocket_->OnDisconnected([this]()", 1
        )[1].split("ESP_LOGI(TAG, \"Connecting to websocket server", 1)[0]
        for receiver_callback in (protocol_data, protocol_disconnect):
            self.assertNotIn("websocket_.reset", receiver_callback)
            self.assertNotIn("CloseAudioChannel", receiver_callback)

        application_audio = APPLICATION.split(
            "protocol_->OnIncomingAudio", 1
        )[1].split("protocol_->OnAudioChannelOpened", 1)[0]
        application_disconnect = APPLICATION.split(
            "protocol_->OnAudioChannelClosed([this, &board]()", 1
        )[1].split("protocol_->OnIncomingJson", 1)[0]
        application_json = APPLICATION.split(
            "protocol_->OnIncomingJson", 1
        )[1].split("protocol_->Start()", 1)[0]
        self.assertIn("Schedule([this]()", application_disconnect)
        for receiver_callback in (application_audio, application_disconnect, application_json):
            self.assertNotIn("CloseAudioChannel", receiver_callback)
            self.assertNotIn("protocol_.reset", receiver_callback)

    def test_p03_patches_are_independent_and_cmake_ordered(self):
        self.assertTrue(ESP_LIFECYCLE_PATCH_PATH.is_file())
        self.assertTrue(XIAOZHI_LIFECYCLE_PATCH_PATH.is_file())
        esp_patch = ESP_LIFECYCLE_PATCH_PATH.read_text(encoding="utf-8")
        xiaozhi_patch = XIAOZHI_LIFECYCLE_PATCH_PATH.read_text(encoding="utf-8")

        self.assertEqual(
            patch_paths(esp_patch),
            {
                "include/tcp.h",
                "include/web_socket.h",
                "src/esp/esp_ssl.cc",
                "src/esp/esp_ssl.h",
                "src/esp/esp_tcp.cc",
                "src/esp/esp_tcp.h",
                "src/web_socket.cc",
            },
        )
        self.assertEqual(
            patch_paths(xiaozhi_patch),
            {"main/protocols/websocket_protocol.cc"},
        )
        forbidden = (
            "audio/", "display.", "lvgl", "hal_local_dock_led", "touch", "application.cc",
            "Abort", "AUDIO-PERF", "hal_audio_performance", "InjectPcm",
        )
        combined = esp_patch + xiaozhi_patch
        for token in forbidden:
            self.assertNotIn(token, combined)

        lifecycle_state = FIRMWARE_CMAKE.index(
            "RESULT_VARIABLE STACKCHAN_ESP_ML307_LOCAL_DOCK_LIFECYCLE_APPLIED"
        )
        safety_state = FIRMWARE_CMAKE.index(
            "RESULT_VARIABLE STACKCHAN_ESP_ML307_LOCAL_DOCK_SAFETY_APPLIED",
            lifecycle_state,
        )
        lifecycle_apply = FIRMWARE_CMAKE.index(
            '"${STACKCHAN_ESP_ML307_LOCAL_DOCK_LIFECYCLE_PATCH}"',
            safety_state,
        )
        self.assertLess(lifecycle_state, safety_state)
        self.assertLess(safety_state, lifecycle_apply)
        self.assertIn("xiaozhi-local-dock-websocket-owner-lifecycle.patch", FIRMWARE_CMAKE)
        self.assertNotIn("--reject", FIRMWARE_CMAKE)

    def test_managed_patch_stack_round_trips_from_the_current_tree(self):
        safety_patch = FIRMWARE_ROOT / "patches" / "esp-ml307-local-dock-websocket-safety.patch"
        lifecycle_patch = ESP_LIFECYCLE_PATCH_PATH
        selected_paths = patch_paths(safety_patch.read_text(encoding="utf-8")) | patch_paths(
            lifecycle_patch.read_text(encoding="utf-8")
        )

        with tempfile.TemporaryDirectory(prefix="stackchan-p03-patch-") as temporary:
            temporary_root = Path(temporary)
            for relative_path in selected_paths:
                destination = temporary_root / relative_path
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(ESP_ML307 / relative_path, destination)

            def apply(*arguments: str) -> None:
                result = subprocess.run(
                    ["git", "apply", *arguments],
                    cwd=temporary_root,
                    capture_output=True,
                    text=True,
                    timeout=15,
                )
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

            apply("--reverse", str(lifecycle_patch))
            apply("--reverse", str(safety_patch))
            apply(str(safety_patch))
            apply("--check", str(lifecycle_patch))
            apply(str(lifecycle_patch))
            apply("--reverse", "--check", str(lifecycle_patch))

    def test_xiaozhi_owner_patch_round_trips_from_the_current_tree(self):
        owner_relative_path = Path("main/protocols/websocket_protocol.cc")
        with tempfile.TemporaryDirectory(prefix="stackchan-p03-owner-patch-") as temporary:
            temporary_root = Path(temporary)
            destination = temporary_root / owner_relative_path
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(FIRMWARE_ROOT / "xiaozhi-esp32" / owner_relative_path, destination)

            def apply(*arguments: str) -> None:
                result = subprocess.run(
                    ["git", "apply", *arguments],
                    cwd=temporary_root,
                    capture_output=True,
                    text=True,
                    timeout=15,
                )
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

            apply("--reverse", str(XIAOZHI_LIFECYCLE_PATCH_PATH))
            apply("--check", str(XIAOZHI_LIFECYCLE_PATCH_PATH))
            apply(str(XIAOZHI_LIFECYCLE_PATCH_PATH))
            apply("--reverse", "--check", str(XIAOZHI_LIFECYCLE_PATCH_PATH))


if __name__ == "__main__":
    unittest.main()

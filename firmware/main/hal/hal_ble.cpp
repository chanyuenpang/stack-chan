/*
 * SPDX-FileCopyrightText: 2026 M5Stack Technology CO LTD
 *
 * SPDX-License-Identifier: MIT
 */
#include "hal.h"
#include "wifi_audio_dock_mvp.h"
#include "utils/bleprph/bleprph.h"
#include "utils/secret_logic/secret_logic.h"
#include <ArduinoJson.hpp>
#include <mooncake_log.h>
#include <mooncake.h>
#include <settings.h>
#include <esp_mac.h>
#include <sdkconfig.h>

static const std::string_view _tag = "HAL-BLE";

static int _handle_ble_motion_write(const char* json_data, uint16_t len, uint16_t conn_handle)
{
    // mclog::tagInfo(_tag, "on motion:\n{}", json_data);
    GetHAL().onBleMotionData.emit(json_data);
    return 0;
}

static int _handle_ble_avatar_write(const char* json_data, uint16_t len, uint16_t conn_handle)
{
    // mclog::tagInfo(_tag, "on avatar:\n{}", json_data);
    GetHAL().onBleAvatarData.emit(json_data);
    return 0;
}

static int _handle_ble_config_write(const char* json_data, uint16_t len, uint16_t conn_handle)
{
    // mclog::tagInfo(_tag, "on config:\n{}", json_data);
    GetHAL().onBleConfigData.emit(json_data);
    return 0;
}

static int _handle_ble_rgb_write(const char* json_data, uint16_t len, uint16_t conn_handle)
{
    // mclog::tagInfo(_tag, "on rgb:\n{}", json_data);
    GetHAL().onBleRgbData.emit(json_data);
    return 0;
}

static uint8_t _handle_ble_battery_read(void)
{
    mclog::tagInfo(_tag, "on bat read");
    return 96;
}

void Hal::ble_init(bool useAltUuid)
{
    mclog::tagInfo(_tag, "init");

    static stackchan_ble_callbacks_t ble_callbacks = {
        .motion_cb       = _handle_ble_motion_write,
        .avatar_cb       = _handle_ble_avatar_write,
        .config_cb       = _handle_ble_config_write,
        .rgb_cb          = _handle_ble_rgb_write,
        .battery_read_cb = _handle_ble_battery_read,
    };
    stackchan_ble_register_callbacks(&ble_callbacks);

    ble_prph_init(useAltUuid);

    uint8_t mac[6];
    esp_read_mac(mac, ESP_MAC_EFUSE_FACTORY);
    mclog::tagInfo(_tag, "init done, factory mac: {:02x}:{:02x}:{:02x}:{:02x}:{:02x}:{:02x}", mac[0], mac[1], mac[2],
                   mac[3], mac[4], mac[5]);
}

void Hal::startBleServer()
{
    mclog::tagInfo(_tag, "start ble server");
    ble_init(false);
}

bool Hal::isBleConnected()
{
    return stackchan_ble_is_connected();
}

/* -------------------------------------------------------------------------- */
/*                              App config server                             */
/* -------------------------------------------------------------------------- */
#include "utils/wifi_connect/wifi_station.h"
#include <string_view>
#include <queue>
#include <mutex>
#include <atomic>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>

class WifiConfigServer {
public:
    void init()
    {
        GetHAL().onBleConfigData.connect([this](const char* data) { on_config_data(data); });
        _was_connected = stackchan_ble_is_connected();

        // Setup WifiStation callbacks
        _wifi_station = std::make_unique<StackChanWifiStation>();
        _wifi_station->OnConnect([this](const std::string& ssid) {
            mclog::tagInfo(_tag, "wifi Connecting to {}", ssid);
            _is_wifi_connecting = true;
            notify_state(0, "wifiConnecting");
        });
        _wifi_station->OnConnected([this](const std::string& ssid) {
            mclog::tagInfo(_tag, "wifi Connected to {}", ssid);
            _is_wifi_connecting = false;
            notify_state(1, "wifiConnected");
            GetHAL().onAppConfigEvent.emit(AppConfigEvent::WifiConnected);

            Settings settings("app_config", true);
            settings.SetBool("is_configed", true);
        });
        _wifi_station->OnConnectFailed([this](const std::string& ssid) {
            mclog::tagInfo(_tag, "wifi Connect Failed to {}", ssid);
            _is_wifi_connecting = false;
            notify_state(2, "wifiConnectFailed");
            GetHAL().onAppConfigEvent.emit(AppConfigEvent::WifiConnectFailed);
        });

        _wifi_station->Start();

#if CONFIG_STACKCHAN_WIFI_AUDIO_MVP
        constexpr std::string_view bootstrap_ssid(CONFIG_STACKCHAN_WIFI_AUDIO_BOOTSTRAP_SSID);
        constexpr std::string_view bootstrap_password(CONFIG_STACKCHAN_WIFI_AUDIO_BOOTSTRAP_PASSWORD);
        if (!bootstrap_ssid.empty()) {
            mclog::tagInfo(_tag, "applying private-build Wi-Fi bootstrap configuration");
            _wifi_station->AddAuth(std::string(bootstrap_ssid), std::string(bootstrap_password));
        }
#endif
    }

    void update()
    {
        bool is_connected = stackchan_ble_is_connected();
        if (is_connected != _was_connected) {
            _was_connected = is_connected;
            if (is_connected) {
                mclog::tagInfo("WifiConfigServer", "app Connected");
                GetHAL().onAppConfigEvent.emit(AppConfigEvent::AppConnected);
            } else {
                mclog::tagInfo("WifiConfigServer", "app Disconnected");
                GetHAL().onAppConfigEvent.emit(AppConfigEvent::AppDisconnected);
            }
        }

        std::string data;
        bool has_data = false;
        {
            std::lock_guard<std::mutex> lock(_mutex);
            if (!_msg_queue.empty()) {
                data = _msg_queue.front();
                _msg_queue.pop();
                has_data = true;
            }
        }

        if (has_data) {
            process_config_data(data.c_str());
        }
    }

private:
    static constexpr std::string_view _tag = "WifiConfigServer";
    std::queue<std::string> _msg_queue;
    std::mutex _mutex;
    bool _was_connected = false;
    std::atomic<bool> _is_wifi_connecting{false};
    std::unique_ptr<StackChanWifiStation> _wifi_station;

    void on_config_data(const char* json_data)
    {
        std::lock_guard<std::mutex> lock(_mutex);
        _msg_queue.push(json_data);
    }

    void process_config_data(const char* json_data)
    {
        ArduinoJson::JsonDocument doc;
        auto error = ArduinoJson::deserializeJson(doc, json_data);

        if (error) {
            mclog::tagError(_tag, "deserializeJson() failed: {}", error.c_str());
            return;
        }

        if (doc["cmd"] == "setWifi") {
            handle_set_wifi(doc["data"]);
        } else if (doc["cmd"] == "setWifiAudio") {
            handle_set_wifi_audio(doc["data"]);
        } else if (doc["cmd"] == "getWifiStatus") {
            handle_get_wifi_status();
        } else if (doc["cmd"] == "getWifiAudioStatus") {
            handle_get_wifi_audio_status();
        } else if (doc["cmd"] == "handshake") {
            std::string data = doc["data"].as<std::string>();
            handle_handshake(data);
        }
    }

    void handle_get_wifi_status()
    {
        if (_wifi_station->IsConnected()) {
            notify_state(1, "wifiConnected");
        } else if (_is_wifi_connecting) {
            notify_state(0, "wifiConnecting");
        } else {
            notify_state(3, "wifiDisconnected");
        }
    }

    void handle_get_wifi_audio_status()
    {
#if CONFIG_STACKCHAN_XIAOZHI_LOCAL_DOCK
        Settings wifi_settings("wifi", false);
        Settings local_settings("xiaozhi_local", false);
        const auto bootstrap_url = wifi_settings.GetString("ota_url");
        const auto local_token = local_settings.GetString("token");
        notify_state(6, !bootstrap_url.empty() && local_token.size() == 64 ? "xiaozhiLocalConfigured"
                                                                          : "xiaozhiLocalUnconfigured");
#else
        notify_state(6, stackchan_wifi_audio_transport_state());
#endif
    }

    void handle_set_wifi(ArduinoJson::JsonObject data)
    {
        if (_is_wifi_connecting) {
            mclog::tagWarn(_tag, "busy connecting, ignoring setWifi");
            notify_state(2, "wifiConnectFailed: Busy");
            return;
        }

        const char* ssid     = data["ssid"];
        const char* password = data["password"];
        if (ssid == nullptr || password == nullptr || ssid[0] == '\0') {
            mclog::tagWarn(_tag, "rejecting Wi-Fi configuration with missing fields");
            notify_state(2, "wifiConnectFailed: Invalid configuration");
            return;
        }

        mclog::tagInfo(_tag, "received Wi-Fi configuration for ssid={}", ssid);

        // Notify state: connecting
        notify_state(0, "wifiConnecting");
        GetHAL().onAppConfigEvent.emit(AppConfigEvent::TryWifiConnect);

        connect_wifi(ssid, password);
    }

    void handle_set_wifi_audio(ArduinoJson::JsonObject data)
    {
        const char* url = data["url"];
        const char* key = data["key"];
        const std::string_view url_value = url != nullptr ? std::string_view(url) : std::string_view();
#if CONFIG_STACKCHAN_XIAOZHI_LOCAL_DOCK
        const bool secure_endpoint = url_value.rfind("https://", 0) == 0;
#if CONFIG_STACKCHAN_XIAOZHI_LOCAL_ALLOW_INSECURE_HTTP
        const bool development_endpoint = url_value.rfind("http://", 0) == 0;
#else
        constexpr bool development_endpoint = false;
#endif
#else
        const bool secure_endpoint = url_value.rfind("wss://", 0) == 0;
#if CONFIG_STACKCHAN_WIFI_AUDIO_ALLOW_INSECURE_WS
        const bool development_endpoint = url_value.rfind("ws://", 0) == 0;
#else
        constexpr bool development_endpoint = false;
#endif
#endif
        if (url == nullptr || key == nullptr || url_value.size() > 192 || std::string_view(key).size() != 64 ||
            (!secure_endpoint && !development_endpoint)) {
            mclog::tagWarn(_tag, "rejecting invalid Wi-Fi Audio configuration");
            notify_state(5, "wifiAudioConfigFailed");
            return;
        }
        for (const char character : std::string_view(key)) {
            if (!((character >= '0' && character <= '9') || (character >= 'a' && character <= 'f') ||
                  (character >= 'A' && character <= 'F'))) {
                mclog::tagWarn(_tag, "rejecting Wi-Fi Audio key with invalid encoding");
                notify_state(5, "wifiAudioConfigFailed");
                return;
            }
        }

#if CONFIG_STACKCHAN_XIAOZHI_LOCAL_DOCK
        Settings wifi_settings("wifi", true);
        wifi_settings.SetString("ota_url", url);
        Settings local_settings("xiaozhi_local", true);
        local_settings.SetString("token", key);
        mclog::tagInfo(_tag, "XiaoZhi local Dock bootstrap configuration updated");
#else
        Settings settings("wifi_audio", true);
        settings.SetString("url", url);
        settings.SetString("key", key);
        settings.SetBool("configured", true);
        mclog::tagInfo(_tag, "Wi-Fi Audio receiver configuration updated");
#endif
        notify_state(5, "wifiAudioConfigured");
    }

    void handle_handshake(std::string_view data)
    {
        auto token = secret_logic::generate_handshake_token(data);
        notify_state(4, token.c_str());
    }

    void connect_wifi(const char* ssid, const char* password)
    {
        // Save to NVS (compatible with Xiaozhi) and connect
        _wifi_station->AddAuth(ssid, password);
    }

    void notify_state(int type, const char* state)
    {
        ArduinoJson::JsonDocument doc;
        doc["cmd"]           = "notifyState";
        doc["data"]["type"]  = type;
        doc["data"]["state"] = state;

        std::string json_str;
        ArduinoJson::serializeJson(doc, json_str);
        stackchan_ble_notify_config(json_str.c_str(), json_str.length());
    }
};

class AppConfigServerWorker : public mooncake::BasicAbility {
public:
    void onCreate() override
    {
        _server = std::make_unique<WifiConfigServer>();
        _server->init();
    }

    void onRunning() override
    {
        if (GetHAL().millis() - _last_tick < 50) {
            return;
        }
        _last_tick = GetHAL().millis();
        _server->update();
    }

    void onDestroy() override
    {
        _server.reset();
    }

private:
    std::unique_ptr<WifiConfigServer> _server;
    uint32_t _last_tick = 0;
};

#if CONFIG_STACKCHAN_WIFI_AUDIO_MVP
std::unique_ptr<WifiConfigServer> s_wifi_audio_config_server;

void wifi_audio_config_task(void*)
{
    while (true) {
        if (s_wifi_audio_config_server) {
            s_wifi_audio_config_server->update();
        }
        vTaskDelay(pdMS_TO_TICKS(50));
    }
}
#endif

void Hal::startAppConfigServer()
{
    mclog::tagInfo(_tag, "start app config server");

    ble_init(true);

#if CONFIG_STACKCHAN_WIFI_AUDIO_MVP
    // The isolated Wi-Fi Audio runtime does not install the regular Mooncake
    // app loop. Keep configuration independent so BLE writes are processed
    // while network startup is waiting in its own task.
    if (!s_wifi_audio_config_server) {
        s_wifi_audio_config_server = std::make_unique<WifiConfigServer>();
        s_wifi_audio_config_server->init();
        if (xTaskCreate(wifi_audio_config_task, "wifi_audio_config", 4096, nullptr, 4, nullptr) != pdPASS) {
            s_wifi_audio_config_server.reset();
            mclog::tagError(_tag, "failed to create Wi-Fi Audio config task");
        }
    }
#else
    mooncake::GetMooncake().extensionManager()->createAbility(std::make_unique<AppConfigServerWorker>());
#endif
}

bool Hal::isAppConfiged()
{
    Settings settings("app_config", false);
    return settings.GetBool("is_configed", false);
}

void Hal::resetAppConfiged()
{
    Settings settings("app_config", true);
    settings.SetBool("is_configed", false);
}

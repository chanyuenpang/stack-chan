/*
 * Dev-only LAN HTTP control endpoint.
 * Build with -DSTACKCHAN_ENABLE_DEV_LOCAL_HTTP_CONTROL=ON to enable this endpoint.
 */
#include "hal_dev_local_control.h"

#ifdef STACKCHAN_ENABLE_DEV_LOCAL_HTTP_CONTROL

#include "hal_device_control.h"

#include <esp_err.h>
#include <esp_http_server.h>
#include <esp_log.h>
#include <esp_netif.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>

#include <cstring>
#include <string>

#ifndef STACKCHAN_DEV_LOCAL_CONTROL_TOKEN
#define STACKCHAN_DEV_LOCAL_CONTROL_TOKEN "stackchan-dev"
#endif

namespace {

constexpr const char* TAG = "DEV-HTTP";
constexpr int kDevHttpPort = 18080;
constexpr int kMaxBodyBytes = 1024;
constexpr const char* kTokenHeader = "X-StackChan-Dev-Token";
httpd_handle_t g_server = nullptr;

const char* status_text(int status)
{
    switch (status) {
        case 200: return "200 OK";
        case 400: return "400 Bad Request";
        case 401: return "401 Unauthorized";
        case 409: return "409 Conflict";
        case 413: return "413 Payload Too Large";
        default: return "500 Internal Server Error";
    }
}

void send_json(httpd_req_t* req, int status, const char* body)
{
    httpd_resp_set_status(req, status_text(status));
    httpd_resp_set_type(req, "application/json");
    httpd_resp_sendstr(req, body);
}

void send_error(httpd_req_t* req, int status, const char* error)
{
    std::string body = std::string("{\"ok\":false,\"error\":\"") + (error ? error : "unknown_error") + "\"}";
    send_json(req, status, body.c_str());
}

bool check_token(httpd_req_t* req)
{
    const size_t token_len = httpd_req_get_hdr_value_len(req, kTokenHeader);
    if (token_len == 0 || token_len >= 96) {
        return false;
    }

    char token[96] = {};
    if (httpd_req_get_hdr_value_str(req, kTokenHeader, token, sizeof(token)) != ESP_OK) {
        return false;
    }
    return std::strcmp(token, STACKCHAN_DEV_LOCAL_CONTROL_TOKEN) == 0;
}

bool read_body(httpd_req_t* req, std::string& body)
{
    if (req->content_len > kMaxBodyBytes) {
        return false;
    }

    body.resize(req->content_len);
    int received = 0;
    while (received < req->content_len) {
        int ret = httpd_req_recv(req, body.data() + received, req->content_len - received);
        if (ret <= 0) {
            if (ret == HTTPD_SOCK_ERR_TIMEOUT) {
                continue;
            }
            return false;
        }
        received += ret;
    }
    return true;
}

int map_error_status(const char* error)
{
    if (!error) {
        return 500;
    }
    if (std::strcmp(error, "invalid_json") == 0 || std::strcmp(error, "missing_tool") == 0 ||
        std::strcmp(error, "unknown_tool") == 0 || std::strcmp(error, "unknown_command") == 0 ||
        std::strcmp(error, "invalid_sample") == 0 || std::strcmp(error, "invalid_explicit_stop") == 0 ||
        std::strcmp(error, "confirm_required") == 0 || std::strcmp(error, "missing_sound") == 0 ||
        std::strcmp(error, "unknown_sound") == 0) {
        return 400;
    }
    if (std::strcmp(error, "not_ready") == 0 || std::strcmp(error, "inject_already_active") == 0 ||
        std::strcmp(error, "celebrate_failed") == 0 || std::strcmp(error, "avatar_unavailable") == 0) {
        return 409;
    }
    return 500;
}

esp_err_t dispatch_request(httpd_req_t* req, const char* command, const char* body_json)
{
    DeviceControlResult result = dispatch_device_control(command, body_json);
    if (!result.success) {
        send_error(req, map_error_status(result.error_message.c_str()), result.error_message.c_str());
        return ESP_OK;
    }
    send_json(req, 200, result.result_json.empty() ? "{\"ok\":true}" : result.result_json.c_str());
    return ESP_OK;
}

esp_err_t status_handler(httpd_req_t* req)
{
    if (!check_token(req)) {
        send_error(req, 401, "unauthorized");
        return ESP_OK;
    }
    return dispatch_request(req, "status", nullptr);
}

esp_err_t wake_handler(httpd_req_t* req)
{
    if (!check_token(req)) {
        send_error(req, 401, "unauthorized");
        return ESP_OK;
    }
    return dispatch_request(req, "wake", nullptr);
}

esp_err_t stop_handler(httpd_req_t* req)
{
    if (!check_token(req)) {
        send_error(req, 401, "unauthorized");
        return ESP_OK;
    }
    return dispatch_request(req, "stop", nullptr);
}

esp_err_t toggle_handler(httpd_req_t* req)
{
    if (!check_token(req)) {
        send_error(req, 401, "unauthorized");
        return ESP_OK;
    }
    return dispatch_request(req, "toggle", nullptr);
}

esp_err_t celebrate_handler(httpd_req_t* req)
{
    if (!check_token(req)) {
        send_error(req, 401, "unauthorized");
        return ESP_OK;
    }
    std::string body;
    if (!read_body(req, body)) {
        send_error(req, req->content_len > kMaxBodyBytes ? 413 : 400, req->content_len > kMaxBodyBytes ? "body_too_large" : "body_read_failed");
        return ESP_OK;
    }
    return dispatch_request(req, "celebrate", body.empty() ? nullptr : body.c_str());
}

esp_err_t inject_prompt_handler(httpd_req_t* req)
{
    if (!check_token(req)) {
        send_error(req, 401, "unauthorized");
        return ESP_OK;
    }
    std::string body;
    if (!read_body(req, body)) {
        send_error(req, req->content_len > kMaxBodyBytes ? 413 : 400, req->content_len > kMaxBodyBytes ? "body_too_large" : "body_read_failed");
        return ESP_OK;
    }
    return dispatch_request(req, "inject_prompt", body.empty() ? nullptr : body.c_str());
}

esp_err_t play_sound_handler(httpd_req_t* req)
{
    if (!check_token(req)) {
        send_error(req, 401, "unauthorized");
        return ESP_OK;
    }
    std::string body;
    if (!read_body(req, body)) {
        send_error(req, req->content_len > kMaxBodyBytes ? 413 : 400, req->content_len > kMaxBodyBytes ? "body_too_large" : "body_read_failed");
        return ESP_OK;
    }
    return dispatch_request(req, "play_sound", body.empty() ? nullptr : body.c_str());
}

esp_err_t prompt_sample_handler(httpd_req_t* req)
{
    if (!check_token(req)) {
        send_error(req, 401, "unauthorized");
        return ESP_OK;
    }
    std::string body;
    if (!read_body(req, body)) {
        send_error(req, req->content_len > kMaxBodyBytes ? 413 : 400, req->content_len > kMaxBodyBytes ? "body_too_large" : "body_read_failed");
        return ESP_OK;
    }
    return dispatch_request(req, "prompt_sample", body.empty() ? nullptr : body.c_str());
}

esp_err_t reboot_handler(httpd_req_t* req)
{
    if (!check_token(req)) {
        send_error(req, 401, "unauthorized");
        return ESP_OK;
    }
    std::string body;
    if (!read_body(req, body)) {
        send_error(req, req->content_len > kMaxBodyBytes ? 413 : 400, req->content_len > kMaxBodyBytes ? "body_too_large" : "body_read_failed");
        return ESP_OK;
    }
    return dispatch_request(req, "reboot", body.empty() ? nullptr : body.c_str());
}

esp_err_t mcp_call_handler(httpd_req_t* req)
{
    if (!check_token(req)) {
        send_error(req, 401, "unauthorized");
        return ESP_OK;
    }
    std::string body;
    if (!read_body(req, body)) {
        send_error(req, req->content_len > kMaxBodyBytes ? 413 : 400, req->content_len > kMaxBodyBytes ? "body_too_large" : "body_read_failed");
        return ESP_OK;
    }
    return dispatch_request(req, "mcp_call", body.empty() ? nullptr : body.c_str());
}

void register_uri(const char* uri, httpd_method_t method, esp_err_t (*handler)(httpd_req_t*))
{
    httpd_uri_t route = {};
    route.uri = uri;
    route.method = method;
    route.handler = handler;
    route.user_ctx = nullptr;
    httpd_register_uri_handler(g_server, &route);
}

static void do_start_server()
{
    if (g_server != nullptr) {
        return;
    }

    register_default_device_control_handlers();

    httpd_config_t config = HTTPD_DEFAULT_CONFIG();
    config.server_port = kDevHttpPort;
    config.ctrl_port = kDevHttpPort + 1;
    config.uri_match_fn = httpd_uri_match_wildcard;

    esp_err_t err = httpd_start(&g_server, &config);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "dev local HTTP server failed to start on port %d: %s", kDevHttpPort, esp_err_to_name(err));
        g_server = nullptr;
        return;
    }

    register_uri("/dev/status", HTTP_GET, status_handler);
    register_uri("/dev/wake", HTTP_POST, wake_handler);
    register_uri("/dev/stop", HTTP_POST, stop_handler);
    register_uri("/dev/toggle", HTTP_POST, toggle_handler);
    register_uri("/dev/celebrate", HTTP_POST, celebrate_handler);
    register_uri("/dev/play_sound", HTTP_POST, play_sound_handler);
    register_uri("/dev/inject_prompt", HTTP_POST, inject_prompt_handler);
    register_uri("/dev/prompt_sample", HTTP_POST, prompt_sample_handler);
    register_uri("/dev/reboot", HTTP_POST, reboot_handler);
    register_uri("/dev/mcp/call", HTTP_POST, mcp_call_handler);

    ESP_LOGW(TAG, "DEV local HTTP control enabled on port %d", kDevHttpPort);
}

static bool sta_has_ip()
{
    esp_netif_t* netif = esp_netif_get_handle_from_ifkey("WIFI_STA_DEF");
    if (!netif) {
        return false;
    }

    esp_netif_ip_info_t ip_info;
    return esp_netif_get_ip_info(netif, &ip_info) == ESP_OK && ip_info.ip.addr != 0;
}

static void http_deferred_start_task(void*)
{
    constexpr int kMaxWaitMs = 60000;
    constexpr int kPollIntervalMs = 500;

    for (int waited = 0; waited < kMaxWaitMs; waited += kPollIntervalMs) {
        vTaskDelay(pdMS_TO_TICKS(kPollIntervalMs));
        if (sta_has_ip()) {
            do_start_server();
            vTaskDelete(nullptr);
            return;
        }
    }

    ESP_LOGW(TAG, "HTTP deferred start timed out after %d ms before STA IP, giving up", kMaxWaitMs);
    vTaskDelete(nullptr);
}

}  // namespace

void start_dev_local_control_server()
{
    xTaskCreatePinnedToCore(http_deferred_start_task, "http_defer", 4096, nullptr, tskIDLE_PRIORITY + 2, nullptr, 0);
}

#else

void start_dev_local_control_server() {}

#endif

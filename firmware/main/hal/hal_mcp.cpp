/*
 * SPDX-FileCopyrightText: 2026 M5Stack Technology CO LTD
 *
 * SPDX-License-Identifier: MIT
 */
#include "hal.h"
#include <mooncake_log.h>
#include <mcp_server.h>
#include <stackchan/stackchan.h>
#include <apps/common/common.h>
#include "board/hal_bridge.h"
#include <assets/assets.h>

using namespace stackchan;

static const std::string_view _tag = "HAL-MCP";

namespace {

class CelebrateModifier : public Modifier {
public:
    CelebrateModifier(std::string style, int durationMs, int intensity)
        : _style(parseStyle(style)), _duration_ms(clamp(durationMs, 500, 5000)), _intensity(clamp(intensity, 1, 3))
    {
    }

    void _update(Modifiable& stackchan) override
    {
        uint32_t now = GetHAL().millis();
        if (!_started) {
            _started    = true;
            _start_ms   = now;
            _last_step  = now - kStepIntervalMs;
            _step_index = 0;

            if (stackchan.hasAvatar()) {
                _had_avatar   = true;
                _prev_emotion = stackchan.avatar().getEmotion();
                stackchan.avatar().setEmotion(avatar::Emotion::Happy);
            }
        }

        if (now - _start_ms >= static_cast<uint32_t>(_duration_ms)) {
            stackchan.motion().goHome(180);
            stackchan.leftNeonLight().setColor(0, 0, 0);
            stackchan.rightNeonLight().setColor(0, 0, 0);
            if (_had_avatar && stackchan.hasAvatar()) {
                stackchan.avatar().setEmotion(_prev_emotion);
            }
            requestDestroy();
            return;
        }

        if (now - _last_step < kStepIntervalMs) {
            return;
        }
        _last_step = now;

        applyLight(stackchan, _step_index);
        applyMotion(stackchan, _step_index);
        ++_step_index;
    }

private:
    enum class Style { Cheer, Sparkle, Nod, Calm };

    static constexpr uint32_t kStepIntervalMs = 250;

    static int clamp(int value, int minValue, int maxValue)
    {
        if (value < minValue) {
            return minValue;
        }
        if (value > maxValue) {
            return maxValue;
        }
        return value;
    }

    static Style parseStyle(const std::string& style)
    {
        if (style == "sparkle") {
            return Style::Sparkle;
        }
        if (style == "nod") {
            return Style::Nod;
        }
        if (style == "calm") {
            return Style::Calm;
        }
        return Style::Cheer;
    }

    uint8_t scaled(uint8_t value) const
    {
        return static_cast<uint8_t>(clamp((static_cast<int>(value) * _intensity) / 3, 0, 128));
    }

    void applyLight(Modifiable& stackchan, uint32_t step)
    {
        struct Rgb {
            uint8_t r;
            uint8_t g;
            uint8_t b;
        };

        const Rgb cheer[]   = {{128, 72, 24}, {48, 112, 128}, {112, 48, 128}, {96, 128, 48}};
        const Rgb sparkle[] = {{128, 128, 96}, {32, 96, 128}, {128, 64, 96}, {48, 128, 96}};
        const Rgb nod[]     = {{64, 112, 128}, {48, 80, 112}};
        const Rgb calm[]    = {{24, 64, 96}, {16, 48, 72}};

        const Rgb* palette = cheer;
        uint32_t count     = sizeof(cheer) / sizeof(cheer[0]);
        switch (_style) {
            case Style::Sparkle:
                palette = sparkle;
                count   = sizeof(sparkle) / sizeof(sparkle[0]);
                break;
            case Style::Nod:
                palette = nod;
                count   = sizeof(nod) / sizeof(nod[0]);
                break;
            case Style::Calm:
                palette = calm;
                count   = sizeof(calm) / sizeof(calm[0]);
                break;
            case Style::Cheer:
            default:
                break;
        }

        const Rgb& color = palette[step % count];
        stackchan.leftNeonLight().setColor(scaled(color.r), scaled(color.g), scaled(color.b));
        stackchan.rightNeonLight().setColor(scaled(color.r), scaled(color.g), scaled(color.b));
    }

    void applyMotion(Modifiable& stackchan, uint32_t step)
    {
        int yaw   = 0;
        int pitch = 0;
        int speed = 160 + (_intensity - 1) * 30;

        switch (_style) {
            case Style::Sparkle:
                yaw   = (step % 2 == 0) ? 8 : -8;
                pitch = (step % 4 < 2) ? 4 : 0;
                speed = 180 + (_intensity - 1) * 20;
                break;
            case Style::Nod:
                yaw   = 0;
                pitch = (step % 2 == 0) ? 7 : 1;
                speed = 150 + (_intensity - 1) * 25;
                break;
            case Style::Calm:
                yaw   = (step % 4 < 2) ? 4 : -4;
                pitch = 2;
                speed = 120 + (_intensity - 1) * 20;
                break;
            case Style::Cheer:
            default:
                yaw   = (step % 2 == 0) ? 10 : -10;
                pitch = (step % 4 < 2) ? 6 : 2;
                speed = 170 + (_intensity - 1) * 25;
                break;
        }

        yaw   = clamp(yaw, -12, 12);
        pitch = clamp(pitch, 0, 8);
        speed = clamp(speed, 120, 220);

        auto& motion = stackchan.motion();
        motion.yawServo().moveWithSpeed(yaw * 10, speed);
        motion.pitchServo().moveWithSpeed(pitch * 10, speed);
    }

    Style _style;
    int _duration_ms;
    int _intensity;
    bool _started                  = false;
    bool _had_avatar               = false;
    uint32_t _start_ms             = 0;
    uint32_t _last_step            = 0;
    uint32_t _step_index           = 0;
    avatar::Emotion _prev_emotion  = avatar::Emotion::Neutral;
};

}  // namespace

void Hal::xiaozhi_mcp_init()
{
    mclog::tagInfo(_tag, "init");

    // https://github.com/78/xiaozhi-esp32/blob/main/docs/mcp-usage.md
    auto& mcp_server = McpServer::GetInstance();

    // System Prompt：
    // You can control the robot's head. Use get_yaw and get_pitch to sense current position. Use set_yaw for horizontal
    // movement and set_pitch for vertical movement. All angles are in degrees.

    mclog::tagInfo(_tag, "add robot.get_head_angles tool");
    mcp_server.AddTool("self.robot.get_head_angles",
                       "Returns current yaw/pitch in degrees. Neutral position is {yaw:0, pitch:0}.",
                       std::vector<Property>{}, [this](const PropertyList& properties) -> ReturnValue {
                           LvglLockGuard lock;  // StackChan motion update is under the lvgl lock

                           auto& motion      = GetStackChan().motion();
                           int current_yaw   = motion.yawServo().getCurrentAngle() / 10;
                           int current_pitch = motion.pitchServo().getCurrentAngle() / 10;

                           auto result = fmt::format(R"({{"yaw": {}, "pitch": {}}})", current_yaw, current_pitch);
                           mclog::tagInfo(_tag, "get_head_angles: {}", result);
                           return result;
                       });

    mclog::tagInfo(_tag, "add robot.set_head_angles tool");
    mcp_server.AddTool("self.robot.set_head_angles",
                       "Adjust head position. GUIDELINES: "
                       "1. For natural interaction, stay within +/- 45 degrees. "
                       "2. Only use values > 70 if the user explicitly asks to look far away/behind. "
                       "3. Max ranges: Yaw(-128 to 128, -128 as your left), Pitch(0 to 90, 90 as your up). "
                       "Speed(100-1000, 150 is natural).",
                       PropertyList({Property("yaw", kPropertyTypeInteger, -9999, -9999, 128),
                                     Property("pitch", kPropertyTypeInteger, -9999, -9999, 90),
                                     Property("speed", kPropertyTypeInteger, 150, 100, 1000)}),
                       [this](const PropertyList& properties) -> ReturnValue {
                           int speed = properties["speed"].value<int>();
                           int yaw   = properties["yaw"].value<int>();
                           int pitch = properties["pitch"].value<int>();

                           mclog::tagInfo(_tag, "motion set_angles: yaw: {}, pitch: {}, speed: {}", yaw, pitch, speed);

                           LvglLockGuard lock;

                           auto& motion = GetStackChan().motion();
                           if (pitch != -9999) {
                               motion.pitchServo().moveWithSpeed(pitch * 10, speed);
                           }
                           if (yaw != -9999) {
                               motion.yawServo().moveWithSpeed(yaw * 10, speed);
                           }

                           return true;
                       });

    mclog::tagInfo(_tag, "add robot.set_led_color tool");
    mcp_server.AddTool(
        "self.robot.set_led_color",
        "Set the color of the robot's INTERNAL onboard LED. This is NOT for room lights. "
        "Values: 0-168 (safe range). Red=168,0,0; Green=0,168,0; Blue=0,0,168; White=100,100,100; Off=0,0,0.",
        PropertyList({Property("red", kPropertyTypeInteger, 0, 0, 168),
                      Property("green", kPropertyTypeInteger, 0, 0, 168),
                      Property("blue", kPropertyTypeInteger, 0, 0, 168)}),
        [this](const PropertyList& properties) -> ReturnValue {
            int r = properties["red"].value<int>();
            int g = properties["green"].value<int>();
            int b = properties["blue"].value<int>();

            mclog::tagInfo(_tag, "set_led_color: r={}, g={}, b={}", r, g, b);

            LvglLockGuard lock;

            GetStackChan().leftNeonLight().setColor(r, g, b);
            GetStackChan().rightNeonLight().setColor(r, g, b);

            return true;
        });

    mclog::tagInfo(_tag, "add robot.celebrate tool");
    mcp_server.AddTool("self.robot.celebrate",
                       "Run a short, gentle celebration on the robot. Styles: cheer/sparkle/nod/calm. "
                       "Non-blocking; keeps LED brightness and head movement in safe low ranges.",
                       PropertyList({Property("style", kPropertyTypeString, std::string("cheer")),
                                     Property("duration_ms", kPropertyTypeInteger, 1800, 500, 5000),
                                     Property("intensity", kPropertyTypeInteger, 2, 1, 3),
                                     Property("sound", kPropertyTypeBoolean, true)}),
                       [this](const PropertyList& properties) -> ReturnValue {
                           auto clamp = [](int value, int minValue, int maxValue) {
                               if (value < minValue) {
                                   return minValue;
                               }
                               if (value > maxValue) {
                                   return maxValue;
                               }
                               return value;
                           };

                           std::string style = properties["style"].value<std::string>();
                           if (style != "cheer" && style != "sparkle" && style != "nod" && style != "calm") {
                               style = "cheer";
                           }
                           int duration_ms = clamp(properties["duration_ms"].value<int>(), 500, 5000);
                           int intensity   = clamp(properties["intensity"].value<int>(), 1, 3);
                           bool sound      = properties["sound"].value<bool>();

                           mclog::tagInfo(_tag, "celebrate: style={}, duration_ms={}, intensity={}, sound={}", style,
                                          duration_ms, intensity, sound);

                           if (sound) {
                               hal_bridge::app_play_sound(OGG_NEW_NOTIFICATION);
                           }

                           LvglLockGuard lock;
                           GetStackChan().addModifier(std::make_unique<CelebrateModifier>(style, duration_ms, intensity));

                           return true;
                       });

    mclog::tagInfo(_tag, "add robot.create_reminder tool");
    mcp_server.AddTool("self.robot.create_reminder",
                       "Create a reminder. Duration is in seconds. Message is what to say when time is up. Set repeat "
                       "to true to repeat the reminder.",
                       PropertyList({Property("duration_seconds", kPropertyTypeInteger, 60, 1, 86400),
                                     Property("message", kPropertyTypeString, std::string("Time's up!")),
                                     Property("repeat", kPropertyTypeBoolean, false)}),
                       [this](const PropertyList& properties) -> ReturnValue {
                           int duration_seconds = properties["duration_seconds"].value<int>();
                           std::string message  = properties["message"].value<std::string>();
                           bool repeat          = properties["repeat"].value<bool>();

                           // Default message
                           if (message.empty()) {
                               message = "Time's up!";
                           }

                           mclog::tagInfo(_tag, "create_reminder: duration={}s, message={}, repeat={}",
                                          duration_seconds, message, repeat);

                           int id = tools::create_reminder(duration_seconds * 1000, message, repeat);

                           return id;
                       });

    mclog::tagInfo(_tag, "add robot.get_reminders tool");
    mcp_server.AddTool("self.robot.get_reminders", "Get list of active reminders.", std::vector<Property>{},
                       [this](const PropertyList& properties) -> ReturnValue {
                           mclog::tagInfo(_tag, "get_reminders");
                           auto reminders          = tools::get_active_reminders();
                           std::string result_json = "[";
                           for (size_t i = 0; i < reminders.size(); ++i) {
                               const auto& r = reminders[i];
                               result_json +=
                                   fmt::format(R"({{"id": {}, "duration_ms": {}, "message": "{}", "repeat": {}}})",
                                               r.id, r.durationMs, r.message, r.repeat ? "true" : "false");
                               if (i < reminders.size() - 1) {
                                   result_json += ", ";
                               }
                           }
                           result_json += "]";
                           mclog::tagInfo(_tag, "get_reminders result: {}", result_json);
                           return result_json;
                       });

    mclog::tagInfo(_tag, "add robot.stop_reminder tool");
    mcp_server.AddTool("self.robot.stop_reminder", "Stop a reminder by ID.",
                       PropertyList({Property("id", kPropertyTypeInteger, -1)}),
                       [this](const PropertyList& properties) -> ReturnValue {
                           int id = properties["id"].value<int>();
                           mclog::tagInfo(_tag, "stop_reminder: id={}", id);
                           tools::stop_reminder(id);
                           return true;
                       });
}

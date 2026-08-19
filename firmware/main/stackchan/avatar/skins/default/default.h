/*
 * SPDX-FileCopyrightText: 2026 M5Stack Technology CO LTD
 *
 * SPDX-License-Identifier: MIT
 */
#pragma once
#include "../../avatar/avatar.h"
#include "../../avatar/elements/feature.h"
#include <lvgl.h>
#include <smooth_lvgl.hpp>
#include <memory>
#include <string>
#include <deque>

namespace stackchan::avatar {

/**
 * @brief
 *
 */
class DefaultAvatar : public Avatar {
public:
    lv_color_t primaryColor   = lv_color_white();
    lv_color_t secondaryColor = lv_color_black();

    void init(lv_obj_t* parent, const lv_font_t* font = &lv_font_montserrat_16);
    uitk::lvgl_cpp::Container* getPanel() const;

private:
    std::unique_ptr<uitk::lvgl_cpp::Container> _pannel;
};

/**
 * @brief
 *
 */
class DefaultEyes : public Feature {
public:
    DefaultEyes(lv_obj_t* parent, lv_color_t primaryColor, lv_color_t secondaryColor, bool isLeftEye);
    ~DefaultEyes();

    void setPosition(const uitk::Vector2i& position) override;
    void setWeight(int weight) override;
    void setRotation(int rotation) override;
    void setEmotion(const Emotion& emotion) override;
    void setVisible(bool visible) override;
    void setSize(int size) override;

private:
    bool _is_left_eye    = false;
    int _eyelid_offset_y = 0;

    std::unique_ptr<uitk::lvgl_cpp::Container> _container;
    std::unique_ptr<uitk::lvgl_cpp::Container> _eye;
    std::unique_ptr<uitk::lvgl_cpp::Container> _eyelid;
};

/**
 * @brief
 *
 */
class DefaultMouth : public Feature {
public:
    DefaultMouth(lv_obj_t* parent, lv_color_t primaryColor, lv_color_t secondaryColor);
    ~DefaultMouth();

    void setPosition(const uitk::Vector2i& position) override;
    void setWeight(int weight) override;
    void setRotation(int rotation) override;
    void setVisible(bool visible) override;

private:
    std::unique_ptr<uitk::lvgl_cpp::Container> _mouth;
};

/**
 * @brief
 *
 */
class DefaultSpeechBubble : public SpeechBubble {
public:
    DefaultSpeechBubble(lv_obj_t* parent, lv_color_t primaryColor, lv_color_t secondaryColor, const lv_font_t* font);
    ~DefaultSpeechBubble();

    void setSpeech(std::string_view text) override;
    void clearSpeech() override;
    void setVisible(bool visible) override;
    void setTextFont(void* font) override;
    bool beginStreamingSpeech(uint32_t subtitle_id, std::string_view text) override;
    bool appendStreamingSpeech(uint32_t subtitle_id, std::string_view text, bool trim_after_append = false) override;
    bool trimStreamingSpeech(uint32_t subtitle_id) override;
    bool endStreamingSpeech(uint32_t subtitle_id) override;
    bool cancelStreamingSpeech(uint32_t subtitle_id) override;
    bool enqueueStreamingSpeech(uint32_t subtitle_id, std::string_view text) override;

private:
    void resetStreamingSpeech();
    void showStreamingSpeech(uint32_t subtitle_id, std::string_view text, bool ended = false);
    void updateStreamingLayout();
    bool trimStreamingPrefix();
    void advanceStreamingMarquee();

    std::unique_ptr<uitk::lvgl_cpp::Container> _container;
    std::unique_ptr<uitk::lvgl_cpp::Image> _arrow;
    std::unique_ptr<uitk::lvgl_cpp::Container> _bubble;
    std::unique_ptr<uitk::lvgl_cpp::Label> _text;
    std::string _streaming_text;
    uint32_t _streaming_subtitle_id = 0;
    uint32_t _streaming_offset_px = 0;
    int _streaming_cycle_width_px = 0;
    uint32_t _streaming_elapsed_ms = 0;
    bool _streaming_sentence_ended = false;
    // The active response can outlive its current visual pass.  Keep its ID
    // after the text has scrolled away so a delayed append can start a fresh
    // display without replaying the already-consumed text.
    bool _streaming_display_expired = false;
    bool _streaming_waiting_for_next = false;
    uint32_t _streaming_wait_elapsed_ms = 0;
    struct QueuedSubtitle { uint32_t id; std::string text; bool ended = false; };
    std::deque<QueuedSubtitle> _streaming_queue;
    lv_timer_t* _streaming_timer = nullptr;
};

}  // namespace stackchan::avatar

/*
 * SPDX-FileCopyrightText: 2026 M5Stack Technology CO LTD
 *
 * SPDX-License-Identifier: MIT
 */
#include "default.h"
#include "esp_log.h"
#include <algorithm>

using namespace uitk;
using namespace uitk::lvgl_cpp;
using namespace stackchan::avatar;

static const Vector2i _container_pos  = Vector2i(0, 89);
static const Vector2i _container_size = Vector2i(320, 74);
static const Vector2i _arrow_offset   = Vector2i(40, -15);
static const int _text_mx             = 20;
static const int _bubble_min_width    = 90;
static const int _bubble_max_width    = 340;
static const int _bubble_height       = 52;
static const int _bubble_min_offset_x = 66;
static const int _bubble_max_offset_x = 0;
static constexpr uint32_t kStreamingTickMs = 40;
static constexpr uint32_t kShortSentenceHoldMs = 1600;
static constexpr uint32_t kNextSentenceWaitMs = 1000;

LV_IMAGE_DECLARE(default_bubble_arrow);

DefaultSpeechBubble::DefaultSpeechBubble(lv_obj_t* parent, lv_color_t primaryColor, lv_color_t secondaryColor,
                                         const lv_font_t* font)
{
    _container = std::make_unique<Container>(parent);
    _container->setRadius(0);
    _container->setAlign(LV_ALIGN_CENTER);
    _container->setBorderWidth(0);
    _container->setBgOpa(0);
    _container->removeFlag(LV_OBJ_FLAG_SCROLLABLE);
    _container->setSize(_container_size.x, _container_size.y);
    _container->setPos(_container_pos.x, _container_pos.y);
    _container->setPadding(0, 0, 0, 0);

    _arrow = std::make_unique<Image>(_container->get());
    _arrow->setSrc(&default_bubble_arrow);
    _arrow->setAlign(LV_ALIGN_CENTER);
    _arrow->setPos(_arrow_offset.x, _arrow_offset.y);
    _arrow->setImageRecolorOpa(LV_OPA_COVER);
    _arrow->setImageRecolor(primaryColor);

    _bubble = std::make_unique<Container>(_container->get());
    _bubble->setRadius(LV_RADIUS_CIRCLE);
    _bubble->setAlign(LV_ALIGN_CENTER);
    _bubble->setBorderWidth(0);
    _bubble->setBgColor(primaryColor);
    _bubble->removeFlag(LV_OBJ_FLAG_SCROLLABLE);
    _bubble->setSize(_bubble_max_width, _bubble_height);
    _bubble->setPos(0, 11);

    _text = std::make_unique<Label>(_bubble->get());
    _text->setTextColor(secondaryColor);
    _text->setTextFont(font);
    _text->setTextAlign(LV_TEXT_ALIGN_CENTER);
    _text->setAlign(LV_ALIGN_CENTER);
    _text->setPos(0, 0);
    _text->setWidth(320 - _text_mx * 2);
    _text->setLongMode(LV_LABEL_LONG_MODE_SCROLL_CIRCULAR);

    _streaming_timer = lv_timer_create([](lv_timer_t* timer) {
        static_cast<DefaultSpeechBubble*>(lv_timer_get_user_data(timer))->advanceStreamingMarquee();
    }, 40, this);
    lv_timer_pause(_streaming_timer);

    clearSpeech();
}

DefaultSpeechBubble::~DefaultSpeechBubble()
{
    if (_streaming_timer) {
        lv_timer_delete(_streaming_timer);
        _streaming_timer = nullptr;
    }
    _text.reset();
    _bubble.reset();
    _arrow.reset();
    _container.reset();
}

void DefaultSpeechBubble::setSpeech(std::string_view text)
{
    resetStreamingSpeech();
    if (text.empty()) {
        clearSpeech();
        return;
    }

    _text->setText(text);

    lv_point_t text_size;
    lv_text_get_size(&text_size, text.data(), _text->getTextFont(), 0, 0, LV_COORD_MAX, LV_TEXT_FLAG_NONE);

    int bubble_width = min(text_size.x + _text_mx * 2, _bubble_max_width);
    bubble_width     = max(bubble_width, _bubble_min_width);

    auto bubble_offset_x =
        map_range(bubble_width, _bubble_min_width, _bubble_max_width, _bubble_min_offset_x, _bubble_max_offset_x);

    _bubble->setWidth(bubble_width);
    _bubble->setX(bubble_offset_x);

    setVisible(true);
}

void DefaultSpeechBubble::clearSpeech()
{
    resetStreamingSpeech();
    _text->setText("");
    setVisible(false);
}

void DefaultSpeechBubble::setVisible(bool visible)
{
    SpeechBubble::setVisible(visible);

    _container->setHidden(!visible);
}

void DefaultSpeechBubble::setTextFont(void* font)
{
    if (_text && font) {
        _text->setTextFont((lv_font_t*)font);
    }
}

bool DefaultSpeechBubble::beginStreamingSpeech(uint32_t subtitle_id, std::string_view text)
{
    if (text.empty()) {
        clearSpeech();
        return true;
    }

    _streaming_queue.clear();
    showStreamingSpeech(subtitle_id, text);
    return true;
}

bool DefaultSpeechBubble::enqueueStreamingSpeech(uint32_t subtitle_id, std::string_view text)
{
    if (subtitle_id == 0 || text.empty()) return false;
    if (_streaming_waiting_for_next) {
        showStreamingSpeech(subtitle_id, text);
        return true;
    }
    if (_streaming_text.empty()) return beginStreamingSpeech(subtitle_id, text);
    _streaming_queue.push_back({subtitle_id, std::string(text)});
    return true;
}

bool DefaultSpeechBubble::appendStreamingSpeech(uint32_t subtitle_id, std::string_view text, bool trim_after_append)
{
    if (subtitle_id == 0 || text.empty()) return false;
    if (subtitle_id == _streaming_subtitle_id) {
        if (_streaming_display_expired) {
            // An ended stream cannot be revived by a late delta. While the
            // stream is open it never becomes expired, so every accepted
            // same-ID append preserves the continuous text flow.
            return false;
        }
        _streaming_text.append(text);
        // A natural subtitle boundary is one visible commit.  When the host
        // requests a lazy trim, evaluate it after appending but before the one
        // final layout; do not create a second display update for the trim.
        if (trim_after_append) trimStreamingPrefix();
        updateStreamingLayout();
        // A transcript delta may arrive after the first marquee pass. The
        // sentence remains active until its explicit end, so resume it here.
        _streaming_elapsed_ms = 0;
        lv_timer_resume(_streaming_timer);
        lv_timer_reset(_streaming_timer);
        setVisible(true);
        return true;
    }
    for (auto& queued : _streaming_queue) {
        if (queued.id == subtitle_id) {
            queued.text.append(text);
            return true;
        }
    }
    return false;
}

bool DefaultSpeechBubble::trimStreamingSpeech(uint32_t subtitle_id)
{
    if (subtitle_id != _streaming_subtitle_id || _streaming_text.empty()) return false;

    if (!trimStreamingPrefix()) return true;
    updateStreamingLayout();
    return true;
}

bool DefaultSpeechBubble::trimStreamingPrefix()
{
    if (_streaming_text.empty()) return false;

    // Preserve every glyph still on screen. This method is intentionally
    // called only from a sparse visible subtitle commit, never from the 40 ms
    // marquee tick; discard complete UTF-8 code points already left of view.
    const uint32_t removable_px = _streaming_offset_px > _text_mx ? _streaming_offset_px - _text_mx : 0;
    size_t prefix_bytes = 0;
    int prefix_width_px = 0;
    while (prefix_bytes < _streaming_text.size()) {
        const auto lead = static_cast<unsigned char>(_streaming_text[prefix_bytes]);
        const size_t codepoint_bytes = (lead < 0x80) ? 1 :
            ((lead & 0xE0) == 0xC0) ? 2 : ((lead & 0xF0) == 0xE0) ? 3 : ((lead & 0xF8) == 0xF0) ? 4 : 1;
        if (prefix_bytes + codepoint_bytes > _streaming_text.size()) break;
        const std::string codepoint = _streaming_text.substr(prefix_bytes, codepoint_bytes);
        lv_point_t codepoint_size;
        lv_text_get_size(&codepoint_size, codepoint.c_str(), _text->getTextFont(), 0, 0, LV_COORD_MAX, LV_TEXT_FLAG_NONE);
        if (prefix_width_px + codepoint_size.x > static_cast<int>(removable_px)) break;
        prefix_bytes += codepoint_bytes;
        prefix_width_px += codepoint_size.x;
    }
    if (prefix_bytes == 0) return false;
    _streaming_text.erase(0, prefix_bytes);
    _streaming_offset_px = prefix_width_px >= static_cast<int>(_streaming_offset_px)
        ? 0 : _streaming_offset_px - static_cast<uint32_t>(prefix_width_px);
    return true;
}

bool DefaultSpeechBubble::endStreamingSpeech(uint32_t subtitle_id)
{
    if (subtitle_id == 0) return false;
    if (subtitle_id == _streaming_subtitle_id) {
        _streaming_sentence_ended = true;
        // The short-label hold starts at the authoritative response end, not
        // when its first transcript fragment happened to arrive.
        if (_streaming_cycle_width_px <= 0) _streaming_elapsed_ms = 0;
        lv_timer_resume(_streaming_timer);
        lv_timer_reset(_streaming_timer);
        return true;
    }
    for (auto& queued : _streaming_queue) {
        if (queued.id == subtitle_id) {
            queued.ended = true;
            return true;
        }
    }
    return false;
}

bool DefaultSpeechBubble::cancelStreamingSpeech(uint32_t subtitle_id)
{
    if (subtitle_id == 0) return false;
    bool cancelled = false;
    if (subtitle_id == _streaming_subtitle_id) {
        // Only retire the matching OPEN stream. Do not invoke clearSpeech() or
        // resetStreamingSpeech(): either would erase unrelated queued IDs.
        _streaming_text.clear();
        _streaming_subtitle_id = 0;
        _streaming_offset_px = 0;
        _streaming_cycle_width_px = 0;
        _streaming_elapsed_ms = 0;
        _streaming_sentence_ended = false;
        _streaming_display_expired = false;
        _streaming_waiting_for_next = false;
        _streaming_wait_elapsed_ms = 0;
        _text->setText("");
        setVisible(false);
        if (_streaming_timer) lv_timer_pause(_streaming_timer);
        cancelled = true;
    }
    const auto old_size = _streaming_queue.size();
    _streaming_queue.erase(std::remove_if(_streaming_queue.begin(), _streaming_queue.end(),
        [subtitle_id](const QueuedSubtitle& queued) { return queued.id == subtitle_id; }), _streaming_queue.end());
    return cancelled || _streaming_queue.size() != old_size;
}

void DefaultSpeechBubble::resetStreamingSpeech()
{
    _streaming_text.clear();
    _streaming_subtitle_id = 0;
    _streaming_offset_px = 0;
    _streaming_cycle_width_px = 0;
    _streaming_elapsed_ms = 0;
    _streaming_sentence_ended = false;
    _streaming_display_expired = false;
    _streaming_waiting_for_next = false;
    _streaming_wait_elapsed_ms = 0;
    _streaming_queue.clear();
    if (_streaming_timer) {
        lv_timer_pause(_streaming_timer);
    }
    _text->setLongMode(LV_LABEL_LONG_MODE_SCROLL_CIRCULAR);
    _text->setAlign(LV_ALIGN_CENTER);
    _text->setWidth(320 - _text_mx * 2);
    _text->setX(0);
}

void DefaultSpeechBubble::showStreamingSpeech(uint32_t subtitle_id, std::string_view text, bool ended)
{
    ESP_LOGI("SpeechBubble", "subtitle_timing show id=%" PRIu32, subtitle_id);
    _streaming_subtitle_id = subtitle_id;
    _streaming_text.assign(text);
    _streaming_offset_px = 0;
    _streaming_elapsed_ms = 0;
    _streaming_sentence_ended = ended;
    _streaming_display_expired = false;
    _streaming_waiting_for_next = false;
    _streaming_wait_elapsed_ms = 0;
    _text->setLongMode(LV_LABEL_LONG_MODE_CLIP);
    _text->setAlign(LV_ALIGN_LEFT_MID);
    updateStreamingLayout();
    lv_timer_resume(_streaming_timer);
    lv_timer_reset(_streaming_timer);
    setVisible(true);
}

void DefaultSpeechBubble::updateStreamingLayout()
{
    lv_point_t text_size;
    lv_text_get_size(&text_size, _streaming_text.c_str(), _text->getTextFont(), 0, 0, LV_COORD_MAX, LV_TEXT_FLAG_NONE);

    int bubble_width = min(text_size.x + _text_mx * 2, _bubble_max_width);
    bubble_width = max(bubble_width, _bubble_min_width);
    auto bubble_offset_x =
        map_range(bubble_width, _bubble_min_width, _bubble_max_width, _bubble_min_offset_x, _bubble_max_offset_x);
    _bubble->setWidth(bubble_width);
    _bubble->setX(bubble_offset_x);

    const int viewport_width = bubble_width - _text_mx * 2;
    if (text_size.x <= viewport_width) {
        _streaming_cycle_width_px = 0;
        _streaming_offset_px = 0;
        _text->setWidth(viewport_width);
        _text->setX(_text_mx);
        _text->setText(_streaming_text);
        return;
    }

    constexpr int kMarqueeGapPx = 28;
    _streaming_cycle_width_px = text_size.x + kMarqueeGapPx;
    _streaming_offset_px %= _streaming_cycle_width_px;
    _text->setText(_streaming_text);
    _text->setWidth(text_size.x);
    _text->setX(_text_mx - static_cast<int>(_streaming_offset_px));
}

void DefaultSpeechBubble::advanceStreamingMarquee()
{
    if (_streaming_waiting_for_next) {
        _streaming_wait_elapsed_ms += kStreamingTickMs;
        if (_streaming_wait_elapsed_ms >= kNextSentenceWaitMs) {
            _streaming_waiting_for_next = false;
            lv_timer_pause(_streaming_timer);
        }
        return;
    }
    if (_streaming_text.empty()) return;

    _streaming_elapsed_ms += kStreamingTickMs;
    bool complete = false;
    if (_streaming_cycle_width_px <= 0) {
        complete = _streaming_elapsed_ms >= kShortSentenceHoldMs;
    } else {
        // A sentence gets one pass only. Do not wrap and replay it while the
        // next sentence is waiting to arrive.
        _streaming_offset_px += 4;
        complete = _streaming_offset_px >= static_cast<uint32_t>(_streaming_cycle_width_px);
        if (!complete) _text->setX(_text_mx - static_cast<int>(_streaming_offset_px));
    }
    if (!complete) return;

    // Before an authoritative response_end, preserve the active stream and
    // its ID even after one visual pass. A delayed same-ID append must extend
    // the existing text, never restart from a fragment.
    if (!_streaming_sentence_ended) {
        lv_timer_pause(_streaming_timer);
        return;
    }

    // A long label may expire only after its complete text leaves the
    // viewport and response_end has arrived. A short label's hold likewise
    // begins only after response_end.
    if (_streaming_queue.empty()) {
        _streaming_text.clear();
        _streaming_offset_px = 0;
        _streaming_cycle_width_px = 0;
        _streaming_elapsed_ms = 0;
        _streaming_display_expired = true;
        _text->setText("");
        setVisible(false);
        lv_timer_pause(_streaming_timer);
        return;
    }

    auto next = std::move(_streaming_queue.front());
    _streaming_queue.pop_front();
    showStreamingSpeech(next.id, next.text, next.ended);
}

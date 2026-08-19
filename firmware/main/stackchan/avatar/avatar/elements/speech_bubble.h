/*
 * SPDX-FileCopyrightText: 2026 M5Stack Technology CO LTD
 *
 * SPDX-License-Identifier: MIT
 */
#pragma once
#include "element.h"
#include <string_view>
#include <string>
#include <cstdint>

namespace stackchan::avatar {

/**
 * @brief Speech bubble base class
 *
 */
class SpeechBubble : public Element {
public:
    virtual ~SpeechBubble() = default;

    virtual void setSpeech(std::string_view text)
    {
    }

    virtual void clearSpeech()
    {
    }

    virtual void setTextFont(void* font)
    {
    }

    // The local Dock sends completed sentences. Skins that opt in queue those
    // sentences and own their display lifetime independently of audio.
    virtual bool beginStreamingSpeech(uint32_t subtitle_id, std::string_view text)
    {
        (void)subtitle_id;
        setSpeech(text);
        return true;
    }

    virtual bool appendStreamingSpeech(uint32_t subtitle_id, std::string_view text, bool trim_after_append = false)
    {
        (void)subtitle_id;
        (void)text;
        (void)trim_after_append;
        return false;
    }

    virtual bool trimStreamingSpeech(uint32_t subtitle_id)
    {
        (void)subtitle_id;
        return false;
    }

    virtual bool endStreamingSpeech(uint32_t subtitle_id)
    {
        (void)subtitle_id;
        return true;
    }

    virtual bool cancelStreamingSpeech(uint32_t subtitle_id)
    {
        (void)subtitle_id;
        return false;
    }

    virtual bool enqueueStreamingSpeech(uint32_t subtitle_id, std::string_view text)
    {
        (void)subtitle_id;
        setSpeech(text);
        return true;
    }
};

}  // namespace stackchan::avatar

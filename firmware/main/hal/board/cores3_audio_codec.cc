#include "cores3_audio_codec.h"

#include <esp_err.h>
#include <esp_log.h>
#include <driver/i2c_master.h>
#include <driver/i2s_std.h>
#include <driver/i2s_tdm.h>
#include <freertos/FreeRTOS.h>

#include <cstring>

#define TAG "CoreS3AudioCodec"

#if (defined(CONFIG_STACKCHAN_WIFI_AUDIO_MVP) && CONFIG_STACKCHAN_WIFI_AUDIO_MVP) || \
    (defined(CONFIG_STACKCHAN_WIFI_AUDIO_RX_ONLY_DIAGNOSTIC) && CONFIG_STACKCHAN_WIFI_AUDIO_RX_ONLY_DIAGNOSTIC)
#define STACKCHAN_CORES3_RAW_FOUR_SLOT_INPUT 1
#else
#define STACKCHAN_CORES3_RAW_FOUR_SLOT_INPUT 0
#endif

#if defined(CONFIG_STACKCHAN_WIFI_AUDIO_MVP) && CONFIG_STACKCHAN_WIFI_AUDIO_MVP
#define STACKCHAN_CORES3_WIFI_SINGLE_OWNER 1
#else
#define STACKCHAN_CORES3_WIFI_SINGLE_OWNER 0
#endif

CoreS3AudioCodec::CoreS3AudioCodec(void* i2c_master_handle, int input_sample_rate, int output_sample_rate,
    gpio_num_t mclk, gpio_num_t bclk, gpio_num_t ws, gpio_num_t dout, gpio_num_t din,
    uint8_t aw88298_addr, uint8_t es7210_addr, bool input_reference) {
    mclk_ = mclk;
    bclk_ = bclk;
    ws_ = ws;
    dout_ = dout;
    din_ = din;
#if STACKCHAN_CORES3_WIFI_SINGLE_OWNER
    duplex_ = false;
    input_reference_ = false;
#else
    duplex_ = true; // 是否双工
    input_reference_ = input_reference; // 是否使用参考输入，实现回声消除
#endif
#if STACKCHAN_CORES3_RAW_FOUR_SLOT_INPUT
    input_channels_ = 4;
#else
    input_channels_ = input_reference_ ? 2 : 1; // 输入通道数
#endif
    input_sample_rate_ = input_sample_rate;
    output_sample_rate_ = output_sample_rate;
#if defined(CONFIG_STACKCHAN_WIFI_AUDIO_RX_ONLY_DIAGNOSTIC) && CONFIG_STACKCHAN_WIFI_AUDIO_RX_ONLY_DIAGNOSTIC
    input_gain_ = 30;
#else
    // The decisive RX-only capture established 30 dB as a clean, usable
    // baseline. Keep product mode on that verified gain while restoring TX.
    input_gain_ = 30;
#endif

#if !STACKCHAN_CORES3_WIFI_SINGLE_OWNER
    CreateDuplexChannels(mclk, bclk, ws, dout, din);

    audio_codec_i2s_cfg_t i2s_cfg = {
        .port = I2S_NUM_0,
        .rx_handle = rx_handle_,
        .tx_handle = tx_handle_,
    };
    data_if_ = audio_codec_new_i2s_data(&i2s_cfg);
    assert(data_if_ != NULL);
#endif

    // Audio Output(Speaker)
    audio_codec_i2c_cfg_t i2c_cfg = {
        .port = (i2c_port_t)1,
        .addr = aw88298_addr,
        .bus_handle = i2c_master_handle,
    };
    out_ctrl_if_ = audio_codec_new_i2c_ctrl(&i2c_cfg);
    assert(out_ctrl_if_ != NULL);

    gpio_if_ = audio_codec_new_gpio();
    assert(gpio_if_ != NULL);

    aw88298_codec_cfg_t aw88298_cfg = {};
    aw88298_cfg.ctrl_if = out_ctrl_if_;
    aw88298_cfg.gpio_if = gpio_if_;
    aw88298_cfg.reset_pin = GPIO_NUM_NC;
    aw88298_cfg.hw_gain.pa_voltage = 5.0;
    aw88298_cfg.hw_gain.codec_dac_voltage = 3.3;
    aw88298_cfg.hw_gain.pa_gain = 1;
    out_codec_if_ = aw88298_codec_new(&aw88298_cfg);
    assert(out_codec_if_ != NULL);

#if !STACKCHAN_CORES3_WIFI_SINGLE_OWNER
    esp_codec_dev_cfg_t output_dev_cfg = {
        .dev_type = ESP_CODEC_DEV_TYPE_OUT,
        .codec_if = out_codec_if_,
        .data_if = data_if_,
    };
    output_dev_ = esp_codec_dev_new(&output_dev_cfg);
    assert(output_dev_ != NULL);
#endif

    // Audio Input(Microphone)
    i2c_cfg.addr = es7210_addr;
    in_ctrl_if_ = audio_codec_new_i2c_ctrl(&i2c_cfg);
    assert(in_ctrl_if_ != NULL);

    es7210_codec_cfg_t es7210_cfg = {};
    es7210_cfg.ctrl_if = in_ctrl_if_;
#if STACKCHAN_CORES3_RAW_FOUR_SLOT_INPUT
    es7210_cfg.mic_selected = ES7210_SEL_MIC1 | ES7210_SEL_MIC2 | ES7210_SEL_MIC3 | ES7210_SEL_MIC4;
#else
    es7210_cfg.mic_selected = ES7210_SEL_MIC1 | ES7210_SEL_MIC2 | ES7210_SEL_MIC3;
#endif
    in_codec_if_ = es7210_codec_new(&es7210_cfg);
    assert(in_codec_if_ != NULL);

#if !STACKCHAN_CORES3_WIFI_SINGLE_OWNER
    esp_codec_dev_cfg_t input_dev_cfg = {
        .dev_type = ESP_CODEC_DEV_TYPE_IN,
        .codec_if = in_codec_if_,
        .data_if = data_if_,
    };
    input_dev_ = esp_codec_dev_new(&input_dev_cfg);
    assert(input_dev_ != NULL);
#endif

    ESP_LOGI(TAG, "CoreS3AudioCodec initialized mode=%s",
             STACKCHAN_CORES3_WIFI_SINGLE_OWNER ? "wifi_single_owner_idle" : "legacy_duplex");
}

CoreS3AudioCodec::~CoreS3AudioCodec() {
#if STACKCHAN_CORES3_WIFI_SINGLE_OWNER
    DestroyActivePath();
#else
    if (output_enabled_) ESP_ERROR_CHECK(esp_codec_dev_close(output_dev_));
    esp_codec_dev_delete(output_dev_);
    if (input_enabled_) ESP_ERROR_CHECK(esp_codec_dev_close(input_dev_));
    esp_codec_dev_delete(input_dev_);
    audio_codec_delete_data_if(data_if_);
#endif

    audio_codec_delete_codec_if(in_codec_if_);
    audio_codec_delete_ctrl_if(in_ctrl_if_);
    audio_codec_delete_codec_if(out_codec_if_);
    audio_codec_delete_ctrl_if(out_ctrl_if_);
    audio_codec_delete_gpio_if(gpio_if_);
}

void CoreS3AudioCodec::CreateDuplexChannels(gpio_num_t mclk, gpio_num_t bclk, gpio_num_t ws, gpio_num_t dout, gpio_num_t din) {
    assert(input_sample_rate_ == output_sample_rate_);

    ESP_LOGI(TAG, "Audio IOs: mclk: %d, bclk: %d, ws: %d, dout: %d, din: %d", mclk, bclk, ws, dout, din);

    i2s_chan_config_t chan_cfg = {
        .id = I2S_NUM_0,
        .role = I2S_ROLE_MASTER,
        .dma_desc_num = AUDIO_CODEC_DMA_DESC_NUM,
        .dma_frame_num = AUDIO_CODEC_DMA_FRAME_NUM,
        .auto_clear_after_cb = true,
        .auto_clear_before_cb = false,
        .intr_priority = 0,
    };
#if defined(CONFIG_STACKCHAN_WIFI_AUDIO_RX_ONLY_DIAGNOSTIC) && CONFIG_STACKCHAN_WIFI_AUDIO_RX_ONLY_DIAGNOSTIC
    ESP_ERROR_CHECK(i2s_new_channel(&chan_cfg, nullptr, &rx_handle_));

    i2s_tdm_config_t tdm_cfg = {
        .clk_cfg = I2S_TDM_CLK_DEFAULT_CONFIG((uint32_t)input_sample_rate_),
        .slot_cfg = I2S_TDM_PHILIPS_SLOT_DEFAULT_CONFIG(
            I2S_DATA_BIT_WIDTH_16BIT,
            I2S_SLOT_MODE_STEREO,
            i2s_tdm_slot_mask_t(I2S_TDM_SLOT0 | I2S_TDM_SLOT1 | I2S_TDM_SLOT2 | I2S_TDM_SLOT3)),
        .gpio_cfg = {
            .mclk = mclk,
            .bclk = bclk,
            .ws = ws,
            .dout = I2S_GPIO_UNUSED,
            .din = din,
            .invert_flags = {
                .mclk_inv = false,
                .bclk_inv = false,
                .ws_inv = false,
            },
        },
    };
    tdm_cfg.clk_cfg.mclk_multiple = I2S_MCLK_MULTIPLE_256;
    tdm_cfg.slot_cfg.total_slot = 4;
    ESP_ERROR_CHECK(i2s_channel_init_tdm_mode(rx_handle_, &tdm_cfg));

    i2s_chan_info_t info{};
    ESP_ERROR_CHECK(i2s_channel_get_info(rx_handle_, &info));
    ESP_LOGI(TAG, "RX-only diagnostic channel created: pair_chan=%p, sample_rate=%d, slots=4, bits=16",
             info.pair_chan, input_sample_rate_);
    return;
#else
    ESP_ERROR_CHECK(i2s_new_channel(&chan_cfg, &tx_handle_, &rx_handle_));

    // Half-duplex product split: standard I2S for speaker TX and the verified
    // raw four-slot TDM geometry for ES7210 microphone RX.
    i2s_std_config_t std_cfg = {
        .clk_cfg = {
            .sample_rate_hz = (uint32_t)output_sample_rate_,
            .clk_src = I2S_CLK_SRC_DEFAULT,
            .ext_clk_freq_hz = 0,
            .mclk_multiple = I2S_MCLK_MULTIPLE_256
        },
        .slot_cfg = {
            .data_bit_width = I2S_DATA_BIT_WIDTH_16BIT,
            .slot_bit_width = I2S_SLOT_BIT_WIDTH_AUTO,
            .slot_mode = I2S_SLOT_MODE_STEREO,
            .slot_mask = I2S_STD_SLOT_BOTH,
            .ws_width = I2S_DATA_BIT_WIDTH_16BIT,
            .ws_pol = false,
            .bit_shift = true,
            .left_align = true,
            .big_endian = false,
            .bit_order_lsb = false
        },
        .gpio_cfg = {
            .mclk = mclk,
            .bclk = bclk,
            .ws = ws,
            .dout = dout,
            .din = I2S_GPIO_UNUSED,
            .invert_flags = {
                .mclk_inv = false,
                .bclk_inv = false,
                .ws_inv = false
            }
        }
    };

    i2s_tdm_config_t tdm_cfg = {
        .clk_cfg = {
            .sample_rate_hz = (uint32_t)input_sample_rate_,
            .clk_src = I2S_CLK_SRC_DEFAULT,
            .ext_clk_freq_hz = 0,
            .mclk_multiple = I2S_MCLK_MULTIPLE_256,
            .bclk_div = 8,
        },
        .slot_cfg = {
            .data_bit_width = I2S_DATA_BIT_WIDTH_16BIT,
            .slot_bit_width = I2S_SLOT_BIT_WIDTH_AUTO,
            .slot_mode = I2S_SLOT_MODE_STEREO,
            .slot_mask = i2s_tdm_slot_mask_t(
                I2S_TDM_SLOT0 | I2S_TDM_SLOT1 | I2S_TDM_SLOT2 | I2S_TDM_SLOT3),
            .ws_width = I2S_TDM_AUTO_WS_WIDTH,
            .ws_pol = false,
            .bit_shift = true,
            .left_align = false,
            .big_endian = false,
            .bit_order_lsb = false,
            .skip_mask = false,
            .total_slot = I2S_TDM_AUTO_SLOT_NUM,
        },
        .gpio_cfg = {
            .mclk = mclk,
            .bclk = bclk,
            .ws = ws,
            .dout = I2S_GPIO_UNUSED,
            .din = din,
            .invert_flags = {
                .mclk_inv = false,
                .bclk_inv = false,
                .ws_inv = false,
            },
        },
    };

    ESP_ERROR_CHECK(i2s_channel_init_std_mode(tx_handle_, &std_cfg));
    ESP_ERROR_CHECK(i2s_channel_init_tdm_mode(rx_handle_, &tdm_cfg));
    ESP_ERROR_CHECK(i2s_channel_enable(tx_handle_));
    ESP_ERROR_CHECK(i2s_channel_enable(rx_handle_));
    ESP_LOGI(TAG, "Duplex channels created with standard TX and official four-slot TDM RX");
#endif
}

bool CoreS3AudioCodec::RecordTransitionFailure(const char* operation, int error) {
    transition_failures_.fetch_add(1);
    last_transition_error_ = error;
    ESP_LOGE(TAG, "Wi-Fi I2S transition failed operation=%s error=%d mode=%s failures=%lu",
             operation, error, wifi_audio_mode_name(),
             static_cast<unsigned long>(transition_failures_.load()));
    return false;
}

const char* CoreS3AudioCodec::wifi_audio_mode_name() const {
    switch (active_mode_.load()) {
        case WifiAudioMode::Idle: return "idle";
        case WifiAudioMode::Listening: return "listening";
        case WifiAudioMode::Speaking: return "speaking";
    }
    return "unknown";
}

bool CoreS3AudioCodec::DestroyActivePath() {
    bool success = true;
    if (input_dev_) {
        if (data_if_ && data_if_->enable) {
            const int disable_result = data_if_->enable(data_if_, ESP_CODEC_DEV_TYPE_IN, false);
            if (disable_result != ESP_CODEC_DEV_OK) {
                RecordTransitionFailure("disable_rx_data", disable_result);
                success = false;
            }
        }
        if (in_codec_if_ && in_codec_if_->enable) {
            const int disable_result = in_codec_if_->enable(in_codec_if_, false);
            if (disable_result != ESP_CODEC_DEV_OK) {
                RecordTransitionFailure("disable_input_codec", disable_result);
                success = false;
            }
        }
    }
    if (output_dev_) {
        if (data_if_ && data_if_->enable) {
            const int disable_result = data_if_->enable(data_if_, ESP_CODEC_DEV_TYPE_OUT, false);
            if (disable_result != ESP_CODEC_DEV_OK) {
                RecordTransitionFailure("disable_tx_data", disable_result);
                success = false;
            }
        }
        if (out_codec_if_ && out_codec_if_->enable) {
            const int disable_result = out_codec_if_->enable(out_codec_if_, false);
            if (disable_result != ESP_CODEC_DEV_OK) {
                RecordTransitionFailure("disable_output_codec", disable_result);
                success = false;
            }
        }
    }
    if (!success) {
        // Preserve the complete device/data/channel graph so a later
        // transition can retry the failed hardware disable operation.
        AudioCodec::EnableInput(false);
        AudioCodec::EnableOutput(false);
        active_mode_ = WifiAudioMode::Idle;
        return false;
    }

    if (input_dev_) {
        const int result = esp_codec_dev_close(input_dev_);
        if (result != ESP_CODEC_DEV_OK) {
            RecordTransitionFailure("close_input", result);
            AudioCodec::EnableInput(false);
            active_mode_ = WifiAudioMode::Idle;
            return false;
        }
        esp_codec_dev_delete(input_dev_);
        input_dev_ = nullptr;
    }
    if (output_dev_) {
        const int result = esp_codec_dev_close(output_dev_);
        if (result != ESP_CODEC_DEV_OK) {
            RecordTransitionFailure("close_output", result);
            AudioCodec::EnableOutput(false);
            active_mode_ = WifiAudioMode::Idle;
            return false;
        }
        esp_codec_dev_delete(output_dev_);
        output_dev_ = nullptr;
    }
    AudioCodec::EnableInput(false);
    AudioCodec::EnableOutput(false);

    if (data_if_) {
        const int result = audio_codec_delete_data_if(data_if_);
        data_if_ = nullptr;
        if (result != ESP_CODEC_DEV_OK) {
            RecordTransitionFailure("delete_data_interface", result);
            success = false;
        }
    }
    if (rx_handle_) {
        const esp_err_t result = i2s_del_channel(rx_handle_);
        if (result != ESP_OK) {
            RecordTransitionFailure("delete_rx_channel", result);
            success = false;
        } else {
            rx_handle_ = nullptr;
        }
    }
    if (tx_handle_) {
        const esp_err_t result = i2s_del_channel(tx_handle_);
        if (result != ESP_OK) {
            RecordTransitionFailure("delete_tx_channel", result);
            success = false;
        } else {
            tx_handle_ = nullptr;
        }
    }
    active_mode_ = WifiAudioMode::Idle;
    return success;
}

bool CoreS3AudioCodec::CreateListeningPath() {
    i2s_chan_config_t chan_cfg = {
        .id = I2S_NUM_0,
        .role = I2S_ROLE_MASTER,
        .dma_desc_num = AUDIO_CODEC_DMA_DESC_NUM,
        .dma_frame_num = AUDIO_CODEC_DMA_FRAME_NUM,
        .auto_clear_after_cb = true,
        .auto_clear_before_cb = false,
        .intr_priority = 0,
    };
    esp_err_t i2s_result = i2s_new_channel(&chan_cfg, nullptr, &rx_handle_);
    if (i2s_result != ESP_OK) return RecordTransitionFailure("create_rx_channel", i2s_result);

    i2s_tdm_config_t tdm_cfg = {
        .clk_cfg = I2S_TDM_CLK_DEFAULT_CONFIG((uint32_t)input_sample_rate_),
        .slot_cfg = I2S_TDM_PHILIPS_SLOT_DEFAULT_CONFIG(
            I2S_DATA_BIT_WIDTH_16BIT,
            I2S_SLOT_MODE_STEREO,
            i2s_tdm_slot_mask_t(I2S_TDM_SLOT0 | I2S_TDM_SLOT1 |
                                I2S_TDM_SLOT2 | I2S_TDM_SLOT3)),
        .gpio_cfg = {
            .mclk = mclk_,
            .bclk = bclk_,
            .ws = ws_,
            .dout = I2S_GPIO_UNUSED,
            .din = din_,
            .invert_flags = {
                .mclk_inv = false,
                .bclk_inv = false,
                .ws_inv = false,
            },
        },
    };
    tdm_cfg.clk_cfg.mclk_multiple = I2S_MCLK_MULTIPLE_256;
    tdm_cfg.slot_cfg.total_slot = 4;
    i2s_result = i2s_channel_init_tdm_mode(rx_handle_, &tdm_cfg);
    if (i2s_result != ESP_OK) {
        RecordTransitionFailure("init_rx_tdm", i2s_result);
        DestroyActivePath();
        return false;
    }

    audio_codec_i2s_cfg_t i2s_cfg = {
        .port = I2S_NUM_0,
        .rx_handle = rx_handle_,
        .tx_handle = nullptr,
    };
    data_if_ = audio_codec_new_i2s_data(&i2s_cfg);
    if (!data_if_) {
        RecordTransitionFailure("create_rx_data_interface", ESP_CODEC_DEV_NO_MEM);
        DestroyActivePath();
        return false;
    }
    esp_codec_dev_cfg_t dev_cfg = {
        .dev_type = ESP_CODEC_DEV_TYPE_IN,
        .codec_if = in_codec_if_,
        .data_if = data_if_,
    };
    input_dev_ = esp_codec_dev_new(&dev_cfg);
    if (!input_dev_) {
        RecordTransitionFailure("create_input_device", ESP_CODEC_DEV_NO_MEM);
        DestroyActivePath();
        return false;
    }

    esp_codec_dev_sample_info_t fs = {
        .bits_per_sample = 16,
        .channel = 4,
        .channel_mask = ESP_CODEC_DEV_MAKE_CHANNEL_MASK(0) |
                        ESP_CODEC_DEV_MAKE_CHANNEL_MASK(1) |
                        ESP_CODEC_DEV_MAKE_CHANNEL_MASK(2) |
                        ESP_CODEC_DEV_MAKE_CHANNEL_MASK(3),
        .sample_rate = (uint32_t)input_sample_rate_,
        .mclk_multiple = 0,
    };
    int result = data_if_->set_fmt(data_if_, ESP_CODEC_DEV_TYPE_IN, &fs);
    if (result != ESP_CODEC_DEV_OK) {
        RecordTransitionFailure("set_rx_format", result);
        DestroyActivePath();
        return false;
    }
    result = esp_codec_dev_open(input_dev_, &fs);
    if (result != ESP_CODEC_DEV_OK) {
        RecordTransitionFailure("open_input_device", result);
        DestroyActivePath();
        return false;
    }
    const uint16_t gain_mask = ESP_CODEC_DEV_MAKE_CHANNEL_MASK(0) |
                               ESP_CODEC_DEV_MAKE_CHANNEL_MASK(1) |
                               ESP_CODEC_DEV_MAKE_CHANNEL_MASK(2) |
                               ESP_CODEC_DEV_MAKE_CHANNEL_MASK(3);
    result = esp_codec_dev_set_in_channel_gain(input_dev_, gain_mask, input_gain_);
    if (result != ESP_CODEC_DEV_OK) {
        RecordTransitionFailure("set_input_gain", result);
        DestroyActivePath();
        return false;
    }
    AudioCodec::EnableInput(true);
    active_mode_ = WifiAudioMode::Listening;
    last_transition_error_ = ESP_OK;
    ESP_LOGI(TAG, "Wi-Fi I2S owner entered listening: RX-only TDM 4x16 rate=%d gain=%.1f",
             input_sample_rate_, input_gain_);
    return true;
}

bool CoreS3AudioCodec::CreateSpeakingPath() {
#if defined(CONFIG_STACKCHAN_WIFI_AUDIO_RX_ONLY_DIAGNOSTIC) && CONFIG_STACKCHAN_WIFI_AUDIO_RX_ONLY_DIAGNOSTIC
    return RecordTransitionFailure("speaker_unavailable_in_rx_diagnostic", ESP_ERR_NOT_SUPPORTED);
#else
    i2s_chan_config_t chan_cfg = {
        .id = I2S_NUM_0,
        .role = I2S_ROLE_MASTER,
        .dma_desc_num = AUDIO_CODEC_DMA_DESC_NUM,
        .dma_frame_num = AUDIO_CODEC_DMA_FRAME_NUM,
        .auto_clear_after_cb = true,
        .auto_clear_before_cb = false,
        .intr_priority = 0,
    };
    esp_err_t i2s_result = i2s_new_channel(&chan_cfg, &tx_handle_, nullptr);
    if (i2s_result != ESP_OK) return RecordTransitionFailure("create_tx_channel", i2s_result);

    i2s_std_config_t std_cfg = {
        .clk_cfg = I2S_STD_CLK_DEFAULT_CONFIG((uint32_t)output_sample_rate_),
        .slot_cfg = I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(
            I2S_DATA_BIT_WIDTH_16BIT, I2S_SLOT_MODE_STEREO),
        .gpio_cfg = {
            .mclk = mclk_,
            .bclk = bclk_,
            .ws = ws_,
            .dout = dout_,
            .din = I2S_GPIO_UNUSED,
            .invert_flags = {
                .mclk_inv = false,
                .bclk_inv = false,
                .ws_inv = false,
            },
        },
    };
    std_cfg.clk_cfg.mclk_multiple = I2S_MCLK_MULTIPLE_256;
    i2s_result = i2s_channel_init_std_mode(tx_handle_, &std_cfg);
    if (i2s_result != ESP_OK) {
        RecordTransitionFailure("init_tx_std", i2s_result);
        DestroyActivePath();
        return false;
    }

    audio_codec_i2s_cfg_t i2s_cfg = {
        .port = I2S_NUM_0,
        .rx_handle = nullptr,
        .tx_handle = tx_handle_,
    };
    data_if_ = audio_codec_new_i2s_data(&i2s_cfg);
    if (!data_if_) {
        RecordTransitionFailure("create_tx_data_interface", ESP_CODEC_DEV_NO_MEM);
        DestroyActivePath();
        return false;
    }
    esp_codec_dev_cfg_t dev_cfg = {
        .dev_type = ESP_CODEC_DEV_TYPE_OUT,
        .codec_if = out_codec_if_,
        .data_if = data_if_,
    };
    output_dev_ = esp_codec_dev_new(&dev_cfg);
    if (!output_dev_) {
        RecordTransitionFailure("create_output_device", ESP_CODEC_DEV_NO_MEM);
        DestroyActivePath();
        return false;
    }
    esp_codec_dev_sample_info_t fs = {
        .bits_per_sample = 16,
        .channel = 2,
        .channel_mask = ESP_CODEC_DEV_MAKE_CHANNEL_MASK(0) |
                        ESP_CODEC_DEV_MAKE_CHANNEL_MASK(1),
        .sample_rate = (uint32_t)output_sample_rate_,
        .mclk_multiple = 0,
    };
    int result = data_if_->set_fmt(data_if_, ESP_CODEC_DEV_TYPE_OUT, &fs);
    if (result != ESP_CODEC_DEV_OK) {
        RecordTransitionFailure("set_tx_format", result);
        DestroyActivePath();
        return false;
    }
    result = esp_codec_dev_open(output_dev_, &fs);
    if (result != ESP_CODEC_DEV_OK) {
        RecordTransitionFailure("open_output_device", result);
        DestroyActivePath();
        return false;
    }
    result = esp_codec_dev_set_out_vol(output_dev_, output_volume_);
    if (result != ESP_CODEC_DEV_OK) {
        RecordTransitionFailure("set_output_volume", result);
        DestroyActivePath();
        return false;
    }
    AudioCodec::EnableOutput(true);
    active_mode_ = WifiAudioMode::Speaking;
    last_transition_error_ = ESP_OK;
    ESP_LOGI(TAG, "Wi-Fi I2S owner entered speaking: TX-only STD 2x16 rate=%d volume=%d",
             output_sample_rate_, output_volume_);
    return true;
#endif
}

bool CoreS3AudioCodec::SetWifiAudioMode(WifiAudioMode mode) {
#if STACKCHAN_CORES3_WIFI_SINGLE_OWNER
    std::lock_guard<std::mutex> mode_lock(mode_mutex_);
    if (mode == active_mode_.load()) return true;
    ESP_LOGI(TAG, "Wi-Fi I2S transition %s -> %s", wifi_audio_mode_name(),
             mode == WifiAudioMode::Listening ? "listening" :
             mode == WifiAudioMode::Speaking ? "speaking" : "idle");
    if (!DestroyActivePath()) return false;
    if (mode == WifiAudioMode::Idle) {
        last_transition_error_ = ESP_OK;
        return true;
    }
    return mode == WifiAudioMode::Listening ? CreateListeningPath() : CreateSpeakingPath();
#else
    (void)mode;
    return RecordTransitionFailure("wifi_single_owner_not_enabled", ESP_ERR_NOT_SUPPORTED);
#endif
}

void CoreS3AudioCodec::SetOutputVolume(int volume) {
    std::lock_guard<std::mutex> mode_lock(mode_mutex_);
    if (output_dev_) {
        const int result = esp_codec_dev_set_out_vol(output_dev_, volume);
        if (result != ESP_CODEC_DEV_OK) RecordTransitionFailure("set_live_output_volume", result);
    }
    AudioCodec::SetOutputVolume(volume);
}

void CoreS3AudioCodec::EnableInput(bool enable) {
#if STACKCHAN_CORES3_WIFI_SINGLE_OWNER
    if (enable) {
        SetWifiAudioMode(WifiAudioMode::Listening);
    } else if (active_mode_.load() == WifiAudioMode::Listening) {
        SetWifiAudioMode(WifiAudioMode::Idle);
    }
    return;
#else
    if (enable == input_enabled_) {
        return;
    }
    if (enable) {
        esp_codec_dev_sample_info_t fs = {
            .bits_per_sample = 16,
#if STACKCHAN_CORES3_RAW_FOUR_SLOT_INPUT
            .channel = 4,
            .channel_mask = ESP_CODEC_DEV_MAKE_CHANNEL_MASK(0) |
                            ESP_CODEC_DEV_MAKE_CHANNEL_MASK(1) |
                            ESP_CODEC_DEV_MAKE_CHANNEL_MASK(2) |
                            ESP_CODEC_DEV_MAKE_CHANNEL_MASK(3),
#else
            .channel = 2,
            .channel_mask = ESP_CODEC_DEV_MAKE_CHANNEL_MASK(0),
#endif
            .sample_rate = (uint32_t)output_sample_rate_,
            .mclk_multiple = 0,
        };
#if !STACKCHAN_CORES3_RAW_FOUR_SLOT_INPUT
        if (input_reference_) {
            fs.channel_mask |= ESP_CODEC_DEV_MAKE_CHANNEL_MASK(1);
        }
#endif
        ESP_ERROR_CHECK(esp_codec_dev_open(input_dev_, &fs));
#if STACKCHAN_CORES3_RAW_FOUR_SLOT_INPUT
        const uint16_t gain_mask = ESP_CODEC_DEV_MAKE_CHANNEL_MASK(0) |
                                   ESP_CODEC_DEV_MAKE_CHANNEL_MASK(1) |
                                   ESP_CODEC_DEV_MAKE_CHANNEL_MASK(2) |
                                   ESP_CODEC_DEV_MAKE_CHANNEL_MASK(3);
#else
        uint16_t gain_mask = ESP_CODEC_DEV_MAKE_CHANNEL_MASK(0);
        if (input_reference_) {
            gain_mask |= ESP_CODEC_DEV_MAKE_CHANNEL_MASK(1);
        }
#endif
        ESP_ERROR_CHECK(esp_codec_dev_set_in_channel_gain(input_dev_, gain_mask, input_gain_));
#if defined(CONFIG_STACKCHAN_WIFI_AUDIO_RX_ONLY_DIAGNOSTIC) && CONFIG_STACKCHAN_WIFI_AUDIO_RX_ONLY_DIAGNOSTIC
        ESP_LOGI(TAG, "RX-only diagnostic input opened: four raw TDM slots, gain=%d dB", input_gain_);
        static constexpr int kSnapshotRegisters[] = {
            0x00, 0x01, 0x02, 0x04, 0x05, 0x06, 0x07, 0x08,
            0x11, 0x12, 0x40, 0x43, 0x44, 0x45, 0x46, 0x4B, 0x4C,
        };
        for (const int reg : kSnapshotRegisters) {
            int value = 0;
            const int result = esp_codec_dev_read_reg(input_dev_, reg, &value);
            if (result == ESP_CODEC_DEV_OK) {
                ESP_LOGI(TAG, "ES7210-SNAPSHOT reg=%02X value=%02X", reg, value & 0xFF);
            } else {
                ESP_LOGE(TAG, "ES7210-SNAPSHOT reg=%02X error=%d", reg, result);
            }
        }
#elif defined(CONFIG_STACKCHAN_WIFI_AUDIO_MVP) && CONFIG_STACKCHAN_WIFI_AUDIO_MVP
        ESP_LOGI(TAG, "Wi-Fi Audio input uses verified raw four-slot TDM RX, gain=%d dB", input_gain_);
#endif
    } else {
        ESP_ERROR_CHECK(esp_codec_dev_close(input_dev_));
    }
    AudioCodec::EnableInput(enable);
#endif
}

void CoreS3AudioCodec::EnableOutput(bool enable) {
#if STACKCHAN_CORES3_WIFI_SINGLE_OWNER
#if defined(CONFIG_STACKCHAN_WIFI_AUDIO_RX_ONLY_DIAGNOSTIC) && CONFIG_STACKCHAN_WIFI_AUDIO_RX_ONLY_DIAGNOSTIC
    if (enable) {
        ESP_LOGW(TAG, "Speaker output is unavailable in RX-only diagnostic mode");
    }
#else
    if (enable) {
        SetWifiAudioMode(WifiAudioMode::Speaking);
    } else if (active_mode_.load() == WifiAudioMode::Speaking) {
        SetWifiAudioMode(WifiAudioMode::Idle);
    }
#endif
    return;
#else
    if (enable == output_enabled_) {
        return;
    }
    if (enable) {
        // Keep the shared full-duplex frame at 2 x 16 bits. Write() duplicates
        // the existing mono application PCM into both physical I2S slots.
        esp_codec_dev_sample_info_t fs = {
            .bits_per_sample = 16,
            .channel = 2,
            .channel_mask = ESP_CODEC_DEV_MAKE_CHANNEL_MASK(0) |
                            ESP_CODEC_DEV_MAKE_CHANNEL_MASK(1),
            .sample_rate = (uint32_t)output_sample_rate_,
            .mclk_multiple = 0,
        };
        ESP_ERROR_CHECK(esp_codec_dev_open(output_dev_, &fs));
        ESP_ERROR_CHECK(esp_codec_dev_set_out_vol(output_dev_, output_volume_));
    } else {
        ESP_ERROR_CHECK(esp_codec_dev_close(output_dev_));
    }
    AudioCodec::EnableOutput(enable);
#endif
}

int CoreS3AudioCodec::Read(int16_t* dest, int samples) {
    std::lock_guard<std::mutex> mode_lock(mode_mutex_);
    if (input_enabled_) {
#if STACKCHAN_CORES3_RAW_FOUR_SLOT_INPUT
        const size_t requested_bytes = static_cast<size_t>(samples) * sizeof(int16_t);
        size_t bytes_read = 0;
        const esp_err_t result = i2s_channel_read(
            rx_handle_, dest, requested_bytes, &bytes_read, pdMS_TO_TICKS(1000));
        if (result != ESP_OK || bytes_read != requested_bytes ||
            (bytes_read % (4 * sizeof(int16_t))) != 0) {
            const uint32_t failed_reads = read_failures_.fetch_add(1) + 1;
            last_read_error_ = result != ESP_OK ? result : ESP_ERR_INVALID_SIZE;
            std::memset(dest, 0, requested_bytes);
            ESP_LOGE(TAG,
                     "RX4-READ failure=%lu err=%s requested=%u actual=%u frame_aligned=%d",
                     static_cast<unsigned long>(failed_reads), esp_err_to_name(last_read_error_.load()),
                     static_cast<unsigned>(requested_bytes), static_cast<unsigned>(bytes_read),
                     (bytes_read % (4 * sizeof(int16_t))) == 0);
            return 0;
        }
        const uint32_t successful_reads = read_successes_.fetch_add(1) + 1;
        last_read_error_ = ESP_OK;
        if (successful_reads == 1 || successful_reads % 500 == 0) {
            ESP_LOGI(TAG, "RX4-READ success=%lu bytes=%u failures=%lu",
                     static_cast<unsigned long>(successful_reads), static_cast<unsigned>(bytes_read),
                     static_cast<unsigned long>(read_failures_.load()));
        }
        return static_cast<int>(bytes_read / sizeof(int16_t));
#else
        const size_t requested_bytes = static_cast<size_t>(samples) * sizeof(int16_t);
        const int result = esp_codec_dev_read(input_dev_, dest, requested_bytes);
        if (result != ESP_CODEC_DEV_OK) {
            std::memset(dest, 0, requested_bytes);
            ESP_LOGE(TAG, "Audio input read failed: result=%d requested=%u",
                     result, static_cast<unsigned>(requested_bytes));
            return 0;
        }
        return samples;
#endif
    }
    return 0;
}

int CoreS3AudioCodec::Write(const int16_t* data, int samples) {
    std::lock_guard<std::mutex> mode_lock(mode_mutex_);
    if (output_enabled_ && data != nullptr && samples > 0) {
        std::lock_guard<std::mutex> lock(output_write_mutex_);
        output_stereo_buffer_.resize(static_cast<size_t>(samples) * 2);
        for (int i = 0; i < samples; ++i) {
            output_stereo_buffer_[static_cast<size_t>(i) * 2] = data[i];
            output_stereo_buffer_[static_cast<size_t>(i) * 2 + 1] = data[i];
        }
        ESP_ERROR_CHECK_WITHOUT_ABORT(esp_codec_dev_write(
            output_dev_, output_stereo_buffer_.data(),
            output_stereo_buffer_.size() * sizeof(int16_t)));
    }
    return samples;
}

bool CoreS3AudioCodec::ReadInputRegister(int reg, int* value) const {
    return input_dev_ != nullptr && value != nullptr &&
           esp_codec_dev_read_reg(input_dev_, reg, value) == ESP_CODEC_DEV_OK;
}

#undef STACKCHAN_CORES3_RAW_FOUR_SLOT_INPUT
#undef STACKCHAN_CORES3_WIFI_SINGLE_OWNER

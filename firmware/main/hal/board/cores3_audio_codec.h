#ifndef _BOX_AUDIO_CODEC_H
#define _BOX_AUDIO_CODEC_H

#include "audio_codec.h"

#include <esp_codec_dev.h>
#include <esp_codec_dev_defaults.h>

#include <atomic>
#include <mutex>
#include <vector>

class CoreS3AudioCodec : public AudioCodec {
public:
    enum class WifiAudioMode {
        Idle,
        Listening,
        Speaking,
    };

private:
    const audio_codec_data_if_t* data_if_ = nullptr;
    const audio_codec_ctrl_if_t* out_ctrl_if_ = nullptr;
    const audio_codec_if_t* out_codec_if_ = nullptr;
    const audio_codec_ctrl_if_t* in_ctrl_if_ = nullptr;
    const audio_codec_if_t* in_codec_if_ = nullptr;
    const audio_codec_gpio_if_t* gpio_if_ = nullptr;

    esp_codec_dev_handle_t output_dev_ = nullptr;
    esp_codec_dev_handle_t input_dev_ = nullptr;
    std::mutex mode_mutex_;
    std::mutex output_write_mutex_;
    std::vector<int16_t> output_stereo_buffer_;

    gpio_num_t mclk_ = GPIO_NUM_NC;
    gpio_num_t bclk_ = GPIO_NUM_NC;
    gpio_num_t ws_ = GPIO_NUM_NC;
    gpio_num_t dout_ = GPIO_NUM_NC;
    gpio_num_t din_ = GPIO_NUM_NC;
    std::atomic<WifiAudioMode> active_mode_{WifiAudioMode::Idle};
    std::atomic_uint32_t transition_failures_{0};
    std::atomic_int last_transition_error_{ESP_OK};
    std::atomic_uint32_t read_successes_{0};
    std::atomic_uint32_t read_failures_{0};
    std::atomic_int last_read_error_{ESP_OK};

    void CreateDuplexChannels(gpio_num_t mclk, gpio_num_t bclk, gpio_num_t ws, gpio_num_t dout, gpio_num_t din);
    bool CreateListeningPath();
    bool CreateSpeakingPath();
    bool DestroyActivePath();
    bool RecordTransitionFailure(const char* operation, int error);

    virtual int Read(int16_t* dest, int samples) override;
    virtual int Write(const int16_t* data, int samples) override;

public:
    CoreS3AudioCodec(void* i2c_master_handle, int input_sample_rate, int output_sample_rate,
        gpio_num_t mclk, gpio_num_t bclk, gpio_num_t ws, gpio_num_t dout, gpio_num_t din,
        uint8_t aw88298_addr, uint8_t es7210_addr, bool input_reference);
    virtual ~CoreS3AudioCodec();

    virtual void SetOutputVolume(int volume) override;
    virtual void EnableInput(bool enable) override;
    virtual void EnableOutput(bool enable) override;

    bool SetWifiAudioMode(WifiAudioMode mode);
    WifiAudioMode wifi_audio_mode() const { return active_mode_.load(); }
    uint32_t transition_failures() const { return transition_failures_.load(); }
    int last_transition_error() const { return last_transition_error_.load(); }
    uint32_t read_successes() const { return read_successes_.load(); }
    uint32_t read_failures() const { return read_failures_.load(); }
    int last_read_error() const { return last_read_error_.load(); }
    const char* wifi_audio_mode_name() const;

    bool ReadInputRegister(int reg, int* value) const;
};

#endif // _BOX_AUDIO_CODEC_H

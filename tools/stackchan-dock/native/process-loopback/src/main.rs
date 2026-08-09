use std::collections::VecDeque;
use std::env;
use std::fs::OpenOptions;
use std::io::{self, Write};
use std::time::{Duration, Instant};

use wasapi::{AudioClient, Direction, SampleType, StreamMode, WaveFormat, initialize_mta};

const SAMPLE_RATE: u32 = 24_000;
const CHANNELS: u16 = 1;
const BITS_PER_SAMPLE: u16 = 16;
const FRAME_SAMPLES: usize = 240;
const FRAME_BYTES: usize = FRAME_SAMPLES * 2;
const DEFAULT_PIPE: &str = r"\\.\pipe\stackchan-wifi-speaker";

#[derive(Debug)]
struct Config {
    pid: u32,
    pipe: String,
    duration: Option<Duration>,
    gate_threshold: i16,
    pre_roll_frames: usize,
    hangover_frames: usize,
}

fn parse_args() -> Result<Config, String> {
    let mut args = env::args().skip(1);
    let mut pid = None;
    let mut pipe = DEFAULT_PIPE.to_owned();
    let mut duration = None;
    let mut gate_threshold = 64_i16;
    let mut pre_roll_ms = 20_u64;
    let mut hangover_ms = 300_u64;
    while let Some(arg) = args.next() {
        let value = |args: &mut std::iter::Skip<env::Args>, name: &str| {
            args.next().ok_or_else(|| format!("{name} requires a value"))
        };
        match arg.as_str() {
            "--pid" => {
                pid = Some(value(&mut args, "--pid")?.parse().map_err(|_| "--pid must be an integer")?);
            }
            "--pipe" => pipe = value(&mut args, "--pipe")?,
            "--duration" => {
                let seconds: f64 = value(&mut args, "--duration")?
                    .parse().map_err(|_| "--duration must be a number")?;
                if !seconds.is_finite() || seconds <= 0.0 {
                    return Err("--duration must be positive".into());
                }
                duration = Some(Duration::from_secs_f64(seconds));
            }
            "--gate-threshold" => {
                gate_threshold = value(&mut args, "--gate-threshold")?
                    .parse().map_err(|_| "--gate-threshold must be an integer")?;
                if gate_threshold < 0 {
                    return Err("--gate-threshold must be non-negative".into());
                }
            }
            "--pre-roll-ms" => {
                pre_roll_ms = value(&mut args, "--pre-roll-ms")?
                    .parse().map_err(|_| "--pre-roll-ms must be an integer")?;
            }
            "--hangover-ms" => {
                hangover_ms = value(&mut args, "--hangover-ms")?
                    .parse().map_err(|_| "--hangover-ms must be an integer")?;
            }
            "--help" | "-h" => {
                return Err("usage: stackchan-process-loopback --pid PID [--pipe PATH] [--duration SECONDS] [--gate-threshold N] [--pre-roll-ms N] [--hangover-ms N]".into());
            }
            _ => return Err(format!("unknown argument: {arg}")),
        }
    }
    let pid = pid.ok_or("--pid is required")?;
    if pid == 0 || pre_roll_ms % 10 != 0 || hangover_ms % 10 != 0 {
        return Err("pid must be nonzero and gate durations must be multiples of 10 ms".into());
    }
    Ok(Config {
        pid,
        pipe,
        duration,
        gate_threshold,
        pre_roll_frames: (pre_roll_ms / 10) as usize,
        hangover_frames: (hangover_ms / 10) as usize,
    })
}

struct ActivityGate {
    threshold: i16,
    pre_roll_limit: usize,
    pre_roll: VecDeque<Vec<u8>>,
    hangover_frames: usize,
    hangover_remaining: usize,
}

impl ActivityGate {
    fn new(threshold: i16, pre_roll_limit: usize, hangover_frames: usize) -> Self {
        Self {
            threshold,
            pre_roll_limit,
            pre_roll: VecDeque::with_capacity(pre_roll_limit),
            hangover_frames,
            hangover_remaining: 0,
        }
    }

    fn push(&mut self, frame: Vec<u8>) -> Vec<Vec<u8>> {
        let peak = pcm_peak(&frame);
        if peak >= self.threshold {
            let mut output = self.pre_roll.drain(..).collect::<Vec<_>>();
            output.push(frame);
            self.hangover_remaining = self.hangover_frames;
            return output;
        }
        if self.hangover_remaining > 0 {
            self.hangover_remaining -= 1;
            return vec![frame];
        }
        if self.pre_roll_limit > 0 {
            if self.pre_roll.len() == self.pre_roll_limit {
                self.pre_roll.pop_front();
            }
            self.pre_roll.push_back(frame);
        }
        Vec::new()
    }
}

fn pcm_peak(frame: &[u8]) -> i16 {
    frame.chunks_exact(2)
        .map(|sample| i16::from_le_bytes([sample[0], sample[1]]).unsigned_abs())
        .max()
        .unwrap_or(0)
        .min(i16::MAX as u16) as i16
}

fn capture(config: Config) -> Result<(), Box<dyn std::error::Error>> {
    initialize_mta().ok()?;
    let format = WaveFormat::new(
        BITS_PER_SAMPLE as usize,
        BITS_PER_SAMPLE as usize,
        &SampleType::Int,
        SAMPLE_RATE as usize,
        CHANNELS as usize,
        None,
    );
    let block_align = format.get_blockalign() as usize;
    let mut audio_client = AudioClient::new_application_loopback_client(config.pid, true)?;
    let mode = StreamMode::EventsShared {
        autoconvert: true,
        buffer_duration_hns: 0,
    };
    audio_client.initialize_client(&format, &Direction::Capture, &mode)?;
    let event = audio_client.set_get_eventhandle()?;
    let capture_client = audio_client.get_audiocaptureclient()?;
    let mut pipe = OpenOptions::new().write(true).open(&config.pipe)?;
    let started = Instant::now();
    let mut bytes = VecDeque::<u8>::new();
    let mut gate = ActivityGate::new(config.gate_threshold, config.pre_roll_frames, config.hangover_frames);
    let mut frames = 0_u64;
    let mut sent_frames = 0_u64;
    let mut gated_frames = 0_u64;
    let mut discontinuities = 0_u64;
    let mut window_peak = 0_i16;
    eprintln!(
        "Process loopback ready pid={} include_tree=true sample_rate={} channels={} bits={} pipe={}",
        config.pid, SAMPLE_RATE, CHANNELS, BITS_PER_SAMPLE, config.pipe
    );
    audio_client.start_stream()?;
    let result: io::Result<()> = (|| {
        loop {
            if config.duration.is_some_and(|duration| started.elapsed() >= duration) {
                break;
            }
            let mut packet_frames = capture_client.get_next_packet_size()
                .map_err(io::Error::other)?
                .unwrap_or(0);
            if packet_frames == 0 {
                let _ = event.wait_for_event(100);
                continue;
            }
            while packet_frames > 0 {
                let before = bytes.len();
                let info = capture_client
                    .read_from_device_to_deque(&mut bytes)
                    .map_err(io::Error::other)?;
                if info.flags.data_discontinuity {
                    discontinuities += 1;
                }
                let appended = bytes.len() - before;
                let expected = packet_frames as usize * block_align;
                if info.flags.silent && appended < expected {
                    bytes.extend(std::iter::repeat_n(0, expected - appended));
                }
                while bytes.len() >= FRAME_BYTES {
                    let frame = bytes.drain(..FRAME_BYTES).collect::<Vec<_>>();
                    frames += 1;
                    window_peak = window_peak.max(pcm_peak(&frame));
                    let outgoing = gate.push(frame);
                    if outgoing.is_empty() {
                        gated_frames += 1;
                    }
                    for outgoing_frame in outgoing {
                        pipe.write_all(&outgoing_frame)?;
                        sent_frames += 1;
                    }
                    if frames == 1 || frames % 500 == 0 {
                        eprintln!(
                            "Process loopback frames={frames} sent_frames={sent_frames} gated_frames={gated_frames} peak={window_peak} discontinuities={discontinuities}"
                        );
                        window_peak = 0;
                    }
                }
                packet_frames = capture_client.get_next_packet_size()
                    .map_err(io::Error::other)?
                    .unwrap_or(0);
            }
        }
        Ok(())
    })();
    let stop_result = audio_client.stop_stream();
    result?;
    stop_result?;
    eprintln!(
        "Process loopback stopped frames={frames} sent_frames={sent_frames} gated_frames={gated_frames} discontinuities={discontinuities}"
    );
    Ok(())
}

fn main() {
    let result = parse_args().map_err(|error| error.into()).and_then(capture);
    if let Err(error) = result {
        eprintln!("stackchan-process-loopback: {error}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame(value: i16) -> Vec<u8> {
        value.to_le_bytes().repeat(FRAME_SAMPLES)
    }

    #[test]
    fn gate_preserves_pre_roll_and_hangover() {
        let mut gate = ActivityGate::new(64, 2, 2);
        assert!(gate.push(frame(0)).is_empty());
        assert!(gate.push(frame(1)).is_empty());
        let attack = gate.push(frame(100));
        assert_eq!(attack.len(), 3);
        assert_eq!(gate.push(frame(0)).len(), 1);
        assert_eq!(gate.push(frame(0)).len(), 1);
        assert!(gate.push(frame(0)).is_empty());
    }

    #[test]
    fn peak_handles_full_negative_scale_without_overflow() {
        assert_eq!(pcm_peak(&frame(i16::MIN)), i16::MAX);
    }
}

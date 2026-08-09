use std::collections::VecDeque;
use std::env;
use std::io::{self, Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc};
use std::thread;
use std::time::{Duration, Instant};

use opus::{Application, Bitrate, Channels, Decoder, Encoder};
use wasapi::{
    initialize_mta, AudioClient, Device, DeviceEnumerator, Direction, SampleType, StreamMode,
    WaveFormat,
};

type DynError = Box<dyn std::error::Error + Send + Sync>;

const CAPTURE_SAMPLE_RATE: u32 = 24_000;
const CAPTURE_FRAME_SAMPLES: usize = 1_440;
const CAPTURE_FRAME_BYTES: usize = CAPTURE_FRAME_SAMPLES * 2;
const RENDER_SAMPLE_RATE: u32 = 16_000;
const RENDER_FRAME_SAMPLES: usize = 960;
const MAX_OPUS_PACKET_BYTES: usize = 1_500;
const DEFAULT_RENDER_DEVICE: &str = "CABLE Input";

#[derive(Debug)]
struct Config {
    pid: u32,
    render_device: String,
    duration: Option<Duration>,
    gate_threshold: i16,
    pre_roll_frames: usize,
    hangover_frames: usize,
}

fn parse_args() -> Result<Config, String> {
    let mut args = env::args().skip(1);
    let mut pid = None;
    let mut render_device = DEFAULT_RENDER_DEVICE.to_owned();
    let mut duration = None;
    let mut gate_threshold = 64_i16;
    let mut pre_roll_ms = 60_u64;
    let mut hangover_ms = 300_u64;
    while let Some(arg) = args.next() {
        let value = |args: &mut std::iter::Skip<env::Args>, name: &str| {
            args.next()
                .ok_or_else(|| format!("{name} requires a value"))
        };
        match arg.as_str() {
            "--pid" => {
                pid = Some(
                    value(&mut args, "--pid")?
                        .parse()
                        .map_err(|_| "--pid must be an integer")?,
                );
            }
            "--render-device" => render_device = value(&mut args, "--render-device")?,
            "--duration" => {
                let seconds: f64 = value(&mut args, "--duration")?
                    .parse()
                    .map_err(|_| "--duration must be a number")?;
                if !seconds.is_finite() || seconds <= 0.0 {
                    return Err("--duration must be positive".into());
                }
                duration = Some(Duration::from_secs_f64(seconds));
            }
            "--gate-threshold" => {
                gate_threshold = value(&mut args, "--gate-threshold")?
                    .parse()
                    .map_err(|_| "--gate-threshold must be an integer")?;
                if gate_threshold < 0 {
                    return Err("--gate-threshold must be non-negative".into());
                }
            }
            "--pre-roll-ms" => {
                pre_roll_ms = value(&mut args, "--pre-roll-ms")?
                    .parse()
                    .map_err(|_| "--pre-roll-ms must be an integer")?;
            }
            "--hangover-ms" => {
                hangover_ms = value(&mut args, "--hangover-ms")?
                    .parse()
                    .map_err(|_| "--hangover-ms must be an integer")?;
            }
            "--help" | "-h" => {
                return Err("usage: stackchan-wasapi-broker --pid PID [--render-device NAME] [--duration SECONDS] [--gate-threshold N] [--pre-roll-ms N] [--hangover-ms N]".into());
            }
            _ => return Err(format!("unknown argument: {arg}")),
        }
    }
    let pid = pid.ok_or("--pid is required")?;
    if pid == 0 || render_device.trim().is_empty() || pre_roll_ms % 60 != 0 || hangover_ms % 60 != 0
    {
        return Err(
            "pid/device must be valid and gate durations must be multiples of 60 ms".into(),
        );
    }
    Ok(Config {
        pid,
        render_device,
        duration,
        gate_threshold,
        pre_roll_frames: (pre_roll_ms / 60) as usize,
        hangover_frames: (hangover_ms / 60) as usize,
    })
}

#[derive(Debug, Default)]
struct GateDecision {
    frames: Vec<Vec<i16>>,
    stopped: bool,
}

struct ActivityGate {
    threshold: i16,
    pre_roll_limit: usize,
    pre_roll: VecDeque<Vec<i16>>,
    hangover_frames: usize,
    hangover_remaining: usize,
    active: bool,
}

impl ActivityGate {
    fn new(threshold: i16, pre_roll_limit: usize, hangover_frames: usize) -> Self {
        Self {
            threshold,
            pre_roll_limit,
            pre_roll: VecDeque::with_capacity(pre_roll_limit),
            hangover_frames,
            hangover_remaining: 0,
            active: false,
        }
    }

    fn push(&mut self, frame: Vec<i16>) -> GateDecision {
        let peak = pcm_peak(&frame);
        if peak >= self.threshold {
            let mut frames = self.pre_roll.drain(..).collect::<Vec<_>>();
            frames.push(frame);
            self.active = true;
            self.hangover_remaining = self.hangover_frames;
            return GateDecision {
                frames,
                stopped: false,
            };
        }
        if self.active && self.hangover_remaining > 0 {
            self.hangover_remaining -= 1;
            return GateDecision {
                frames: vec![frame],
                stopped: false,
            };
        }
        let stopped = self.active;
        self.active = false;
        if self.pre_roll_limit > 0 {
            if self.pre_roll.len() == self.pre_roll_limit {
                self.pre_roll.pop_front();
            }
            self.pre_roll.push_back(frame);
        }
        GateDecision {
            frames: Vec::new(),
            stopped,
        }
    }
}

fn pcm_peak(samples: &[i16]) -> i16 {
    samples
        .iter()
        .map(|sample| sample.unsigned_abs())
        .max()
        .unwrap_or(0)
        .min(i16::MAX as u16) as i16
}

fn write_packet(writer: &mut impl Write, packet: &[u8]) -> io::Result<()> {
    if packet.len() > MAX_OPUS_PACKET_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "Opus packet exceeds protocol limit",
        ));
    }
    writer.write_all(&(packet.len() as u32).to_be_bytes())?;
    writer.write_all(packet)?;
    writer.flush()
}

fn read_packet(reader: &mut impl Read) -> io::Result<Option<Vec<u8>>> {
    let mut header = [0_u8; 4];
    match reader.read_exact(&mut header) {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(error) => return Err(error),
    }
    let length = u32::from_be_bytes(header) as usize;
    if length > MAX_OPUS_PACKET_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "Opus packet exceeds protocol limit",
        ));
    }
    let mut packet = vec![0_u8; length];
    reader.read_exact(&mut packet)?;
    Ok(Some(packet))
}

fn samples_from_bytes(bytes: impl Iterator<Item = u8>, count: usize) -> Vec<i16> {
    let raw = bytes.take(count * 2).collect::<Vec<_>>();
    raw.chunks_exact(2)
        .map(|sample| i16::from_le_bytes([sample[0], sample[1]]))
        .collect()
}

fn samples_to_bytes(samples: &[i16]) -> Vec<u8> {
    samples
        .iter()
        .flat_map(|sample| sample.to_le_bytes())
        .collect()
}

fn find_render_device(name: &str) -> Result<Device, DynError> {
    let enumerator = DeviceEnumerator::new()?;
    let collection = enumerator.get_device_collection(&Direction::Render)?;
    let wanted = name.to_lowercase();
    let mut partial = Vec::new();
    for index in 0..collection.get_nbr_devices()? {
        let device = collection.get_device_at_index(index)?;
        let friendly = device.get_friendlyname()?;
        if friendly.eq_ignore_ascii_case(name) {
            return Ok(device);
        }
        if friendly.to_lowercase().contains(&wanted) {
            partial.push((friendly, device));
        }
    }
    if partial.len() == 1 {
        return Ok(partial.pop().expect("one partial device").1);
    }
    let candidates = partial
        .into_iter()
        .map(|(friendly, _)| friendly)
        .collect::<Vec<_>>();
    Err(
        format!("render device '{name}' is not unique or unavailable; matches={candidates:?}")
            .into(),
    )
}

fn stdin_decoder(sender: mpsc::SyncSender<Vec<u8>>, stop: Arc<AtomicBool>) -> Result<(), DynError> {
    let mut decoder = Decoder::new(RENDER_SAMPLE_RATE, Channels::Mono)?;
    let mut stdin = io::stdin().lock();
    let mut decoded = vec![0_i16; RENDER_FRAME_SAMPLES];
    while !stop.load(Ordering::Relaxed) {
        let Some(packet) = read_packet(&mut stdin)? else {
            break;
        };
        if packet.is_empty() {
            decoder.reset_state()?;
            continue;
        }
        let samples = decoder.decode(&packet, &mut decoded, false)?;
        if samples != RENDER_FRAME_SAMPLES {
            return Err(
                format!("expected {RENDER_FRAME_SAMPLES} decoded samples, got {samples}").into(),
            );
        }
        sender.send(samples_to_bytes(&decoded[..samples]))?;
    }
    stop.store(true, Ordering::Relaxed);
    Ok(())
}

fn render_loop(
    device_name: String,
    receiver: mpsc::Receiver<Vec<u8>>,
    stop: Arc<AtomicBool>,
) -> Result<(), DynError> {
    initialize_mta().ok()?;
    let device = find_render_device(&device_name)?;
    let friendly_name = device.get_friendlyname()?;
    let mut audio_client = device.get_iaudioclient()?;
    let format = WaveFormat::new(
        16,
        16,
        &SampleType::Int,
        RENDER_SAMPLE_RATE as usize,
        1,
        None,
    );
    let block_align = format.get_blockalign() as usize;
    let (default_period, _) = audio_client.get_device_period()?;
    audio_client.initialize_client(
        &format,
        &Direction::Render,
        &StreamMode::EventsShared {
            autoconvert: true,
            buffer_duration_hns: default_period,
        },
    )?;
    let event = audio_client.set_get_eventhandle()?;
    let render_client = audio_client.get_audiorenderclient()?;
    let mut queue = VecDeque::<u8>::new();
    let mut rendered_frames = 0_u64;
    let mut silent_frames = 0_u64;
    eprintln!(
        "WASAPI render ready device={friendly_name:?} input_rate={RENDER_SAMPLE_RATE} channels=1"
    );
    audio_client.start_stream()?;
    while !stop.load(Ordering::Relaxed) || !queue.is_empty() {
        let available = audio_client.get_available_space_in_frames()? as usize;
        let required = available * block_align;
        while queue.len() < required {
            match receiver.try_recv() {
                Ok(chunk) => queue.extend(chunk),
                Err(mpsc::TryRecvError::Empty) => {
                    silent_frames += (required - queue.len()) as u64 / block_align as u64;
                    queue.resize(required, 0);
                }
                Err(mpsc::TryRecvError::Disconnected) => {
                    stop.store(true, Ordering::Relaxed);
                    queue.resize(required, 0);
                }
            }
        }
        if available > 0 {
            render_client.write_to_device_from_deque(available, &mut queue, None)?;
            rendered_frames += available as u64;
        }
        let _ = event.wait_for_event(100);
    }
    audio_client.stop_stream()?;
    eprintln!(
        "WASAPI render stopped rendered_frames={rendered_frames} silent_frames={silent_frames}"
    );
    Ok(())
}

fn capture_loop(config: &Config, stop: Arc<AtomicBool>) -> Result<(), DynError> {
    initialize_mta().ok()?;
    let format = WaveFormat::new(
        16,
        16,
        &SampleType::Int,
        CAPTURE_SAMPLE_RATE as usize,
        1,
        None,
    );
    let block_align = format.get_blockalign() as usize;
    let mut audio_client = AudioClient::new_application_loopback_client(config.pid, true)?;
    audio_client.initialize_client(
        &format,
        &Direction::Capture,
        &StreamMode::EventsShared {
            autoconvert: true,
            buffer_duration_hns: 0,
        },
    )?;
    let event = audio_client.set_get_eventhandle()?;
    let capture_client = audio_client.get_audiocaptureclient()?;
    let mut encoder = Encoder::new(CAPTURE_SAMPLE_RATE, Channels::Mono, Application::Audio)?;
    encoder.set_bitrate(Bitrate::Bits(48_000))?;
    encoder.set_vbr(true)?;
    let mut gate = ActivityGate::new(
        config.gate_threshold,
        config.pre_roll_frames,
        config.hangover_frames,
    );
    let started = Instant::now();
    let mut bytes = VecDeque::<u8>::new();
    let mut stdout = io::stdout().lock();
    let mut captured_frames = 0_u64;
    let mut emitted_frames = 0_u64;
    let mut activity_stops = 0_u64;
    let mut discontinuities = 0_u64;
    eprintln!(
        "WASAPI capture ready pid={} include_tree=true sample_rate={} channels=1 frame_ms=60 opus_bitrate=48000",
        config.pid, CAPTURE_SAMPLE_RATE
    );
    audio_client.start_stream()?;
    while !stop.load(Ordering::Relaxed)
        && !config
            .duration
            .is_some_and(|duration| started.elapsed() >= duration)
    {
        let mut packet_frames = capture_client.get_next_packet_size()?.unwrap_or(0);
        if packet_frames == 0 {
            let _ = event.wait_for_event(100);
            continue;
        }
        while packet_frames > 0 {
            let before = bytes.len();
            let info = capture_client.read_from_device_to_deque(&mut bytes)?;
            if info.flags.data_discontinuity {
                discontinuities += 1;
            }
            let expected = packet_frames as usize * block_align;
            if info.flags.silent && bytes.len() - before < expected {
                bytes.extend(std::iter::repeat_n(0, expected - (bytes.len() - before)));
            }
            while bytes.len() >= CAPTURE_FRAME_BYTES {
                let samples =
                    samples_from_bytes(bytes.drain(..CAPTURE_FRAME_BYTES), CAPTURE_FRAME_SAMPLES);
                captured_frames += 1;
                let decision = gate.push(samples);
                for frame in decision.frames {
                    let packet = encoder.encode_vec(&frame, MAX_OPUS_PACKET_BYTES)?;
                    write_packet(&mut stdout, &packet)?;
                    emitted_frames += 1;
                }
                if decision.stopped {
                    write_packet(&mut stdout, &[])?;
                    activity_stops += 1;
                }
            }
            packet_frames = capture_client.get_next_packet_size()?.unwrap_or(0);
        }
    }
    if gate.active {
        write_packet(&mut stdout, &[])?;
        activity_stops += 1;
    }
    audio_client.stop_stream()?;
    eprintln!(
        "WASAPI capture stopped captured_frames={captured_frames} emitted_frames={emitted_frames} activity_stops={activity_stops} discontinuities={discontinuities}"
    );
    Ok(())
}

fn run(config: Config) -> Result<(), DynError> {
    let stop = Arc::new(AtomicBool::new(false));
    let (render_sender, render_receiver) = mpsc::sync_channel::<Vec<u8>>(8);

    let decoder_stop = Arc::clone(&stop);
    thread::spawn(move || {
        if let Err(error) = stdin_decoder(render_sender, Arc::clone(&decoder_stop)) {
            eprintln!("WASAPI stdin decoder failed: {error}");
            decoder_stop.store(true, Ordering::Relaxed);
        }
    });

    let render_stop = Arc::clone(&stop);
    let render_device = config.render_device.clone();
    let render_thread =
        thread::spawn(move || render_loop(render_device, render_receiver, render_stop));

    let capture_result = capture_loop(&config, Arc::clone(&stop));
    stop.store(true, Ordering::Relaxed);
    let render_result = render_thread
        .join()
        .map_err(|_| "WASAPI render thread panicked")?;
    capture_result?;
    render_result
}

fn main() {
    let result = parse_args().map_err(|error| error.into()).and_then(run);
    if let Err(error) = result {
        eprintln!("stackchan-wasapi-broker: {error}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pcm(value: i16) -> Vec<i16> {
        vec![value; CAPTURE_FRAME_SAMPLES]
    }

    #[test]
    fn framed_packets_round_trip_and_reject_oversize() {
        let mut wire = Vec::new();
        write_packet(&mut wire, &[1, 2, 3]).unwrap();
        write_packet(&mut wire, &[]).unwrap();
        let mut input = wire.as_slice();
        assert_eq!(read_packet(&mut input).unwrap(), Some(vec![1, 2, 3]));
        assert_eq!(read_packet(&mut input).unwrap(), Some(Vec::new()));
        assert_eq!(read_packet(&mut input).unwrap(), None);
        assert!(write_packet(&mut Vec::new(), &vec![0; MAX_OPUS_PACKET_BYTES + 1]).is_err());
    }

    #[test]
    fn activity_gate_preserves_preroll_and_emits_one_stop() {
        let mut gate = ActivityGate::new(64, 1, 1);
        assert!(gate.push(pcm(0)).frames.is_empty());
        let attack = gate.push(pcm(100));
        assert_eq!(attack.frames.len(), 2);
        assert!(!attack.stopped);
        assert_eq!(gate.push(pcm(0)).frames.len(), 1);
        let stop = gate.push(pcm(0));
        assert!(stop.frames.is_empty());
        assert!(stop.stopped);
        assert!(!gate.push(pcm(0)).stopped);
    }

    #[test]
    fn opus_downlink_frame_is_24khz_mono_60ms_and_decodable() {
        let source = (0..CAPTURE_FRAME_SAMPLES)
            .map(|index| {
                (((index as f32 * 440.0 * std::f32::consts::TAU / CAPTURE_SAMPLE_RATE as f32)
                    .sin())
                    * 10_000.0) as i16
            })
            .collect::<Vec<_>>();
        let mut encoder =
            Encoder::new(CAPTURE_SAMPLE_RATE, Channels::Mono, Application::Audio).unwrap();
        encoder.set_bitrate(Bitrate::Bits(48_000)).unwrap();
        let packet = encoder.encode_vec(&source, MAX_OPUS_PACKET_BYTES).unwrap();
        assert!(!packet.is_empty());
        assert!(packet.len() <= MAX_OPUS_PACKET_BYTES);
        let mut decoder = Decoder::new(CAPTURE_SAMPLE_RATE, Channels::Mono).unwrap();
        let mut decoded = vec![0_i16; CAPTURE_FRAME_SAMPLES];
        let samples = decoder.decode(&packet, &mut decoded, false).unwrap();
        assert_eq!(samples, CAPTURE_FRAME_SAMPLES);
        assert!(pcm_peak(&decoded) > 1_000);
    }
}

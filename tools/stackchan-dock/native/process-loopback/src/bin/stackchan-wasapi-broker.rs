use std::collections::{HashSet, VecDeque};
use std::env;
use std::io::{self, Read, Write};
use std::sync::atomic::{AtomicBool, AtomicU16, Ordering};
use std::sync::{mpsc, Arc};
use std::thread;
use std::time::{Duration, Instant};

use opus::{Application, Bitrate, Channels, Decoder, Encoder};
use wasapi::{
    initialize_mta, AudioClient, Device, DeviceEnumerator, Direction, SampleType, StreamMode,
    WaveFormat,
};
use windows::core::{GUID, HSTRING, HRESULT, IInspectable_Vtbl, IUnknown, Interface};
use windows::Win32::Media::Audio::{eMultimedia, eRender, IAudioSessionControl2, IAudioSessionManager2, IMMDeviceEnumerator, MMDeviceEnumerator};
use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_ALL};
use windows::Win32::System::Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS};
use windows::Win32::System::WinRT::RoGetActivationFactory;

type DynError = Box<dyn std::error::Error + Send + Sync>;

const CAPTURE_SAMPLE_RATE: u32 = 24_000;
const CAPTURE_FRAME_SAMPLES: usize = 1_440;
const CAPTURE_FRAME_BYTES: usize = CAPTURE_FRAME_SAMPLES * 2;
const RENDER_SAMPLE_RATE: u32 = 16_000;
const RENDER_FRAME_SAMPLES: usize = 960;
const MAX_OPUS_PACKET_BYTES: usize = 1_500;
const DEFAULT_RENDER_DEVICE: &str = "CABLE Input";
const CONTROL_ROUTE: &[u8] = b"STACKCHAN:route";
const CONTROL_RESTORE_ROUTE: &[u8] = b"STACKCHAN:restore_route";
const CONTROL_OUTPUT_GAIN_PREFIX: &[u8] = b"STACKCHAN:output_gain_percent=";

#[repr(transparent)] #[derive(Clone, PartialEq, Eq)] struct AudioPolicyConfigFactory(IUnknown);
unsafe impl Interface for AudioPolicyConfigFactory { type Vtable = AudioPolicyConfigFactoryVtbl; const IID: GUID = GUID::from_u128(0xab3d4648_e242_459f_b02f_541c70306324); }
#[repr(C)] struct AudioPolicyConfigFactoryVtbl { base: IInspectable_Vtbl, reserved: [usize; 19], set_endpoint: unsafe extern "system" fn(*mut core::ffi::c_void, u32, i32, u32, *mut core::ffi::c_void) -> HRESULT }

fn redact_endpoint(endpoint: Option<&str>) -> String {
    match endpoint {
        None => "<system-default>".to_owned(),
        Some(value) => format!("<endpoint …{}>", value.chars().rev().take(8).collect::<String>().chars().rev().collect::<String>()),
    }
}

fn audio_policy_endpoint_path(device_id: &str) -> String {
    format!("\\\\?\\SWD#MMDEVAPI#{device_id}#{{e6327cad-dcec-4949-ae8a-991e976a79d2}}")
}

fn process_tree_pids(root_pid: u32) -> Result<HashSet<u32>, DynError> {
    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)? };
    let mut entries = Vec::new();
    let mut entry = PROCESSENTRY32W { dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32, ..Default::default() };
    if unsafe { Process32FirstW(snapshot, &mut entry).is_ok() } {
        loop {
            entries.push((entry.th32ProcessID, entry.th32ParentProcessID));
            entry = PROCESSENTRY32W { dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32, ..Default::default() };
            if unsafe { Process32NextW(snapshot, &mut entry).is_err() } { break; }
        }
    }
    let mut descendants = HashSet::from([root_pid]);
    let mut changed = true;
    while changed {
        changed = false;
        for (pid, parent) in &entries {
            if descendants.contains(parent) && descendants.insert(*pid) { changed = true; }
        }
    }
    Ok(descendants)
}

fn default_render_session_pids() -> Result<Vec<u32>, DynError> {
    let enumerator: IMMDeviceEnumerator = unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)? };
    let device = unsafe { enumerator.GetDefaultAudioEndpoint(eRender, eMultimedia)? };
    let manager: IAudioSessionManager2 = unsafe { device.Activate(CLSCTX_ALL, None)? };
    let sessions = unsafe { manager.GetSessionEnumerator()? };
    let mut pids = Vec::new();
    for index in 0..unsafe { sessions.GetCount()? } {
        let control = unsafe { sessions.GetSession(index)? };
        let control2: IAudioSessionControl2 = control.cast()?;
        pids.push(unsafe { control2.GetProcessId()? });
    }
    Ok(pids)
}

fn select_audio_policy_target(root_pid: u32, descendants: &HashSet<u32>, session_pids: &[u32]) -> Result<u32, DynError> {
    let candidates = session_pids.iter().copied().filter(|pid| *pid != root_pid && descendants.contains(pid)).collect::<HashSet<_>>();
    if candidates.len() != 1 {
        return Err(format!("AudioPolicy target is ambiguous: root_pid={root_pid} session_pids={session_pids:?} candidates={candidates:?}").into());
    }
    Ok(*candidates.iter().next().expect("one candidate"))
}

fn live_audio_policy_target(root_pid: u32) -> Result<u32, DynError> {
    initialize_mta().ok()?;
    let descendants = process_tree_pids(root_pid)?;
    let session_pids = default_render_session_pids()?;
    let target = select_audio_policy_target(root_pid, &descendants, &session_pids)?;
    eprintln!("WASAPI AudioPolicy target root_pid={root_pid} target_pid={target} session_pids={session_pids:?} reason=unique_default_render_session_descendant");
    Ok(target)
}

fn set_codex_audio_route(root_pid: u32, target_pid: u32, render_device: &str, routed: bool) -> Result<(), DynError> {
    initialize_mta().ok()?;
    let factory: AudioPolicyConfigFactory = unsafe { RoGetActivationFactory(&HSTRING::from("Windows.Media.Internal.AudioPolicyConfig"))? };
    // Preserve the endpoint form that was verified in the last known-good
    // Owner runtime. This is a per-process policy; it does not change the
    // global default render device.
    let path = if routed {
        let id = find_render_device(render_device)?.get_id()?;
        Some(audio_policy_endpoint_path(&id))
    } else { None };
    let text = path.as_ref().map(HSTRING::from);
    let this = unsafe { core::mem::transmute_copy::<AudioPolicyConfigFactory, *mut core::ffi::c_void>(&factory) };
    let vtable = unsafe { *(this as *const *const AudioPolicyConfigFactoryVtbl) };
    let value = text.as_ref().map_or(core::ptr::null_mut(), |s| unsafe { core::mem::transmute_copy::<HSTRING, *mut core::ffi::c_void>(s) });
    let endpoint = redact_endpoint(path.as_deref());
    for role in [0_u32, 1_u32] {
        match unsafe { ((*vtable).set_endpoint)(this, target_pid, 0, role, value).ok() } {
            Ok(()) => eprintln!("WASAPI Codex output route {} root_pid={root_pid} target_pid={target_pid} role={role} endpoint={endpoint} result=ok", if routed { "set" } else { "restored" }),
            Err(error) => {
                eprintln!("WASAPI Codex output route {} root_pid={root_pid} target_pid={target_pid} role={role} endpoint={endpoint} result=error error={error}", if routed { "set" } else { "restored" });
                return Err(error.into());
            }
        }
    }
    Ok(())
}

#[derive(Debug)]
struct Config {
    pid: u32,
    render_device: String,
    duration: Option<Duration>,
    gate_threshold: i16,
    pre_roll_frames: usize,
    hangover_frames: usize,
    output_gain_percent: u16,
}

fn parse_args() -> Result<Config, String> {
    let mut args = env::args().skip(1);
    let mut pid = None;
    let mut render_device = DEFAULT_RENDER_DEVICE.to_owned();
    let mut duration = None;
    let mut gate_threshold = 64_i16;
    let mut pre_roll_ms = 60_u64;
    let mut hangover_ms = 300_u64;
    let mut output_gain_percent = 100_u16;
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
            "--output-gain-percent" => {
                output_gain_percent = value(&mut args, "--output-gain-percent")?
                    .parse()
                    .map_err(|_| "--output-gain-percent must be an integer")?;
                if !(100..=150).contains(&output_gain_percent) {
                    return Err("--output-gain-percent must be in range 100..150".into());
                }
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
        output_gain_percent,
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

// Unity is deliberately byte-for-byte unchanged.  Above unity, preserve the
// requested linear gain through 28,000 then use an exponential soft knee that
// approaches, but never exceeds, s16 full scale.  That avoids uncontrolled
// integer overflow and hard clipping before Opus encoding.
fn apply_output_gain(samples: &[i16], gain_percent: u16) -> Vec<i16> {
    if gain_percent == 100 { return samples.to_vec(); }
    let gain = gain_percent as f32 / 100.0;
    const KNEE: f32 = 28_000.0;
    const FULL_SCALE: f32 = 32_767.0;
    samples.iter().map(|sample| {
        let amplified = *sample as f32 * gain;
        let magnitude = amplified.abs();
        let limited = if magnitude <= KNEE {
            magnitude
        } else {
            KNEE + (FULL_SCALE - KNEE) * (1.0 - (-(magnitude - KNEE) / (FULL_SCALE - KNEE)).exp())
        };
        (amplified.signum() * limited).round() as i16
    }).collect()
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

#[cfg(test)]
fn apply_audio_route_control(action: &str, route: impl FnOnce() -> Result<(), DynError>) {
    // Routing is best-effort policy cleanup. A stale persisted endpoint must
    // not tear down capture or robot speaker rendering.
    if let Err(error) = route() {
        eprintln!("WASAPI audio route {action} failed (nonfatal): {error}");
    }
}

fn apply_live_audio_route(action: &str, root_pid: u32, render_device: &str, routed: bool, last_target_pid: &mut Option<u32>) {
    let target = if routed {
        live_audio_policy_target(root_pid)
    } else if let Some(pid) = *last_target_pid {
        Ok(pid)
    } else {
        live_audio_policy_target(root_pid)
    };
    match target.and_then(|target_pid| {
        set_codex_audio_route(root_pid, target_pid, render_device, routed)?;
        Ok(target_pid)
    }) {
        Ok(target_pid) if routed => *last_target_pid = Some(target_pid),
        Ok(_) => *last_target_pid = None,
        Err(error) => eprintln!("WASAPI audio route {action} failed (nonfatal): {error}"),
    }
}

fn stdin_decoder(sender: mpsc::SyncSender<Vec<u8>>, stop: Arc<AtomicBool>, root_pid: u32, render_device: String, output_gain_percent: Arc<AtomicU16>) -> Result<(), DynError> {
    let mut decoder = Decoder::new(RENDER_SAMPLE_RATE, Channels::Mono)?;
    let mut stdin = io::stdin().lock();
    let mut decoded = vec![0_i16; RENDER_FRAME_SAMPLES];
    let mut last_target_pid = None;
    while !stop.load(Ordering::Relaxed) {
        let Some(packet) = read_packet(&mut stdin)? else {
            break;
        };
        if packet == CONTROL_ROUTE {
            apply_live_audio_route("set", root_pid, &render_device, true, &mut last_target_pid);
            continue;
        }
        if packet == CONTROL_RESTORE_ROUTE {
            apply_live_audio_route("restore", root_pid, &render_device, false, &mut last_target_pid);
            continue;
        }
        if let Some(value) = packet.strip_prefix(CONTROL_OUTPUT_GAIN_PREFIX) {
            let percent = std::str::from_utf8(value)?.parse::<u16>()?;
            if !(100..=150).contains(&percent) { return Err("output gain control must be in range 100..150".into()); }
            output_gain_percent.store(percent, Ordering::Release);
            eprintln!("WASAPI output gain percent={percent} limiter=soft_knee");
            continue;
        }
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
    apply_live_audio_route("restore_on_exit", root_pid, &render_device, false, &mut last_target_pid);
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

fn capture_loop(config: &Config, stop: Arc<AtomicBool>, output_gain_percent: Arc<AtomicU16>) -> Result<(), DynError> {
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
                    let gained = apply_output_gain(&frame, output_gain_percent.load(Ordering::Acquire));
                    let packet = encoder.encode_vec(&gained, MAX_OPUS_PACKET_BYTES)?;
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
    let output_gain_percent = Arc::new(AtomicU16::new(config.output_gain_percent));

    let decoder_stop = Arc::clone(&stop);
    let decoder_render_device = config.render_device.clone();
    let decoder_output_gain_percent = Arc::clone(&output_gain_percent);
    thread::spawn(move || {
        if let Err(error) = stdin_decoder(render_sender, Arc::clone(&decoder_stop), config.pid, decoder_render_device, decoder_output_gain_percent) {
            eprintln!("WASAPI stdin decoder failed: {error}");
            decoder_stop.store(true, Ordering::Relaxed);
        }
    });

    let render_stop = Arc::clone(&stop);
    let render_device = config.render_device.clone();
    let render_thread =
        thread::spawn(move || render_loop(render_device, render_receiver, render_stop));

    let capture_result = capture_loop(&config, Arc::clone(&stop), Arc::clone(&output_gain_percent));
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
    fn output_gain_preserves_unity_and_soft_limits_boost() {
        let source = vec![12_000, 20_000, i16::MAX, i16::MIN];
        assert_eq!(apply_output_gain(&source, 100), source);
        let boosted = apply_output_gain(&source, 150);
        assert_eq!(boosted[0], 18_000);
        assert!(boosted[1] > 27_000 && boosted[1] < i16::MAX);
        assert!(boosted[2] <= i16::MAX && boosted[2] > 27_000);
        assert!(boosted[3] >= -i16::MAX && boosted[3] < -27_000);
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

    #[test]
    fn route_policy_failure_is_nonfatal_and_does_not_block_following_audio_work() {
        let (sender, receiver) = mpsc::sync_channel::<Vec<u8>>(1);
        apply_audio_route_control("restore", || Err("simulated AudioPolicy E_INVALIDARG".into()));
        sender.send(vec![1, 2, 3]).unwrap();
        assert_eq!(receiver.recv().unwrap(), vec![1, 2, 3]);
    }

    #[test]
    fn audio_policy_preserves_last_known_good_endpoint_path_and_redacts_it() {
        let endpoint = "{0.0.0.00000000}.{12345678-1234-1234-1234-123456789abc}";
        let path = audio_policy_endpoint_path(endpoint);
        assert_eq!(path, "\\\\?\\SWD#MMDEVAPI#{0.0.0.00000000}.{12345678-1234-1234-1234-123456789abc}#{e6327cad-dcec-4949-ae8a-991e976a79d2}");
        assert!(!redact_endpoint(Some(&path)).contains(endpoint));
        assert_eq!(redact_endpoint(None), "<system-default>");
    }

    #[test]
    fn audio_policy_selects_exactly_one_live_descendant_session() {
        let descendants = HashSet::from([100, 101, 102]);
        assert_eq!(select_audio_policy_target(100, &descendants, &[999, 102]).unwrap(), 102);
        assert!(select_audio_policy_target(100, &descendants, &[999]).is_err());
        assert!(select_audio_policy_target(100, &descendants, &[101, 102]).is_err());
    }
}

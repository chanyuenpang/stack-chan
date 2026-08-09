use std::collections::VecDeque;
use std::env;
use std::fs::File;
use std::io::Write;
use std::time::{Duration, Instant};

use wasapi::{
    initialize_mta, Device, DeviceEnumerator, Direction, SampleType, StreamMode, WaveFormat,
};

type DynError = Box<dyn std::error::Error + Send + Sync>;

struct Config {
    device_name: String,
    sample_rate: u32,
    duration: Duration,
    output: String,
}

fn parse_args() -> Result<Config, String> {
    let mut args = env::args().skip(1);
    let mut device_name = None;
    let mut sample_rate = None;
    let mut duration = None;
    let mut output = None;
    while let Some(arg) = args.next() {
        let value = args
            .next()
            .ok_or_else(|| format!("{arg} requires a value"))?;
        match arg.as_str() {
            "--device" => device_name = Some(value),
            "--sample-rate" => {
                sample_rate = Some(
                    value
                        .parse()
                        .map_err(|_| "sample rate must be an integer")?,
                );
            }
            "--duration" => {
                let seconds: f64 = value.parse().map_err(|_| "duration must be a number")?;
                if !seconds.is_finite() || seconds <= 0.0 {
                    return Err("duration must be positive".into());
                }
                duration = Some(Duration::from_secs_f64(seconds));
            }
            "--output" => output = Some(value),
            _ => return Err(format!("unknown argument: {arg}")),
        }
    }
    let sample_rate = sample_rate.ok_or("--sample-rate is required")?;
    if !matches!(sample_rate, 16_000 | 24_000 | 48_000) {
        return Err("sample rate must be 16000, 24000, or 48000".into());
    }
    Ok(Config {
        device_name: device_name.ok_or("--device is required")?,
        sample_rate,
        duration: duration.ok_or("--duration is required")?,
        output: output.ok_or("--output is required")?,
    })
}

fn find_capture_device(name: &str) -> Result<Device, DynError> {
    let enumerator = DeviceEnumerator::new()?;
    let collection = enumerator.get_device_collection(&Direction::Capture)?;
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
        format!("capture device '{name}' is not unique or unavailable; matches={candidates:?}")
            .into(),
    )
}

fn capture(config: Config) -> Result<(), DynError> {
    initialize_mta().ok()?;
    let device = find_capture_device(&config.device_name)?;
    let friendly_name = device.get_friendlyname()?;
    let mut audio_client = device.get_iaudioclient()?;
    let format = WaveFormat::new(
        16,
        16,
        &SampleType::Int,
        config.sample_rate as usize,
        1,
        None,
    );
    let block_align = format.get_blockalign() as usize;
    let (default_period, _) = audio_client.get_device_period()?;
    audio_client.initialize_client(
        &format,
        &Direction::Capture,
        &StreamMode::EventsShared {
            autoconvert: true,
            buffer_duration_hns: default_period,
        },
    )?;
    let event = audio_client.set_get_eventhandle()?;
    let capture_client = audio_client.get_audiocaptureclient()?;
    let mut output = File::create(&config.output)?;
    let mut queue = VecDeque::<u8>::new();
    let target_frames =
        (config.duration.as_secs_f64() * config.sample_rate as f64).round() as usize;
    let mut captured_frames = 0_usize;
    let mut discontinuities = 0_u64;
    let mut silent_frames = 0_u64;
    let started = Instant::now();
    eprintln!(
        "WASAPI endpoint capture ready device={friendly_name:?} sample_rate={} channels=1 target_frames={target_frames}",
        config.sample_rate
    );
    audio_client.start_stream()?;
    while captured_frames < target_frames {
        let before = queue.len();
        let info = capture_client.read_from_device_to_deque(&mut queue)?;
        if info.flags.data_discontinuity {
            discontinuities += 1;
        }
        if info.flags.silent {
            silent_frames += (queue.len() - before) as u64 / block_align as u64;
        }
        let available_frames = queue.len() / block_align;
        if available_frames > 0 {
            let frames = available_frames.min(target_frames - captured_frames);
            let bytes = queue.drain(..frames * block_align).collect::<Vec<_>>();
            output.write_all(&bytes)?;
            captured_frames += frames;
        }
        if captured_frames < target_frames {
            let _ = event.wait_for_event(500);
        }
        if started.elapsed() > config.duration + Duration::from_secs(5) {
            return Err(format!(
                "capture timed out after {captured_frames}/{target_frames} frames"
            )
            .into());
        }
    }
    audio_client.stop_stream()?;
    output.flush()?;
    eprintln!(
        "WASAPI endpoint capture stopped captured_frames={captured_frames} silent_frames={silent_frames} discontinuities={discontinuities} elapsed_ms={}",
        started.elapsed().as_millis()
    );
    Ok(())
}

fn main() {
    let result = parse_args().map_err(|error| error.into()).and_then(capture);
    if let Err(error) = result {
        eprintln!("stackchan-wasapi-capture: {error}");
        std::process::exit(1);
    }
}

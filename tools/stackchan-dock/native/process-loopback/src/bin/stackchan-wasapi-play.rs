use std::collections::VecDeque;
use std::env;
use std::fs;
use std::thread;
use std::time::Duration;

use wasapi::{
    initialize_mta, Device, DeviceEnumerator, Direction, SampleType, StreamMode, WaveFormat,
};

type DynError = Box<dyn std::error::Error + Send + Sync>;

struct Config {
    device_name: String,
    sample_rate: u32,
    input: String,
    start_delay: Duration,
}

fn parse_args() -> Result<Config, String> {
    let mut args = env::args().skip(1);
    let mut device_name = None;
    let mut sample_rate = None;
    let mut input = None;
    let mut start_delay_ms = 0_u64;
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
            "--input" => input = Some(value),
            "--start-delay-ms" => {
                start_delay_ms = value
                    .parse()
                    .map_err(|_| "start delay must be an integer")?;
            }
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
        input: input.ok_or("--input is required")?,
        start_delay: Duration::from_millis(start_delay_ms),
    })
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

fn play(config: Config) -> Result<(), DynError> {
    initialize_mta().ok()?;
    let input = fs::read(&config.input)?;
    if input.is_empty() || input.len() % 2 != 0 {
        return Err("input must contain non-empty mono s16le PCM".into());
    }
    let source_frames = input.len() / 2;
    let mut queue = VecDeque::from(input);
    let device = find_render_device(&config.device_name)?;
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
        &Direction::Render,
        &StreamMode::EventsShared {
            autoconvert: true,
            buffer_duration_hns: default_period,
        },
    )?;
    let event = audio_client.set_get_eventhandle()?;
    let render_client = audio_client.get_audiorenderclient()?;
    eprintln!(
        "WASAPI fixture ready device={friendly_name:?} sample_rate={} channels=1 source_frames={source_frames} start_delay_ms={}",
        config.sample_rate,
        config.start_delay.as_millis()
    );
    thread::sleep(config.start_delay);
    audio_client.start_stream()?;
    let mut submitted_source_frames = 0_usize;
    while !queue.is_empty() {
        let available = audio_client.get_available_space_in_frames()? as usize;
        if available > 0 {
            let source_bytes = queue.len().min(available * block_align);
            submitted_source_frames += source_bytes / block_align;
            let mut outgoing = queue.drain(..source_bytes).collect::<VecDeque<_>>();
            outgoing.resize(available * block_align, 0);
            render_client.write_to_device_from_deque(available, &mut outgoing, None)?;
        }
        if !queue.is_empty() {
            let _ = event.wait_for_event(500);
        }
    }
    thread::sleep(Duration::from_millis(300));
    audio_client.stop_stream()?;
    eprintln!(
        "WASAPI fixture stopped submitted_source_frames={submitted_source_frames} expected_source_frames={source_frames}"
    );
    if submitted_source_frames != source_frames {
        return Err("fixture submitted frame count differs from source".into());
    }
    Ok(())
}

fn main() {
    let result = parse_args().map_err(|error| error.into()).and_then(play);
    if let Err(error) = result {
        eprintln!("stackchan-wasapi-play: {error}");
        std::process::exit(1);
    }
}

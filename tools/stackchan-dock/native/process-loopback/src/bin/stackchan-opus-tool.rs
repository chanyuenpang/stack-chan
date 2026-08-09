use std::env;
use std::io::{self, Read, Write};

use opus::{Application, Bitrate, Channels, Decoder, Encoder};

const FRAME_DURATION_MS: usize = 60;
const MAX_PACKET_BYTES: usize = 1_500;

#[derive(Clone, Copy)]
enum Mode {
    Encode,
    Decode,
}

struct Config {
    mode: Mode,
    sample_rate: u32,
    bitrate: i32,
}

fn parse_args() -> Result<Config, String> {
    let mut args = env::args().skip(1);
    let mode = match args.next().as_deref() {
        Some("encode") => Mode::Encode,
        Some("decode") => Mode::Decode,
        _ => return Err("usage: stackchan-opus-tool <encode|decode> --sample-rate <16000|24000> [--bitrate BPS]".into()),
    };
    let mut sample_rate = None;
    let mut bitrate = None;
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--sample-rate" => {
                sample_rate = Some(
                    args.next()
                        .ok_or("--sample-rate requires a value")?
                        .parse()
                        .map_err(|_| "sample rate must be an integer")?,
                );
            }
            "--bitrate" => {
                bitrate = Some(
                    args.next()
                        .ok_or("--bitrate requires a value")?
                        .parse()
                        .map_err(|_| "bitrate must be an integer")?,
                );
            }
            _ => return Err(format!("unknown argument: {arg}")),
        }
    }
    let sample_rate = sample_rate.ok_or("--sample-rate is required")?;
    if !matches!(sample_rate, 16_000 | 24_000) {
        return Err("sample rate must be 16000 or 24000".into());
    }
    let bitrate = bitrate.unwrap_or(if sample_rate == 16_000 {
        32_000
    } else {
        48_000
    });
    if !(6_000..=128_000).contains(&bitrate) {
        return Err("bitrate is outside the supported fixture range".into());
    }
    Ok(Config {
        mode,
        sample_rate,
        bitrate,
    })
}

fn frame_samples(sample_rate: u32) -> usize {
    sample_rate as usize * FRAME_DURATION_MS / 1_000
}

fn write_packet(writer: &mut impl Write, packet: &[u8]) -> io::Result<()> {
    if packet.len() > MAX_PACKET_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "Opus packet exceeds 1500 bytes",
        ));
    }
    writer.write_all(&(packet.len() as u32).to_be_bytes())?;
    writer.write_all(packet)
}

fn read_packet(reader: &mut impl Read) -> io::Result<Option<Vec<u8>>> {
    let mut header = [0_u8; 4];
    match reader.read_exact(&mut header) {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(error) => return Err(error),
    }
    let length = u32::from_be_bytes(header) as usize;
    if length > MAX_PACKET_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "Opus packet exceeds 1500 bytes",
        ));
    }
    let mut packet = vec![0_u8; length];
    reader.read_exact(&mut packet)?;
    Ok(Some(packet))
}

fn encode(
    config: &Config,
    reader: &mut impl Read,
    writer: &mut impl Write,
) -> Result<(), Box<dyn std::error::Error>> {
    let samples_per_frame = frame_samples(config.sample_rate);
    let mut encoder = Encoder::new(config.sample_rate, Channels::Mono, Application::Audio)?;
    encoder.set_bitrate(Bitrate::Bits(config.bitrate))?;
    encoder.set_vbr(true)?;
    let mut input = vec![0_u8; samples_per_frame * 2];
    loop {
        let mut read = 0;
        while read < input.len() {
            match reader.read(&mut input[read..])? {
                0 if read == 0 => return Ok(()),
                0 => return Err("trailing PCM does not fill one 60 ms frame".into()),
                count => read += count,
            }
        }
        let pcm = input
            .chunks_exact(2)
            .map(|sample| i16::from_le_bytes([sample[0], sample[1]]))
            .collect::<Vec<_>>();
        let packet = encoder.encode_vec(&pcm, MAX_PACKET_BYTES)?;
        write_packet(writer, &packet)?;
    }
}

fn decode(
    config: &Config,
    reader: &mut impl Read,
    writer: &mut impl Write,
) -> Result<(), Box<dyn std::error::Error>> {
    let samples_per_frame = frame_samples(config.sample_rate);
    let mut decoder = Decoder::new(config.sample_rate, Channels::Mono)?;
    let mut pcm = vec![0_i16; samples_per_frame];
    while let Some(packet) = read_packet(reader)? {
        if packet.is_empty() {
            decoder.reset_state()?;
            continue;
        }
        let decoded = decoder.decode(&packet, &mut pcm, false)?;
        if decoded != samples_per_frame {
            return Err(
                format!("expected {samples_per_frame} decoded samples, got {decoded}").into(),
            );
        }
        for sample in &pcm[..decoded] {
            writer.write_all(&sample.to_le_bytes())?;
        }
    }
    Ok(())
}

fn run(config: Config) -> Result<(), Box<dyn std::error::Error>> {
    let mut stdin = io::stdin().lock();
    let mut stdout = io::stdout().lock();
    match config.mode {
        Mode::Encode => encode(&config, &mut stdin, &mut stdout),
        Mode::Decode => decode(&config, &mut stdin, &mut stdout),
    }
}

fn main() {
    let result = parse_args().map_err(|error| error.into()).and_then(run);
    if let Err(error) = result {
        eprintln!("stackchan-opus-tool: {error}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fixed_pcm_maps_through_framed_opus_with_same_duration() {
        let config = Config {
            mode: Mode::Encode,
            sample_rate: 16_000,
            bitrate: 32_000,
        };
        let source = (0..frame_samples(config.sample_rate) * 4)
            .flat_map(|index| {
                let value = (((index as f32 * 440.0 * std::f32::consts::TAU
                    / config.sample_rate as f32)
                    .sin())
                    * 10_000.0) as i16;
                value.to_le_bytes()
            })
            .collect::<Vec<_>>();
        let mut wire = Vec::new();
        encode(&config, &mut source.as_slice(), &mut wire).unwrap();
        let mut decoded = Vec::new();
        decode(&config, &mut wire.as_slice(), &mut decoded).unwrap();
        assert_eq!(decoded.len(), source.len());
        assert!(
            decoded
                .chunks_exact(2)
                .map(|sample| i16::from_le_bytes([sample[0], sample[1]]).unsigned_abs())
                .max()
                .unwrap_or(0)
                > 1_000
        );
    }

    #[test]
    fn encode_rejects_partial_sixty_ms_frame() {
        let config = Config {
            mode: Mode::Encode,
            sample_rate: 24_000,
            bitrate: 48_000,
        };
        let source = vec![0_u8; frame_samples(config.sample_rate) * 2 - 1];
        assert!(encode(&config, &mut source.as_slice(), &mut Vec::new()).is_err());
    }
}

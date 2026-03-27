/// Windows WASAPI loopback audio capture implementation.
///
/// Captures the audio mix being sent to the default output device (speakers/headphones)
/// using WASAPI in loopback mode. A dedicated thread reads audio data and writes into
/// a shared ring buffer (`VecDeque<f32>`) protected by a mutex.

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::thread;

use wasapi::*;

const MAX_BUFFER_SIZE: usize = 131_072; // 128 KB ring buffer (~3s at 44.1 kHz)

pub struct WindowsSpeaker {
    buffer: Arc<Mutex<VecDeque<f32>>>,
    sample_rate: u32,
    #[allow(dead_code)]
    bits_per_sample: u16,
    #[allow(dead_code)]
    channels: usize,
    running: Arc<Mutex<bool>>,
    _capture_thread: Option<thread::JoinHandle<()>>,
}

impl WindowsSpeaker {
    pub fn new(device_index: Option<usize>) -> Result<Self, String> {
        // Initialize COM for the calling thread
        let hr = wasapi::initialize_mta();
        if hr.is_err() {
            return Err(format!("COM init failed: {:?}", hr));
        }

        // Probe the device format on this thread (we'll drop the client after)
        let device = if let Some(idx) = device_index {
            let collection = DeviceCollection::new(&Direction::Render)
                .map_err(|e| format!("Failed to enumerate devices: {}", e))?;
            collection
                .get_device_at_index(idx as u32)
                .map_err(|e| format!("Device index {} not found: {}", idx, e))?
        } else {
            get_default_device(&Direction::Render)
                .map_err(|e| format!("No default output device: {}", e))?
        };

        let device_name = device
            .get_friendlyname()
            .unwrap_or_else(|_| "Unknown".to_string());
        println!("[Speaker/Windows] Using device: {}", device_name);

        // Probe mix format
        let probe_client = device
            .get_iaudioclient()
            .map_err(|e| format!("Failed to get audio client: {}", e))?;
        let mix_format = probe_client
            .get_mixformat()
            .map_err(|e| format!("Failed to get mix format: {}", e))?;

        let sample_rate = mix_format.get_samplespersec();
        let channels = mix_format.get_nchannels() as usize;
        let bits_per_sample = mix_format.get_bitspersample();
        let block_align = mix_format.get_blockalign() as usize;

        println!(
            "[Speaker/Windows] Format: {}Hz, {}ch, {}bit, block_align={}",
            sample_rate, channels, bits_per_sample, block_align
        );

        // Drop probe client — the real client will be created in the capture thread
        drop(probe_client);
        drop(device);

        let buffer = Arc::new(Mutex::new(VecDeque::with_capacity(MAX_BUFFER_SIZE)));
        let running = Arc::new(Mutex::new(true));

        let buffer_clone = Arc::clone(&buffer);
        let running_clone = Arc::clone(&running);
        let dev_idx = device_index;

        // Spawn capture thread — COM objects are created and used entirely within this thread
        let handle = thread::spawn(move || {
            let hr = wasapi::initialize_mta();
            if hr.is_err() {
                eprintln!("[Speaker/Windows] Thread COM init failed: {:?}", hr);
                return;
            }

            // Re-open device on the capture thread
            let device = if let Some(idx) = dev_idx {
                let collection = match DeviceCollection::new(&Direction::Render) {
                    Ok(c) => c,
                    Err(e) => {
                        eprintln!("[Speaker/Windows] Enumerate failed: {}", e);
                        return;
                    }
                };
                match collection.get_device_at_index(idx as u32) {
                    Ok(d) => d,
                    Err(e) => {
                        eprintln!("[Speaker/Windows] Device {} not found: {}", idx, e);
                        return;
                    }
                }
            } else {
                match get_default_device(&Direction::Render) {
                    Ok(d) => d,
                    Err(e) => {
                        eprintln!("[Speaker/Windows] No default device: {}", e);
                        return;
                    }
                }
            };

            let mut audio_client = match device.get_iaudioclient() {
                Ok(c) => c,
                Err(e) => {
                    eprintln!("[Speaker/Windows] AudioClient failed: {}", e);
                    return;
                }
            };

            let mix_fmt = match audio_client.get_mixformat() {
                Ok(f) => f,
                Err(e) => {
                    eprintln!("[Speaker/Windows] Mix format failed: {}", e);
                    return;
                }
            };

            let cap_channels = mix_fmt.get_nchannels() as usize;
            let cap_bits = mix_fmt.get_bitspersample();
            let cap_block_align = mix_fmt.get_blockalign() as usize;

            // Initialize loopback: Render device + Capture direction → LOOPBACK flag
            if let Err(e) = audio_client.initialize_client(
                &mix_fmt,
                &Direction::Capture,
                &StreamMode::PollingShared {
                    autoconvert: true,
                    buffer_duration_hns: 2_000_000,
                },
            ) {
                eprintln!("[Speaker/Windows] Init client failed: {}", e);
                return;
            }

            let capture_client = match audio_client.get_audiocaptureclient() {
                Ok(c) => c,
                Err(e) => {
                    eprintln!("[Speaker/Windows] Capture client failed: {}", e);
                    return;
                }
            };

            if let Err(e) = audio_client.start_stream() {
                eprintln!("[Speaker/Windows] Start stream failed: {}", e);
                return;
            }

            println!("[Speaker/Windows] Capture thread started");
            let mut raw_data: VecDeque<u8> = VecDeque::new();

            loop {
                {
                    let r = running_clone.lock().unwrap();
                    if !*r {
                        break;
                    }
                }

                match capture_client.get_next_packet_size() {
                    Ok(Some(frame_count)) if frame_count > 0 => {
                        match capture_client.read_from_device_to_deque(&mut raw_data) {
                            Ok(_buffer_info) => {
                                let samples = bytes_to_f32_mono(
                                    &raw_data,
                                    cap_bits,
                                    cap_channels,
                                    cap_block_align,
                                );
                                raw_data.clear();

                                if !samples.is_empty() {
                                    let mut buf = buffer_clone.lock().unwrap();
                                    buf.extend(samples.iter());
                                    while buf.len() > MAX_BUFFER_SIZE {
                                        buf.pop_front();
                                    }
                                }
                            }
                            Err(e) => {
                                eprintln!("[Speaker/Windows] Read error: {}", e);
                                raw_data.clear();
                            }
                        }
                    }
                    Ok(_) => {
                        thread::sleep(std::time::Duration::from_millis(5));
                    }
                    Err(e) => {
                        eprintln!("[Speaker/Windows] Packet size error: {}", e);
                        thread::sleep(std::time::Duration::from_millis(10));
                    }
                }
            }

            // Stop and cleanup happens automatically when audio_client drops
            println!("[Speaker/Windows] Capture thread stopped");
        });

        Ok(Self {
            buffer,
            sample_rate,
            bits_per_sample,
            channels,
            running,
            _capture_thread: Some(handle),
        })
    }
}

impl super::SpeakerInput for WindowsSpeaker {
    fn read_samples(&mut self) -> Vec<f32> {
        let mut buf = self.buffer.lock().unwrap();
        buf.drain(..).collect()
    }

    fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    fn stop(&mut self) {
        {
            let mut r = self.running.lock().unwrap();
            *r = false;
        }
        // Wait for thread to finish
        if let Some(handle) = self._capture_thread.take() {
            let _ = handle.join();
        }
    }
}

/// Convert raw byte buffer from WASAPI into f32 mono samples.
/// Handles 32-bit float and 16-bit int formats, mixes multi-channel to mono.
fn bytes_to_f32_mono(
    raw: &VecDeque<u8>,
    bits_per_sample: u16,
    channels: usize,
    block_align: usize,
) -> Vec<f32> {
    let raw_slice: Vec<u8> = raw.iter().copied().collect();

    match bits_per_sample {
        32 => {
            // 32-bit float: interpret each frame as (channels × f32)
            raw_slice
                .chunks_exact(block_align)
                .map(|frame| {
                    let mut sum = 0.0f32;
                    for ch in 0..channels {
                        let offset = ch * 4;
                        if offset + 4 <= frame.len() {
                            sum += f32::from_le_bytes([
                                frame[offset],
                                frame[offset + 1],
                                frame[offset + 2],
                                frame[offset + 3],
                            ]);
                        }
                    }
                    sum / channels as f32
                })
                .collect()
        }
        16 => {
            // 16-bit int: convert to f32 in [-1.0, 1.0], mix to mono
            raw_slice
                .chunks_exact(block_align)
                .map(|frame| {
                    let mut sum = 0.0f32;
                    for ch in 0..channels {
                        let offset = ch * 2;
                        if offset + 2 <= frame.len() {
                            let val = i16::from_le_bytes([frame[offset], frame[offset + 1]]);
                            sum += val as f32 / i16::MAX as f32;
                        }
                    }
                    sum / channels as f32
                })
                .collect()
        }
        _ => {
            eprintln!(
                "[Speaker/Windows] Unsupported bits_per_sample: {}",
                bits_per_sample
            );
            Vec::new()
        }
    }
}

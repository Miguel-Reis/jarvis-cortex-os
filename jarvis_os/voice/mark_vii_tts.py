"""Skywalker Sound Mark-VII Helmet DSP & Speech Synthesizer.

Pure Python stdlib (wave, struct, math, subprocess). Zero external audio dependencies.
Implements:
1. Comms Bandpass Filter (300Hz - 3400Hz)
2. Metallic Helmet Acoustic Comb Resonance (18ms reflection line with feedback decay)
3. Soft Harmonic Saturation (analog RF transceiver overdrive)
4. SAPI 5 / Native Speech streaming pipeline with automatic DSP mastering
"""

from __future__ import annotations

import enum
import math
import os
import struct
import subprocess
import sys
import tempfile
import wave
from dataclasses import dataclass
from typing import List, Optional


class AudioDSPPreset(str, enum.Enum):
    MARK_VII_HELMET = "MARK_VII_HELMET"      # Iconic Iron Man suit interior: metallic comb + bandpass + saturation
    WAR_ROOM_RADIO = "WAR_ROOM_RADIO"        # Military tactical radio: aggressive bandpass + heavy overdrive
    EXECUTIVE_CLEAN = "EXECUTIVE_CLEAN"      # Studio clarity: subtle presence boost, linear decay
    AVENGERS_COMMS = "AVENGERS_COMMS"        # High-frequency satellite link with subtle comb echo


@dataclass
class DSPProfile:
    preset: AudioDSPPreset
    bandpass_low: float      # Hz
    bandpass_high: float     # Hz
    comb_delay_ms: float     # ms
    comb_feedback: float     # 0.0 - 0.95
    saturation_gain: float   # 1.0 - 3.0


class MarkVIISpeechSynthesizer:
    """Master Audio & Speech Engine with Skywalker Sound DSP filter chain."""

    PRESETS = {
        AudioDSPPreset.MARK_VII_HELMET: DSPProfile(
            preset=AudioDSPPreset.MARK_VII_HELMET,
            bandpass_low=320.0,
            bandpass_high=3800.0,
            comb_delay_ms=18.5,
            comb_feedback=0.38,
            saturation_gain=1.45,
        ),
        AudioDSPPreset.WAR_ROOM_RADIO: DSPProfile(
            preset=AudioDSPPreset.WAR_ROOM_RADIO,
            bandpass_low=450.0,
            bandpass_high=2800.0,
            comb_delay_ms=8.0,
            comb_feedback=0.20,
            saturation_gain=2.20,
        ),
        AudioDSPPreset.EXECUTIVE_CLEAN: DSPProfile(
            preset=AudioDSPPreset.EXECUTIVE_CLEAN,
            bandpass_low=80.0,
            bandpass_high=12000.0,
            comb_delay_ms=0.0,
            comb_feedback=0.0,
            saturation_gain=1.05,
        ),
        AudioDSPPreset.AVENGERS_COMMS: DSPProfile(
            preset=AudioDSPPreset.AVENGERS_COMMS,
            bandpass_low=250.0,
            bandpass_high=4500.0,
            comb_delay_ms=25.0,
            comb_feedback=0.28,
            saturation_gain=1.25,
        ),
    }

    def __init__(self, sample_rate: int = 22050) -> None:
        self.sample_rate = sample_rate

    # ---------------------------------------------------------
    # Digital Signal Processing Pipeline
    # ---------------------------------------------------------

    def apply_dsp_chain(
        self,
        samples: List[float],
        preset: AudioDSPPreset = AudioDSPPreset.MARK_VII_HELMET,
    ) -> List[float]:
        """Runs PCM audio through Bandpass -> Comb Resonance -> Saturation."""
        prof = self.PRESETS.get(preset, self.PRESETS[AudioDSPPreset.MARK_VII_HELMET])
        processed = list(samples)

        # 1. Bandpass / High-pass + Low-pass single-pole approximation
        if prof.bandpass_low > 0.0:
            rc = 1.0 / (2.0 * math.pi * prof.bandpass_low)
            dt = 1.0 / self.sample_rate
            alpha = rc / (rc + dt)
            prev_in = processed[0] if processed else 0.0
            prev_out = 0.0
            hp_out: List[float] = []
            for s in processed:
                prev_out = alpha * (prev_out + s - prev_in)
                prev_in = s
                hp_out.append(prev_out)
            processed = hp_out

        if prof.bandpass_high < self.sample_rate / 2.0:
            rc_lp = 1.0 / (2.0 * math.pi * prof.bandpass_high)
            dt_lp = 1.0 / self.sample_rate
            alpha_lp = dt_lp / (rc_lp + dt_lp)
            prev_lp = processed[0] if processed else 0.0
            lp_out: List[float] = []
            for s in processed:
                prev_lp = prev_lp + alpha_lp * (s - prev_lp)
                lp_out.append(prev_lp)
            processed = lp_out

        # 2. Metallic Helmet Comb Filter (Acoustic Reflection Delay)
        if prof.comb_delay_ms > 0.0 and prof.comb_feedback > 0.0:
            delay_samples = max(1, int((prof.comb_delay_ms / 1000.0) * self.sample_rate))
            delay_buffer = [0.0] * delay_samples
            comb_out: List[float] = []
            buf_idx = 0

            for s in processed:
                delayed = delay_buffer[buf_idx]
                out_sample = s + (prof.comb_feedback * delayed)
                delay_buffer[buf_idx] = out_sample
                buf_idx = (buf_idx + 1) % delay_samples
                comb_out.append(out_sample)
            processed = comb_out

        # 3. Soft Saturation / Overdrive (tanh-like limiter)
        saturated: List[float] = []
        gain = prof.saturation_gain
        for s in processed:
            val = s * gain
            # Fast soft-clipper approximation: val / (1 + |val|)
            clipped = val / (1.0 + abs(val))
            saturated.append(clipped)

        return saturated

    # ---------------------------------------------------------
    # Audio Wave I/O & Synthetic Signals
    # ---------------------------------------------------------

    def generate_synthetic_tone(self, duration_sec: float = 0.5, freq_hz: float = 440.0) -> List[float]:
        """Generates clean sinusoidal test samples."""
        total_samples = int(duration_sec * self.sample_rate)
        samples: List[float] = []
        for i in range(total_samples):
            t = float(i) / self.sample_rate
            # Harmonics (fundamental + 2nd + 3rd harmonic for vocal chord presence)
            val = (
                0.60 * math.sin(2.0 * math.pi * freq_hz * t)
                + 0.25 * math.sin(2.0 * math.pi * (freq_hz * 2) * t)
                + 0.15 * math.sin(2.0 * math.pi * (freq_hz * 3) * t)
            )
            samples.append(val)
        return samples

    def write_wav(self, file_path: str, samples: List[float]) -> str:
        """Writes 16-bit Mono PCM WAV."""
        with wave.open(file_path, "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(self.sample_rate)
            packed = bytearray()
            for s in samples:
                # Clamp to [-1.0, 1.0]
                clamped = max(-1.0, min(1.0, s))
                int_val = int(clamped * 32767.0)
                packed.extend(struct.pack("<h", int_val))
            wf.writeframes(packed)
        return file_path

    def read_wav(self, file_path: str) -> List[float]:
        """Reads 16-bit Mono PCM WAV into normalized float samples."""
        with wave.open(file_path, "rb") as wf:
            framerate = wf.getframerate()
            self.sample_rate = framerate
            n_frames = wf.getnframes()
            raw_bytes = wf.readframes(n_frames)
            samples: List[float] = []
            for i in range(0, len(raw_bytes), 2):
                int_val = struct.unpack("<h", raw_bytes[i : i + 2])[0]
                samples.append(int_val / 32768.0)
            return samples

    def synthesize_speech_file(
        self,
        text: str,
        output_wav_path: str,
        preset: AudioDSPPreset = AudioDSPPreset.MARK_VII_HELMET,
    ) -> str:
        """Generates speech via Windows SAPI 5 (if available) or synthetic acoustic carrier, and applies Mark-VII DSP."""
        raw_temp = os.path.join(tempfile.gettempdir(), f"jarvis_raw_{os.getpid()}.wav")
        sapi_success = False

        if sys.platform == "win32":
            try:
                # Use PowerShell System.Speech.Synthesis
                clean_text = text.replace('"', '`"').replace("'", "")
                ps_script = (
                    f"Add-Type -AssemblyName System.Speech; "
                    f"$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer; "
                    f"$synth.SetOutputToWaveFile('{raw_temp}'); "
                    f"$synth.Speak('{clean_text}'); "
                    f"$synth.Dispose();"
                )
                res = subprocess.run(
                    ["powershell", "-NoProfile", "-Command", ps_script],
                    capture_output=True,
                    timeout=10,
                )
                if res.returncode == 0 and os.path.exists(raw_temp) and os.path.getsize(raw_temp) > 100:
                    sapi_success = True
            except Exception:
                sapi_success = False

        if sapi_success and os.path.exists(raw_temp):
            raw_samples = self.read_wav(raw_temp)
            try:
                os.remove(raw_temp)
            except OSError:
                pass
        else:
            # High-tech synthetic carrier chime/vocoder simulation
            raw_samples = self.generate_synthetic_tone(duration_sec=0.75, freq_hz=520.0)

        # Apply Skywalker Sound Mark-VII DSP Filter
        dsp_samples = self.apply_dsp_chain(raw_samples, preset=preset)
        self.write_wav(output_wav_path, dsp_samples)
        return output_wav_path

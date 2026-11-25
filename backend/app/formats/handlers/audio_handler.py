from __future__ import annotations

import asyncio
import json
import wave
from pathlib import Path
from typing import Any

import av
import numpy as np
import soundfile as sf

from app.formats.base import DerivedResult, FormatHandler, InspectionDocument, ProbeResult


def _probe_sync(path: Path) -> ProbeResult:
    ext = path.suffix.lower().lstrip(".")
    sample_rate = 48000
    channels = 2
    bit_depth = 16
    duration_s = 1.0
    codec_name = ext
    tags: dict[str, Any] = {}

    try:
        info = sf.info(str(path))
        sample_rate = int(info.samplerate)
        channels = int(info.channels)
        duration_s = float(info.duration)
        codec_name = str(info.subtype or info.format)
        if "24" in codec_name:
            bit_depth = 24
        elif "32" in codec_name or "FLOAT" in codec_name:
            bit_depth = 32
    except Exception:
        with av.open(str(path)) as container:
            a0 = next((s for s in container.streams if s.type == "audio"), None)
            if a0 is not None:
                sample_rate = int(getattr(a0, "rate", 48000) or 48000)
                channels = int(getattr(a0, "channels", 2) or 2)
                codec_name = str(getattr(a0.codec_context, "name", ext))
            if container.duration:
                duration_s = float(container.duration) / float(av.time_base)
            tags = dict(container.metadata or {})

    total_samples = max(1, round(duration_s * sample_rate))
    return ProbeResult(
        format_id=ext,
        media_kind="audio",
        duration_seconds=duration_s,
        details={
            "channels": channels,
            "sample_rate": sample_rate,
            "bit_depth": bit_depth,
            "total_samples": total_samples,
            "codec": codec_name,
            "tags": tags,
        },
    )


def _inspect_sync(path: Path, probe: ProbeResult) -> InspectionDocument:
    duration_s = float(probe.duration_seconds or 1.0)
    fps = 24.0
    end_frame = max(1, round(duration_s * fps))
    channels = int(probe.details.get("channels", 2))
    sample_rate = int(probe.details.get("sample_rate", 48000))
    codec = str(probe.details.get("codec", probe.format_id))

    return InspectionDocument(
        kind="audio",
        summary={
            "name": path.name,
            "format": probe.format_id,
            "channels": channels,
            "sample_rate": sample_rate,
            "bit_depth": probe.details.get("bit_depth", 16),
            "duration_seconds": round(duration_s, 3),
            "codec": codec,
        },
        streams=[
            {
                "index": 0,
                "type": "audio",
                "codec": codec,
                "sample_rate": sample_rate,
                "channels": channels,
            }
        ],
        timeline={
            "start": 0,
            "end": end_frame,
            "fps": fps,
            "duration": duration_s,
        },
        metadata={
            "channels": channels,
            "sample_rate": sample_rate,
            "bit_depth": probe.details.get("bit_depth", 16),
            "total_samples": probe.details.get("total_samples", 0),
            "duration_seconds": round(duration_s, 3),
            "codec": codec,
            **(probe.details.get("tags") or {}),
        },
        capabilities={
            "time_based": True,
            "annotations_audio": True,
            "waveform": True,
        },
    )


def _decode_float_channels(path: Path) -> tuple[int, np.ndarray[Any, np.dtype[np.float32]]]:
    try:
        data, sr = sf.read(str(path), dtype="float32", always_2d=True)
        # shape -> (channels, samples)
        return int(sr), data.T.astype(np.float32)
    except Exception:
        with av.open(str(path)) as container:
            a0 = next((s for s in container.streams if s.type == "audio"), None)
            if a0 is None:
                raise ValueError("Audio file has no audio stream") from None
            sr = int(getattr(a0, "rate", 44100) or 44100)
            ch_count = int(getattr(a0, "channels", 2) or 2)
            layout = "mono" if ch_count == 1 else "stereo"
            resampler = av.AudioResampler(format="fltp", layout=layout, rate=sr)
            bufs: list[np.ndarray[Any, np.dtype[np.float32]]] = []
            for frame in container.decode(a0):
                if not isinstance(frame, av.AudioFrame):
                    continue
                for rf in resampler.resample(frame):
                    arr = rf.to_ndarray().astype(np.float32)
                    if arr.ndim == 1:
                        arr = arr[None, :]
                    bufs.append(arr)
            if not bufs:
                return sr, np.zeros((1, 64), dtype=np.float32)
            return sr, np.concatenate(bufs, axis=1)


def _derive_peaks_and_spectrogram(path: Path, buckets: int, dest: Path) -> Path:
    buckets = max(32, min(4000, buckets))
    sr, ch_data = _decode_float_channels(path)
    channels, total_samples = ch_data.shape
    actual_buckets = min(buckets, max(1, total_samples))
    edges = np.linspace(0, total_samples, actual_buckets + 1, dtype=np.int64)

    peaks_per_channel: list[list[list[float]]] = []
    for c in range(channels):
        sig = ch_data[c]
        ch_peaks: list[list[float]] = []
        for i in range(actual_buckets):
            sl = sig[edges[i] : edges[i + 1]]
            if sl.size == 0:
                ch_peaks.append([0.0, 0.0])
            else:
                ch_peaks.append([round(float(sl.min()), 4), round(float(sl.max()), 4)])
        peaks_per_channel.append(ch_peaks)

    # Coarse spectrogram (32 frequency rows x up to 96 time columns)
    mono = ch_data.mean(axis=0)
    cols = min(96, max(8, actual_buckets // 6))
    rows = 32
    fft_n = 128
    window = np.hanning(fft_n).astype(np.float32)
    spec_cols: list[list[float]] = []
    hop_edges = np.linspace(0, max(1, total_samples - fft_n), cols, dtype=np.int64)
    for start in hop_edges:
        seg = mono[start : start + fft_n]
        if seg.size < fft_n:
            seg = np.pad(seg, (0, fft_n - seg.size))
        mag = np.abs(np.fft.rfft(seg * window))[:rows]
        mag = np.log1p(mag * 10.0)
        spec_cols.append(mag.tolist())
    spec_arr = np.array(spec_cols, dtype=np.float32)
    s_max = float(spec_arr.max()) if spec_arr.size else 1.0
    if s_max > 1e-6:
        spec_arr /= s_max
    spectrogram = [[round(float(v), 3) for v in row] for row in spec_arr.tolist()]

    payload = {
        "sampleRate": sr,
        "channels": channels,
        "totalSamples": int(total_samples),
        "duration": round(total_samples / max(1, sr), 4),
        "buckets": actual_buckets,
        "channelPeaks": peaks_per_channel,
        "peaks": peaks_per_channel[0] if peaks_per_channel else [],
        "spectrogram": spectrogram,
    }
    dest.write_text(json.dumps(payload), encoding="utf-8")
    return dest


def _derive_audio_proxy_wav(path: Path, dest: Path) -> Path:
    sr, ch_data = _decode_float_channels(path)
    channels = ch_data.shape[0]
    clipped = np.clip(ch_data.T, -1.0, 1.0)
    pcm16 = (clipped * 32767.0).astype("<i2")
    with wave.open(str(dest), "wb") as wf:
        wf.setnchannels(channels)
        wf.setsampwidth(2)
        wf.setframerate(sr)
        wf.writeframes(pcm16.tobytes())
    return dest


def _derive_sync(path: Path, kind: str, params: dict[str, Any], out_dir: Path) -> DerivedResult:
    out_dir.mkdir(parents=True, exist_ok=True)
    if kind == "waveform_peaks":
        buckets = int(params.get("buckets", 600))
        dest = out_dir / f"waveform_{buckets}.json"
        _derive_peaks_and_spectrogram(path, buckets, dest)
        return DerivedResult(
            kind=kind,
            storage_key=dest.name,
            mime_type="application/json",
            size=dest.stat().st_size,
        )
    if kind == "audio_proxy":
        dest = out_dir / "audio_proxy.wav"
        _derive_audio_proxy_wav(path, dest)
        return DerivedResult(
            kind=kind,
            storage_key=dest.name,
            mime_type="audio/wav",
            size=dest.stat().st_size,
        )
    raise NotImplementedError(f"AudioHandler cannot derive '{kind}'")


class AudioHandler(FormatHandler):
    handler_id = "audio_av"
    handler_version = "1.0.0"
    media_kind = "audio"
    extensions = (".wav", ".aiff", ".aif", ".mp3", ".aac", ".m4a", ".flac")

    async def probe(self, path: Path) -> ProbeResult:
        return await asyncio.to_thread(_probe_sync, path)

    async def inspect(self, path: Path, probe: ProbeResult) -> InspectionDocument:
        return await asyncio.to_thread(_inspect_sync, path, probe)

    async def derive(
        self, path: Path, kind: str, params: dict[str, Any], out_dir: Path
    ) -> DerivedResult:
        return await asyncio.to_thread(_derive_sync, path, kind, params, out_dir)

    def capabilities(self) -> dict[str, bool]:
        return {"time_based": True, "annotations_audio": True, "waveform": True}

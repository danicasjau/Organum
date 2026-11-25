from __future__ import annotations

from pathlib import Path

import av
import numpy as np
import pytest
from httpx import AsyncClient
from PIL import Image, ImageDraw

from scripts.make_demo_data import _write_edl, _write_wav
from tests.conftest import make_entity_product_dir, reconcile_files_map


def _write_synthetic_mp4(path: Path) -> None:
    with av.open(str(path), mode="w") as container:
        codec_name = "libx264" if "libx264" in av.codecs_available else "mpeg4"
        v_stream = container.add_stream(codec_name, rate=24)
        v_stream.width = 128
        v_stream.height = 96
        v_stream.pix_fmt = "yuv420p"

        a_stream = container.add_stream("aac", rate=48000)

        for f_idx in range(12):
            arr = np.full((96, 128, 3), 24, dtype=np.uint8)
            arr[:, f_idx * 8 : f_idx * 8 + 16] = [139, 92, 246]
            v_frame = av.VideoFrame.from_ndarray(arr, format="rgb24")
            for pkt in v_stream.encode(v_frame):
                container.mux(pkt)
        for pkt in v_stream.encode():
            container.mux(pkt)

        t = np.linspace(0, 0.5, 24000, endpoint=False, dtype=np.float32)
        sine = (0.4 * np.sin(2.0 * np.pi * 440.0 * t)).astype(np.float32)
        stereo = np.stack([sine, sine], axis=0)
        for start in range(0, 24000, 1024):
            chunk = stereo[:, start : start + 1024]
            a_frame = av.AudioFrame.from_ndarray(chunk, format="fltp", layout="stereo")
            a_frame.sample_rate = 48000
            for pkt in a_stream.encode(a_frame):
                container.mux(pkt)
        for pkt in a_stream.encode():
            container.mux(pkt)


@pytest.mark.asyncio
async def test_timebased_video_audio_edl_and_sequence(
    test_app: tuple[object, AsyncClient, str, Path],
) -> None:
    _, client, project_uuid, prod_root = test_app
    vid_dir = make_entity_product_dir(prod_root, "hero", "Animation", "turn", "v0001")
    aud_dir = make_entity_product_dir(prod_root, "hero", "FX", "snd", "v0001")
    edl_dir = make_entity_product_dir(prod_root, "hero", "Compositing", "edit", "v0001")
    seq_dir = make_entity_product_dir(prod_root, "hero", "Lighting", "seq", "v0001")

    _write_synthetic_mp4(vid_dir / "turn.mp4")
    _write_wav(aud_dir / "tone.wav")
    _write_edl(edl_dir / "cut.edl")

    for idx in range(1, 5):
        img = Image.new("RGB", (64, 64), (15, 23, 42))
        ImageDraw.Draw(img).rectangle([idx * 8, 16, idx * 8 + 16, 48], fill=(16, 185, 129))
        img.save(seq_dir / f"shot.{idx:04d}.png")

    files_by_name = await reconcile_files_map(client, project_uuid)
    base = f"/api/v1/projects/{project_uuid}"

    vid_id = str(files_by_name["turn.mp4"]["id"])
    v_doc = (await client.get(f"{base}/files/{vid_id}/inspect")).json()
    assert v_doc["kind"] == "video"
    assert v_doc["capabilities"]["time_based"] is True
    assert v_doc["capabilities"]["has_audio"] is True
    assert v_doc["timeline"]["end"] >= 1

    proxy1 = (await client.post(f"{base}/files/{vid_id}/artifacts/proxy_video", json={})).json()
    proxy2 = (await client.post(f"{base}/files/{vid_id}/artifacts/proxy_video", json={})).json()
    assert proxy1["id"] == proxy2["id"]
    assert proxy1["mime_type"] in ("video/webm", "video/mp4")
    proxy_bytes = (await client.get(proxy1["content_url"])).content
    assert len(proxy_bytes) > 100

    f_art = (
        await client.post(
            f"{base}/files/{vid_id}/artifacts/frame_png",
            json={"params": {"frame": 2}},
        )
    ).json()
    assert f_art["mime_type"] == "image/png"
    v_peaks = (
        await client.post(f"{base}/files/{vid_id}/artifacts/waveform_peaks", json={})
    ).json()
    peaks_json = (await client.get(v_peaks["content_url"])).json()
    assert len(peaks_json["peaks"]) > 0

    aud_id = str(files_by_name["tone.wav"]["id"])
    a_doc = (await client.get(f"{base}/files/{aud_id}/inspect")).json()
    assert a_doc["kind"] == "audio"
    assert a_doc["summary"]["channels"] == 2
    assert a_doc["capabilities"]["waveform"] is True

    a_peaks = (
        await client.post(f"{base}/files/{aud_id}/artifacts/waveform_peaks", json={})
    ).json()
    ap_json = (await client.get(a_peaks["content_url"])).json()
    assert len(ap_json["channelPeaks"]) == 2
    assert len(ap_json["spectrogram"]) >= 8

    a_proxy = (await client.post(f"{base}/files/{aud_id}/artifacts/audio_proxy", json={})).json()
    assert a_proxy["mime_type"] == "audio/wav"

    edl_id = str(files_by_name["cut.edl"]["id"])
    t_doc = (await client.get(f"{base}/files/{edl_id}/inspect")).json()
    assert t_doc["kind"] == "timeline"
    assert len(t_doc["metadata"]["clips"]) == 2
    assert t_doc["metadata"]["clips"][0]["name"] in ("turntable.mp4", "TURN_001")

    seq_key = next(k for k in files_by_name if "shot." in k)
    seq_id = str(files_by_name[seq_key]["id"])
    s_doc = (await client.get(f"{base}/files/{seq_id}/inspect")).json()
    assert s_doc["timeline"]["is_sequence"] is True
    assert s_doc["timeline"]["start"] == 1
    assert s_doc["timeline"]["end"] == 4

    frame2 = await client.get(f"{base}/files/{seq_id}/sequence/2")
    assert frame2.status_code == 200
    assert frame2.content[:8] == b"\x89PNG\r\n\x1a\n"

    bad_frame = await client.get(f"{base}/files/{seq_id}/sequence/99")
    assert bad_frame.status_code == 404

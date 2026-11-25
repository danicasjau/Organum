# ORGANUM Color Pipeline

All visual media pipelines (2D images, video frames, and frozen 3D captures) share an identical WebGL2 float16/float32 fragment-shader color chain so exposure, gamma, saturation, hue, channel isolation, clipping/false-color, and display/view transforms behave consistently across formats.

## Shader Pipeline Order

1. **Decode**: Sample source texture (`RGBA32F` / `RGBA16F` or 8-bit normalized to `[0, 1]`).
2. **Input Transform**: Convert from the file's detected or overridden input colorspace (e.g. `Linear sRGB`, `sRGB`, `Rec.709`, `ACEScg`, `ACES2065-1`, `Display P3`, `Raw`) into the **working linear** space (`Linear Rec.709 / sRGB` primaries unless OCIO LUT is active), via built-in 3x3 chromaticity/OETF transforms or an optional backend-baked 3D LUT.
3. **Working Linear Exposure**: `rgb *= gain * pow(2.0, exposureStops)`
4. **Saturation**: Luma-preserving mix using Rec.709 weights `(0.2126, 0.7152, 0.0722)`.
5. **Hue Rotation**: Rodrigues rotation around the achromatic `(1, 1, 1) / sqrt(3)` axis in linear space.
6. **Gamma**: Inverse gamma adjustment (`pow(max(rgb, 0.0), 1.0 / gamma)`).
7. **Display / View Transform**: Convert from working linear to the selected display space (`sRGB`, `Rec.709`, `Rec.2020`, `Display P3`, `Linear`, `Raw`, or baked ACES OCIO 3D LUT).
8. **Inspection Overlays**:
   - **Channel isolation**: `RGB`, `R`, `G`, `B`, `A`, or `Y` (luminance).
   - **Clipping / False-color**: highlight `< 0.0` (underflow) and `> 1.0` (over-range).
   - **Bypass (`S`)**: bypasses exposure/saturation/hue/gamma and optional view grading to inspect raw decoded signal.

## Colorspace Override Persistence

- Auto-detected colorspace is stored in `files.probe_json` at ingest time.
- User overrides are persisted per file in `files.colorspace_override` (`PATCH /api/v1/files/{id}`).
- Pixel inspector readouts report both **source float values** (before display transform) and **display values** (8-bit and hex).

## Optional OCIO 3D LUT Baking

- When `PyOpenColorIO` (`opencolorio==2.6.0`) is installed, `GET /api/v1/colorspaces/lut?src=<src>&dst=<dst>&size=<9|17|33>` bakes a 3D RGB LUT cube (`size^3 * 3` float32 values) on demand and caches it by `(config_hash, src, dst, size)`.
- Configure an external studio OCIO config via `ORGANUM_OCIO_CONFIG` (path to `config.ocio`); if unset, ORGANUM uses the built-in ACES Studio/CG OCIO v2 config shipped with OpenColorIO, or a deterministic analytical fallback if a requested pair is absent.


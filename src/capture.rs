//! Bound native snapshot memory and MCP image size without cropping app content.
use image::{imageops::FilterType, ImageFormat, ImageReader, Limits};
use std::io::Cursor;

pub fn normalize_png(bytes: &[u8]) -> Result<Vec<u8>, String> {
    if bytes.len() > 64 * 1024 * 1024 || !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err("RESOURCE_LIMIT: invalid or oversized native PNG snapshot".into());
    }
    let mut limits = Limits::default();
    limits.max_image_width = Some(8192);
    limits.max_image_height = Some(8192);
    limits.max_alloc = Some(128 * 1024 * 1024);
    let mut reader = ImageReader::with_format(Cursor::new(bytes), ImageFormat::Png);
    reader.limits(limits);
    let image = reader
        .decode()
        .map_err(|e| format!("OPERATION_FAILED: native PNG decode failed ({e})"))?;
    let image = if image.width() > 2560 || image.height() > 1920 {
        image.resize(2560, 1920, FilterType::Triangle)
    } else {
        image
    };
    let mut png = Cursor::new(Vec::new());
    image
        .write_to(&mut png, ImageFormat::Png)
        .map_err(|e| e.to_string())?;
    let png = png.into_inner();
    // Matches the 8 MiB base64 envelope enforced by view_response.
    if png.len() > 6 * 1024 * 1024 - 32 {
        return Err(
            "RESOURCE_LIMIT: screenshot exceeds the MCP image budget; resize the window".into(),
        );
    }
    Ok(png)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn png_capture_retains_complete_layout_and_bounds_retina_output() {
        let image = image::RgbImage::from_fn(3000, 2100, |x, y| {
            image::Rgb(if x < 1500 && y < 1050 {
                [255, 0, 0]
            } else if x >= 1500 && y < 1050 {
                [0, 255, 0]
            } else if x < 1500 {
                [0, 0, 255]
            } else {
                [255, 255, 0]
            })
        });
        let mut source = Cursor::new(Vec::new());
        image.write_to(&mut source, ImageFormat::Png).unwrap();
        let png = normalize_png(source.get_ref()).unwrap();
        let output = image::load_from_memory(&png).unwrap().to_rgb8();
        assert_eq!(output.dimensions(), (2560, 1792));
        for (x, y, rgb) in [
            (0, 0, [255, 0, 0]),
            (2559, 0, [0, 255, 0]),
            (0, 1791, [0, 0, 255]),
            (2559, 1791, [255, 255, 0]),
        ] {
            assert_eq!(output.get_pixel(x, y).0, rgb);
        }
        assert!(normalize_png(b"not a PNG").is_err());
        assert!(normalize_png(b"\x89PNG\r\n\x1a\ninvalid").is_err());
    }
}

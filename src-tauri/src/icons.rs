//! Real file / app icons and image thumbnails, using the same shell thumbnails as File Explorer.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use windows::core::HSTRING;
use windows::Storage::FileProperties::{ThumbnailMode, ThumbnailOptions};
use windows::Storage::StorageFile;
use windows::Storage::Streams::DataReader;

static CACHE: OnceLock<Mutex<HashMap<(String, u32), String>>> = OnceLock::new();

fn cache() -> &'static Mutex<HashMap<(String, u32), String>> {
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn thumbnail(path: &str, size: u32) -> windows::core::Result<Option<String>> {
    let file = StorageFile::GetFileFromPathAsync(&HSTRING::from(path))?.get()?;
    let thumb = file.GetThumbnailAsync(ThumbnailMode::SingleItem, size, ThumbnailOptions::default())?.get()?;
    let len = thumb.Size()? as u32;
    if len == 0 || len > 4_000_000 {
        return Ok(None);
    }
    let reader = DataReader::CreateDataReader(&thumb.GetInputStreamAt(0)?)?;
    reader.LoadAsync(len)?.get()?;
    let mut buf = vec![0u8; len as usize];
    reader.ReadBytes(&mut buf)?;
    let mime = if buf.starts_with(&[0x89, b'P', b'N', b'G']) {
        "image/png"
    } else if buf.starts_with(b"BM") {
        "image/bmp"
    } else {
        "image/jpeg"
    };
    Ok(Some(format!("data:{mime};base64,{}", B64.encode(buf))))
}

/// Looks up icons for many paths at once. Missing ones are simply left out.
#[tauri::command]
pub async fn icons_get(paths: Vec<String>, size: u32) -> HashMap<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let size = size.clamp(16, 512);
        let mut out = HashMap::new();
        for p in paths.into_iter().take(80) {
            let key = (p.clone(), size);
            if let Some(hit) = cache().lock().unwrap().get(&key) {
                out.insert(p, hit.clone());
                continue;
            }
            if let Ok(Some(url)) = thumbnail(&p, size) {
                cache().lock().unwrap().insert(key, url.clone());
                out.insert(p, url);
            }
        }
        out
    })
    .await
    .unwrap_or_default()
}

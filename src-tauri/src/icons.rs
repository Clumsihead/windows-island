//! Real file / app icons and image thumbnails, using the same shell thumbnails as File Explorer.
//!
//! Shortcuts are resolved to their target first, because that is where the app's icon lives.
//! When the shell has no thumbnail (many .exe and .lnk files), the classic shell icon is drawn
//! into a bitmap and encoded as a PNG.

use std::collections::HashMap;
use std::path::Path;
use std::sync::{Mutex, OnceLock};

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use windows::core::{Interface, HSTRING, PCWSTR};
use windows::Storage::FileProperties::{ThumbnailMode, ThumbnailOptions};
use windows::Storage::StorageFile;
use windows::Storage::Streams::DataReader;
use windows::Win32::Graphics::Gdi::{
    CreateCompatibleDC, DeleteDC, DeleteObject, GetDIBits, GetObjectW, BITMAP, BITMAPINFO,
    BITMAPINFOHEADER, DIB_RGB_COLORS, HBITMAP, HGDIOBJ,
};
use windows::Win32::Storage::FileSystem::FILE_ATTRIBUTE_NORMAL;
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED, IPersistFile,
    STGM_READ,
};
use windows::Win32::UI::Shell::{
    IShellLinkW, SHGetFileInfoW, SHFILEINFOW, SHGFI_ICON, SHGFI_LARGEICON, SHGFI_SMALLICON, ShellLink,
};
use windows::Win32::UI::WindowsAndMessaging::{DestroyIcon, GetIconInfo, HICON, ICONINFO};

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

/// The .exe (or folder, or document) a shortcut points at.
fn resolve_lnk(path: &str) -> Option<String> {
    if !path.to_lowercase().ends_with(".lnk") {
        return None;
    }
    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER).ok()?;
        let file: IPersistFile = link.cast().ok()?;
        file.Load(&HSTRING::from(path), STGM_READ).ok()?;
        let mut buf = [0u16; 1024];
        link.GetPath(&mut buf, std::ptr::null_mut(), 0).ok()?;
        let end = buf.iter().position(|c| *c == 0).unwrap_or(buf.len());
        if end == 0 {
            return None;
        }
        let target = String::from_utf16_lossy(&buf[..end]);
        if target.is_empty() || !Path::new(&target).exists() {
            return None;
        }
        Some(target)
    }
}

/// 32-bit BGRA from GetDIBits, flipped to RGBA and encoded as a PNG data URL.
unsafe fn color_png(color: HBITMAP) -> Option<String> {
    let mut bm = BITMAP::default();
    let n = GetObjectW(
        HGDIOBJ(color.0),
        std::mem::size_of::<BITMAP>() as i32,
        Some(&mut bm as *mut _ as *mut _),
    );
    if n == 0 || bm.bmWidth <= 0 || bm.bmHeight <= 0 {
        return None;
    }
    let (w, h) = (bm.bmWidth, bm.bmHeight);
    if w > 512 || h > 512 {
        return None;
    }

    let mut bi = BITMAPINFO::default();
    bi.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
    bi.bmiHeader.biWidth = w;
    bi.bmiHeader.biHeight = -h; // top-down rows
    bi.bmiHeader.biPlanes = 1;
    bi.bmiHeader.biBitCount = 32;
    bi.bmiHeader.biCompression = 0; // BI_RGB

    let dc = CreateCompatibleDC(None);
    let mut buf = vec![0u8; (w as usize) * (h as usize) * 4];
    let lines = GetDIBits(
        dc,
        color,
        0,
        h as u32,
        Some(buf.as_mut_ptr() as *mut _),
        &mut bi,
        DIB_RGB_COLORS,
    );
    let _ = DeleteDC(dc);
    if lines == 0 {
        return None;
    }

    let mut has_alpha = false;
    for px in buf.chunks_exact_mut(4) {
        px.swap(0, 2); // BGRA -> RGBA
        if px[3] != 0 {
            has_alpha = true;
        }
    }
    if !has_alpha {
        // Icons drawn without an alpha channel: treat near-black as transparent so the icon sits
        // on the dark card instead of in a black square.
        for px in buf.chunks_exact_mut(4) {
            let sum = px[0] as u32 + px[1] as u32 + px[2] as u32;
            px[3] = if sum > 12 { 255 } else { 0 };
        }
    }

    let mut out = Vec::new();
    {
        let mut enc = png::Encoder::new(&mut out, w as u32, h as u32);
        enc.set_color(png::ColorType::Rgba);
        enc.set_depth(png::BitDepth::Eight);
        let mut writer = enc.write_header().ok()?;
        writer.write_image_data(&buf).ok()?;
    }
    Some(format!("data:image/png;base64,{}", B64.encode(out)))
}

/// The classic shell icon for a path, as a PNG data URL.
fn shell_icon_png(path: &str, size: u32) -> Option<String> {
    let wide: Vec<u16> = path.encode_utf16().chain(std::iter::once(0)).collect();
    unsafe {
        let mut info = SHFILEINFOW::default();
        let flags = if size > 32 {
            SHGFI_ICON | SHGFI_LARGEICON
        } else {
            SHGFI_ICON | SHGFI_SMALLICON
        };
        let ok = SHGetFileInfoW(
            PCWSTR(wide.as_ptr()),
            FILE_ATTRIBUTE_NORMAL,
            Some(&mut info),
            std::mem::size_of::<SHFILEINFOW>() as u32,
            flags,
        );
        if ok == 0 || info.hIcon.is_invalid() {
            return None;
        }
        let png = icon_png(info.hIcon);
        let _ = DestroyIcon(info.hIcon);
        png
    }
}

unsafe fn icon_png(icon: HICON) -> Option<String> {
    let mut info = ICONINFO::default();
    if GetIconInfo(icon, &mut info).is_err() {
        return None;
    }
    let png = if info.hbmColor.is_invalid() {
        None
    } else {
        color_png(info.hbmColor)
    };
    if !info.hbmColor.is_invalid() {
        let _ = DeleteObject(HGDIOBJ(info.hbmColor.0));
    }
    if !info.hbmMask.is_invalid() {
        let _ = DeleteObject(HGDIOBJ(info.hbmMask.0));
    }
    png
}

fn icon_for(path: &str, size: u32) -> Option<String> {
    if let Some(target) = resolve_lnk(path) {
        if let Some(url) = thumbnail(&target, size).ok().flatten().or_else(|| shell_icon_png(&target, size)) {
            return Some(url);
        }
    }
    thumbnail(path, size).ok().flatten().or_else(|| shell_icon_png(path, size))
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
            if let Some(url) = icon_for(&p, size) {
                cache().lock().unwrap().insert(key, url.clone());
                out.insert(p, url);
            }
        }
        out
    })
    .await
    .unwrap_or_default()
}

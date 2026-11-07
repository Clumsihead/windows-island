//! Now-playing through Windows' System Media Transport Controls: Spotify, browsers,
//! VLC, anything that shows up in the Windows volume flyout.

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde::Serialize;
use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSession as Session,
    GlobalSystemMediaTransportControlsSessionManager as Manager,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status,
};
use windows::Storage::Streams::DataReader;

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MediaInfo {
    available: bool,
    title: String,
    artist: String,
    playing: bool,
    /// seconds
    position: f64,
    duration: f64,
    /// The app playing it, e.g. "Spotify" or "Brave"
    app: String,
    /// whether the player lets other apps move the playback position (not every player does)
    can_seek: bool,
}

fn pretty_app(id: &str) -> String {
    let last = id.rsplit(['\\', '!', '/']).next().unwrap_or(id);
    let last = last.trim_end_matches(".exe");
    let last = last.rsplit('.').next().unwrap_or(last).replace(['-', '_'], " ");
    let mut chars = last.chars();
    match chars.next() {
        Some(f) => f.to_uppercase().collect::<String>() + chars.as_str(),
        None => last,
    }
}

fn current() -> windows::core::Result<Session> {
    Manager::RequestAsync()?.get()?.GetCurrentSession()
}

fn read() -> windows::core::Result<MediaInfo> {
    let s = current()?;
    let props = s.TryGetMediaPropertiesAsync()?.get()?;
    let info = s.GetPlaybackInfo()?;
    let playing = info.PlaybackStatus()? == Status::Playing;
    let can_seek = info
        .Controls()
        .and_then(|c| c.IsPlaybackPositionEnabled())
        .unwrap_or(false);
    let (mut position, mut duration) = (0.0, 0.0);
    if let Ok(tl) = s.GetTimelineProperties() {
        // TimeSpan.Duration is in 100 ns ticks.
        // measured from the start of the track's timeline (which is normally 0)
        position = (tl.Position()?.Duration - tl.StartTime()?.Duration) as f64 / 1e7;
        duration = (tl.EndTime()?.Duration - tl.StartTime()?.Duration) as f64 / 1e7;
    }
    Ok(MediaInfo {
        available: true,
        title: props.Title()?.to_string(),
        artist: props.Artist()?.to_string(),
        playing,
        position,
        duration,
        app: s.SourceAppUserModelId().map(|h| pretty_app(&h.to_string())).unwrap_or_default(),
        can_seek,
    })
}

fn read_art() -> windows::core::Result<Option<String>> {
    let s = current()?;
    let props = s.TryGetMediaPropertiesAsync()?.get()?;
    let Ok(thumb) = props.Thumbnail() else { return Ok(None) };
    let stream = thumb.OpenReadAsync()?.get()?;
    let size = stream.Size()? as u32;
    if size == 0 || size > 6_000_000 {
        return Ok(None);
    }
    let reader = DataReader::CreateDataReader(&stream.GetInputStreamAt(0)?)?;
    reader.LoadAsync(size)?.get()?;
    let mut buf = vec![0u8; size as usize];
    reader.ReadBytes(&mut buf)?;
    let mime = if buf.starts_with(&[0x89, b'P', b'N', b'G']) { "image/png" } else { "image/jpeg" };
    Ok(Some(format!("data:{mime};base64,{}", B64.encode(buf))))
}

fn control(action: &str) -> windows::core::Result<()> {
    let s = current()?;
    match action {
        "toggle" => { s.TryTogglePlayPauseAsync()?.get()?; }
        "next" => { s.TrySkipNextAsync()?.get()?; }
        "prev" => { s.TrySkipPreviousAsync()?.get()?; }
        _ => {}
    }
    Ok(())
}

// WinRT's blocking .get() must stay off the async runtime's workers, hence spawn_blocking.
#[tauri::command]
pub async fn media_get() -> MediaInfo {
    tauri::async_runtime::spawn_blocking(|| read().unwrap_or_default()).await.unwrap_or_default()
}

/// Fetched separately and only when the track changes (it's big).
#[tauri::command]
pub async fn media_art() -> Option<String> {
    tauri::async_runtime::spawn_blocking(|| read_art().ok().flatten()).await.ok().flatten()
}

#[tauri::command]
pub async fn media_control(action: String) {
    let _ = tauri::async_runtime::spawn_blocking(move || control(&action)).await;
}

/// Moves playback to `seconds` from the start of the track.
fn seek(seconds: f64) -> windows::core::Result<bool> {
    let s = current()?;
    // positions are 100 ns ticks counted from the timeline's start (normally 0)
    let start = s
        .GetTimelineProperties()
        .and_then(|t| t.StartTime())
        .map(|d| d.Duration)
        .unwrap_or(0);
    let ticks = start + (seconds.max(0.0) * 10_000_000.0) as i64;
    s.TryChangePlaybackPositionAsync(ticks)?.get()
}

#[tauri::command]
pub async fn media_seek(seconds: f64) -> Result<(), String> {
    let accepted = tauri::async_runtime::spawn_blocking(move || seek(seconds))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;
    if accepted {
        Ok(())
    } else {
        Err("This player doesn't allow seeking".into())
    }
}

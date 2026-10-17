// Windows System Media Transport Controls (SMTC) bridge.
//
// `media.current` snapshots the active media session (title/artist/album/playback state/timeline)
// and `media.control` drives the transport buttons — the same GlobalSystemMediaTransportControls
// surface Raycast's Windows host uses for its media commands. The Spotify extension skips tracks
// through this instead of the Web API, so Next/Previous work without Spotify auth or an active
// device.
//
// WinRT projections come from the net9.0-windows10.0.x target framework (same as
// `Windows.Media.Ocr` in ClipboardOcr); no extra reference package is involved.

using System.Text.Json;
using Windows.Media.Control;

namespace Openray.Launcher;

public static class MediaControl
{
    private static Task<GlobalSystemMediaTransportControlsSessionManager>? _manager;

    public static async Task<object?> DispatchAsync(string method, JsonElement? data)
    {
        switch (method)
        {
            case "media.current":
                return await SnapshotAsync();
            case "media.control":
                return await ControlAsync(data);
            default:
                throw new InvalidOperationException($"no media handler for {method}");
        }
    }

    /// <summary>The session manager is requested once and reused for every call.</summary>
    private static Task<GlobalSystemMediaTransportControlsSessionManager> ManagerAsync()
        => _manager ??= GlobalSystemMediaTransportControlsSessionManager.RequestAsync().AsTask();

    /// <summary>
    /// The session to report: a playing one wins over a paused one, otherwise the first registered.
    /// </summary>
    private static GlobalSystemMediaTransportControlsSession? PickSession(
        GlobalSystemMediaTransportControlsSessionManager manager)
    {
        var sessions = manager.GetSessions();
        if (sessions.Count == 0) return null;
        return sessions.FirstOrDefault(session => session.GetPlaybackInfo().PlaybackStatus
                == GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing)
            ?? sessions[0];
    }

    private static async Task<object?> SnapshotAsync()
    {
        var session = PickSession(await ManagerAsync());
        if (session is null) return null;

        var properties = await session.TryGetMediaPropertiesAsync();
        var playing = session.GetPlaybackInfo().PlaybackStatus
            == GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing;

        // Project the timeline to "now": SMTC's Position is pinned to LastUpdatedTime. The extension
        // further extrapolates from the snapshot wall clock (`updatedAtMs`).
        var positionMs = 0.0;
        var durationMs = 0.0;
        try
        {
            var timeline = session.GetTimelineProperties();
            durationMs = timeline.EndTime.TotalMilliseconds;
            positionMs = timeline.Position.TotalMilliseconds
                + (playing ? (DateTimeOffset.UtcNow - timeline.LastUpdatedTime).TotalMilliseconds : 0);
        }
        catch
        {
            /* some sources expose no timeline; report zeros rather than failing the snapshot */
        }

        return new
        {
            playing,
            title = NullIfEmpty(properties.Title),
            artist = NullIfEmpty(properties.Artist),
            album = NullIfEmpty(properties.AlbumTitle),
            positionMs = (long)Math.Max(0, positionMs),
            durationMs = (long)Math.Max(0, durationMs),
            updatedAtMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
        };
    }

    private static async Task<object> ControlAsync(JsonElement? data)
    {
        var command = data?.TryGetProperty("command", out var element) == true && element.ValueKind == JsonValueKind.String
            ? element.GetString()
            : null;
        var session = PickSession(await ManagerAsync())
            ?? throw new InvalidOperationException("media.control: no active media session");
        switch (command)
        {
            case "playPause": await session.TryTogglePlayPauseAsync(); break;
            case "play": await session.TryPlayAsync(); break;
            case "pause": await session.TryPauseAsync(); break;
            case "next": await session.TrySkipNextAsync(); break;
            case "previous": await session.TrySkipPreviousAsync(); break;
            case "stop": await session.TryStopAsync(); break;
            default: throw new InvalidOperationException($"media.control: unknown command \"{command}\"");
        }
        return new { ok = true };
    }

    private static string? NullIfEmpty(string? value) => string.IsNullOrWhiteSpace(value) ? null : value;
}

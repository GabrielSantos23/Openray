// Application discovery — Raycast's internal "Applications" extension.
//
// Extracted from `frontend/internal-extensions-C7AXi5Nw.js`:
//
//   dynamicCommands: { application: S({
//     title:    payload => payload.name,
//     subtitle: payload => payload.disambiguator ?? null,
//     keywords: ({payload}) => [payload.bundleId, payload.name, payload.path],
//     rootSearch: { section: "apps" }                       <-- apps live in the "apps" root section
//   }).actions([{ name: "general", actions: [
//        openApplication, newApplicationWindow, recentFiles, runAsAdministrator,
//        runAsUser, revealApplication, showFileInfo, showPackageContents, showAppsFeatures ]},
//     C.favorites,
//     { name: "copy", actions: [ copyPath, copyName, copyBundleIdentifier ] },
//     { name: "configure", actions: [ configureCommand, configureExtension, markAsGame, resetRanking ] },
//     { name: "app-management", actions: [
//        hideApplication, quitApplication, forceQuitApplication, autoQuit,
//        restartApplication, disableCommand, uninstall ]}])}
//
// The Windows payload carries `name`, `path`, `bundleId` (AppUserModelID) and `disambiguator`,
// exactly as the C# side reports them through `Raycast.IPC.Types.Application` /
// `Raycast.AppDiscovery.*` (MsixApplicationsCollector, ShortcutApplicationWatcher,
// WingetLinksApplicationWatcher, ControlPanelItemsDiscovery).

using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;

namespace RaycastMini.Launcher;

public sealed record ApplicationEntry(
    string Id,
    string Name,
    string? Path,
    string? BundleId,
    string? Disambiguator,
    bool IsMsix,
    bool IsRunning,
    string? Icon = null);

public static class Applications
{
    /// <summary>Payload shape the frontend expects — mirrors Raycast's application payload.</summary>
    public static object ToPayload(ApplicationEntry app) => new
    {
        name = app.Name,
        path = app.Path,
        bundleId = app.BundleId,
        disambiguator = app.Disambiguator,
        id = app.Id,
        isRunning = app.IsRunning,
        icon = app.Icon,
    };

    /// <summary>Shortcuts Raycast never surfaces in the root search: uninstallers, help, docs.</summary>
    private static readonly string[] JunkKeywords =
    {
        "uninstall", "uninst", "help", "readme", "license", "documentation", "manual",
        "website", "visit ", "changelog", "faq", "release notes", "user guide", "repair",
    };

    private static readonly HashSet<string> InternalSystemBinaries = new(StringComparer.OrdinalIgnoreCase)
    {
        "svchost.exe", "csrss.exe", "lsass.exe", "smss.exe", "conhost.exe", "dwm.exe", "services.exe",
        "wininit.exe", "winlogon.exe", "fontdrvhost.exe", "sihost.exe", "taskhostw.exe", "runtimebroker.exe",
        "dllhost.exe", "spoolsv.exe", "ctfmon.exe", "wlanext.exe", "audiodg.exe", "explorer.exe",
        "textinputhost.exe", "shellexperiencehost.exe", "startmenuexperiencehost.exe", "searchhost.exe"
    };

    // The full scan takes seconds, and every action call used to pay for it again.
    // A short TTL gives instant actions and fresh results.
    private static readonly object CacheLock = new();
    private static List<ApplicationEntry>? _cache;
    private static DateTimeOffset _cacheTime;
    private static readonly TimeSpan CacheTtl = TimeSpan.FromSeconds(30);

    public static async Task<List<ApplicationEntry>> GetAllAsync()
    {
        lock (CacheLock)
        {
            if (_cache is not null && DateTimeOffset.UtcNow - _cacheTime < CacheTtl) return _cache;
        }
        var result = await ScanAllAsync();
        lock (CacheLock)
        {
            _cache = result;
            _cacheTime = DateTimeOffset.UtcNow;
        }
        return result;
    }

    private static async Task<List<ApplicationEntry>> ScanAllAsync()
    {
        var found = new Dictionary<string, ApplicationEntry>(StringComparer.OrdinalIgnoreCase);
        var shortcuts = 0;
        var skippedTargets = 0;
        var skippedJunk = 0;

        foreach (var shortcut in EnumerateStartMenuShortcuts())
        {
            var name = shortcut.Name;
            var target = shortcut.TargetPath;
            if (string.IsNullOrWhiteSpace(name) || string.IsNullOrWhiteSpace(target)) continue;
            shortcuts++;
            if (!target.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)) { skippedTargets++; continue; }
            if (JunkKeywords.Any(k => name.Contains(k, StringComparison.OrdinalIgnoreCase))) { skippedJunk++; continue; }

            var disambiguator = System.IO.Path.GetDirectoryName(target) is { } dir
                ? dir.TrimEnd('\\')
                : null;

            var id = $"path:{target.ToLowerInvariant()}";
            found[id] = new ApplicationEntry(
                id, name, target, AppUserModelId.ForPath(target), disambiguator, false, IsRunning(target));
        }

        foreach (var appPath in EnumerateAppPaths())
        {
            if (!found.ContainsKey(appPath.Id))
            {
                found[appPath.Id] = appPath;
            }
        }

        foreach (var regApp in EnumerateUninstallRegistryApps())
        {
            if (!found.ContainsKey(regApp.Id))
            {
                found[regApp.Id] = regApp;
            }
        }

        var msixCount = 0;
        foreach (var msix in EnumerateMsixPackages())
        {
            msixCount++;
            if (found.ContainsKey(msix.Id)) continue;
            found[msix.Id] = msix;
        }

        var processCount = 0;
        foreach (var process in Process.GetProcesses())
        {
            processCount++;
            try
            {
                var path = process.MainModule?.FileName;
                if (string.IsNullOrWhiteSpace(path) || !path.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)) continue;
                var fileName = System.IO.Path.GetFileName(path).ToLowerInvariant();
                if (InternalSystemBinaries.Contains(fileName)) continue;

                var id = $"path:{path.ToLowerInvariant()}";
                if (found.ContainsKey(id)) continue;

                var title = process.MainWindowTitle;
                var name = !string.IsNullOrWhiteSpace(title)
                    ? title
                    : System.IO.Path.GetFileNameWithoutExtension(path);

                found[id] = new ApplicationEntry(
                    id, name, path,
                    AppUserModelId.ForPath(path), null, false, true);
            }
            catch
            {
                /* access denied */
            }
            finally
            {
                process.Dispose();
            }
        }

        await Task.CompletedTask;

        var list = found.Values
            .GroupBy(app => app.Name, StringComparer.CurrentCultureIgnoreCase)
            .Select(group => group
                .OrderBy(app => app.Path?.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) == true ? 0 : 1)
                .ThenBy(app => app.Path?.Length ?? int.MaxValue)
                .ThenBy(app => app.IsMsix ? 1 : 0)
                .First())
            .OrderBy(app => app.Name, StringComparer.CurrentCultureIgnoreCase)
            .ToList();

        for (var index = 0; index < list.Count; index++)
        {
            var app = list[index];
            if (app.Path is { } target && target.EndsWith(".exe", StringComparison.OrdinalIgnoreCase))
            {
                list[index] = app with { Icon = IconCache.GetDataUrl(target) };
            }
        }

        RaycastMini.Launcher.App.Log.Write(
            $"[applications] shortcuts={shortcuts} skippedNotExe={skippedTargets} skippedJunk={skippedJunk} " +
            $"msix={msixCount} running={processCount} unique={found.Count}");
        return list;
    }

    private static IEnumerable<ApplicationEntry> EnumerateAppPaths()
    {
        var results = new List<ApplicationEntry>();
        var keys = new[]
        {
            @"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths",
            @"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths"
        };
        var hives = new[] { Microsoft.Win32.Registry.LocalMachine, Microsoft.Win32.Registry.CurrentUser };
        foreach (var hive in hives)
        {
            foreach (var keyPath in keys)
            {
                using var root = hive.OpenSubKey(keyPath);
                if (root is null) continue;
                foreach (var subKeyName in root.GetSubKeyNames())
                {
                    try
                    {
                        using var sub = root.OpenSubKey(subKeyName);
                        var rawPath = sub?.GetValue(null) as string;
                        if (string.IsNullOrWhiteSpace(rawPath)) continue;
                        var target = rawPath.Trim('"');
                        if (!target.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) || !File.Exists(target)) continue;
                        var name = System.IO.Path.GetFileNameWithoutExtension(target);
                        if (JunkKeywords.Any(k => name.Contains(k, StringComparison.OrdinalIgnoreCase))) continue;
                        var id = $"path:{target.ToLowerInvariant()}";
                        results.Add(new ApplicationEntry(id, name, target, AppUserModelId.ForPath(target), null, false, IsRunning(target)));
                    }
                    catch
                    {
                        /* ignore */
                    }
                }
            }
        }
        return results;
    }

    private static IEnumerable<ApplicationEntry> EnumerateUninstallRegistryApps()
    {
        var results = new List<ApplicationEntry>();
        var keys = new[]
        {
            @"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
            @"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"
        };
        var hives = new[] { Microsoft.Win32.Registry.LocalMachine, Microsoft.Win32.Registry.CurrentUser };
        foreach (var hive in hives)
        {
            foreach (var keyPath in keys)
            {
                using var root = hive.OpenSubKey(keyPath);
                if (root is null) continue;
                foreach (var subKeyName in root.GetSubKeyNames())
                {
                    try
                    {
                        using var sub = root.OpenSubKey(subKeyName);
                        var displayName = sub?.GetValue("DisplayName") as string;
                        if (string.IsNullOrWhiteSpace(displayName)) continue;
                        if (JunkKeywords.Any(k => displayName.Contains(k, StringComparison.OrdinalIgnoreCase))) continue;

                        var displayIcon = sub?.GetValue("DisplayIcon") as string;
                        string? target = null;
                        if (!string.IsNullOrWhiteSpace(displayIcon))
                        {
                            var candidate = displayIcon.Split(',')[0].Trim('"');
                            if (candidate.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) && File.Exists(candidate))
                            {
                                target = candidate;
                            }
                        }

                        if (target is null)
                        {
                            var installLocation = sub?.GetValue("InstallLocation") as string;
                            if (!string.IsNullOrWhiteSpace(installLocation) && Directory.Exists(installLocation))
                            {
                                var exe = Directory.EnumerateFiles(installLocation, "*.exe", SearchOption.TopDirectoryOnly).FirstOrDefault();
                                if (exe is not null && !JunkKeywords.Any(k => exe.Contains(k, StringComparison.OrdinalIgnoreCase)))
                                {
                                    target = exe;
                                }
                            }
                        }

                        if (target is not null)
                        {
                            var id = $"path:{target.ToLowerInvariant()}";
                            results.Add(new ApplicationEntry(id, displayName, target, AppUserModelId.ForPath(target), null, false, IsRunning(target)));
                        }
                    }
                    catch
                    {
                        /* ignore */
                    }
                }
            }
        }
        return results;
    }

    private static IEnumerable<(string Name, string TargetPath)> EnumerateStartMenuShortcuts()
    {
        var roots = new[]
        {
            Environment.GetFolderPath(Environment.SpecialFolder.CommonPrograms),
            Environment.GetFolderPath(Environment.SpecialFolder.Programs),
            Environment.GetFolderPath(Environment.SpecialFolder.CommonDesktopDirectory),
            Environment.GetFolderPath(Environment.SpecialFolder.Desktop),
        };

        foreach (var root in roots.Distinct(StringComparer.OrdinalIgnoreCase))
        {
            if (string.IsNullOrWhiteSpace(root) || !Directory.Exists(root)) continue;
            foreach (var file in Directory.EnumerateFiles(root, "*.lnk", SearchOption.AllDirectories))
            {
                var name = System.IO.Path.GetFileNameWithoutExtension(file);
                var target = ShortcutTarget.Resolve(file) ?? file;
                yield return (name, target);
            }
        }
    }

    /// <summary>
    /// Store (MSIX) applications. Raycast uses `Windows.Management.Deployment.PackageManager`
    /// directly; this reconstruction shells out to `Get-AppxPackage` so the launcher keeps the same
    /// dependency surface as the rest of the clone.
    /// </summary>
    private static IEnumerable<ApplicationEntry> EnumerateMsixPackages()
    {
        List<ApplicationEntry> packages;
        try
        {
            packages = QueryAppx();
        }
        catch (Exception error)
        {
            Debug.WriteLine($"[applications] MSIX enumeration failed: {error.Message}");
            yield break;
        }

        foreach (var package in packages)
        {
            var disambiguator = System.IO.Path.GetDirectoryName(package.Path) is { } dir
                ? dir.TrimEnd('\\')
                : null;
            yield return package with { Disambiguator = disambiguator };
        }
    }

    private static List<ApplicationEntry> QueryAppx()
    {
        var script =
            "Get-AppxPackage | Where-Object { $_.PackageFamilyName } | " +
            "ForEach-Object { [pscustomobject]@{ " +
            "Name = $_.Name; DisplayName = $(if ($_.Name) { $_.Name } else { '' }); " +
            "Family = $_.PackageFamilyName; InstallLocation = $_.InstallLocation; " +
            "AppId = $(try { (Get-AppxPackageManifest $_).Package.Applications.Application.Id } catch { '' }) } } | " +
            "ConvertTo-Json -Compress -Depth 4";

        var startInfo = new ProcessStartInfo("powershell.exe", $"-NoProfile -NonInteractive -Command \"{script}\"")
        {
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
        };

        using var process = Process.Start(startInfo)
            ?? throw new InvalidOperationException("powershell did not start");
        var output = process.StandardOutput.ReadToEnd();
        process.WaitForExit(20_000);

        var result = new List<ApplicationEntry>();
        if (string.IsNullOrWhiteSpace(output)) return result;

        using var document = JsonDocument.Parse(output);
        var items = document.RootElement.ValueKind == JsonValueKind.Array
            ? document.RootElement.EnumerateArray().ToList()
            : new List<JsonElement> { document.RootElement };

        foreach (var item in items)
        {
            var name = item.TryGetProperty("Name", out var nameElement) ? nameElement.GetString() : null;
            var family = item.TryGetProperty("Family", out var familyElement) ? familyElement.GetString() : null;
            var location = item.TryGetProperty("InstallLocation", out var locationElement) ? locationElement.GetString() : null;
            var appId = item.TryGetProperty("AppId", out var appIdElement) ? appIdElement.GetString() : null;
            if (string.IsNullOrWhiteSpace(name)) continue;
            var bundleId = string.IsNullOrWhiteSpace(appId) ? family : $"{family}!{appId}";
            result.Add(new ApplicationEntry(
                $"msix:{family}",
                name,
                location,
                bundleId,
                null,
                true,
                false));
        }
        return result;
    }

    private static bool IsRunning(string path)
    {
        try
        {
            var fileName = System.IO.Path.GetFileName(path);
            return Process.GetProcessesByName(
                System.IO.Path.GetFileNameWithoutExtension(path))
                .Any(process =>
                {
                    try { return string.Equals(process.MainModule?.FileName, path, StringComparison.OrdinalIgnoreCase); }
                    catch { return false; }
                });
        }
        catch
        {
            return false;
        }
    }

    /// <summary>
    /// The user's default browser executable, resolved the way Windows itself does: the http(s)
    /// UserChoice ProgId, then that ProgId's open command. The Open With picker matches the path
    /// against the application list so the "Default" row carries the browser's real name and icon.
    /// </summary>
    private static string? GetDefaultBrowserPath()
    {
        try
        {
            var userChoice = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(
                @"Software\Microsoft\Windows\Shell\Associations\UrlAssociations\https\UserChoice");
            var progId = userChoice?.GetValue("ProgId") as string;
            if (string.IsNullOrEmpty(progId)) return null;
            var command = Microsoft.Win32.Registry.ClassesRoot
                .OpenSubKey($"{progId}\\shell\\open\\command")?.GetValue(null) as string;
            if (string.IsNullOrEmpty(command)) return null;
            if (command!.StartsWith('"'))
            {
                var end = command.IndexOf('"', 1);
                return end > 0 ? command[1..end] : null;
            }
            var space = command.IndexOf(' ');
            return space > 0 ? command[..space] : command;
        }
        catch
        {
            return null;
        }
    }

    public static async Task<object?> DispatchAsync(string method, JsonElement? data)
    {        RaycastMini.Launcher.App.Log.Write($"[native] {method}");
        switch (method)
        {
            case "applications.getAll":
            {
                var apps = await GetAllAsync();
                return new { value = apps.Select(ToPayload) };
            }
            case "applications.getDefaultBrowser":
            {
                return new { path = GetDefaultBrowserPath() };
            }
            case "applications.open":
            {
                var id = data?.GetProperty("id").GetString();
                var app = (await GetAllAsync()).FirstOrDefault(entry => entry.Id == id);
                if (app is null) throw new InvalidOperationException($"unknown application {id}");
                Launch(app);
                return new { ok = true };
            }
            case "applications.reveal":
            {
                var id = data?.GetProperty("id").GetString();
                var app = (await GetAllAsync()).FirstOrDefault(entry => entry.Id == id);
                if (app?.Path is null) throw new InvalidOperationException("no path to reveal");
                Process.Start(new ProcessStartInfo("explorer.exe", $"/select,\"{app.Path}\"") { UseShellExecute = true });
                return new { ok = true };
            }
            case "applications.openRecentFiles":
            {
                var app = (await GetAllAsync()).FirstOrDefault(entry => entry.Id == data?.GetProperty("id").GetString());
                if (app?.Path is null) throw new InvalidOperationException("no path");
                var recent = System.IO.Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                    "Microsoft", "Windows", "Recent");
                Process.Start(new ProcessStartInfo("explorer.exe", $"\"{recent}\"") { UseShellExecute = true });
                return new { ok = true };
            }
            case "applications.copyPath":
            case "applications.copyName":
            {
                var app = (await GetAllAsync()).FirstOrDefault(entry => entry.Id == data?.GetProperty("id").GetString())
                    ?? throw new InvalidOperationException("unknown application");
                var content = method.EndsWith("copyName", StringComparison.Ordinal) ? app.Name : app.Path ?? app.BundleId ?? "";
                return new { content };
            }
            case "applications.quit":
            case "applications.forceQuit":
            {
                var id = data?.GetProperty("id").GetString();
                var app = (await GetAllAsync()).FirstOrDefault(entry => entry.Id == id);
                if (app?.Path is null) return new { ok = true };
                var force = method.EndsWith("forceQuit", StringComparison.Ordinal);
                foreach (var process in Process.GetProcessesByName(System.IO.Path.GetFileNameWithoutExtension(app.Path)))
                {
                    try
                    {
                        if (force) process.Kill(entireProcessTree: true);
                        else process.CloseMainWindow();
                    }
                    catch
                    {
                        /* access denied */
                    }
                }
                return new { ok = true };
            }
            case "applications.showProperties":
            {
                // Raycast's "Show Advanced Options": the Windows shell property sheet for the target.
                var id = data?.GetProperty("id").GetString();
                var app = (await GetAllAsync()).FirstOrDefault(entry => entry.Id == id);
                if (app?.Path is null) throw new InvalidOperationException("no path to inspect");
                Process.Start(new ProcessStartInfo("explorer.exe", $"/properties,\"{app.Path}\"")
                {
                    UseShellExecute = true,
                });
                return new { ok = true };
            }
            case "applications.runAsAdministrator":
            {
                var id = data?.GetProperty("id").GetString();
                var app = (await GetAllAsync()).FirstOrDefault(entry => entry.Id == id)
                    ?? throw new InvalidOperationException("unknown application");
                Launch(app, elevated: true);
                return new { ok = true };
            }
            case "applications.runAsUser":
            {
                // ShellExecute's "runasuser" verb raises the Windows credential prompt, which is
                // exactly what Raycast's "Run as Different User" action does on Windows.
                var id = data?.GetProperty("id").GetString();
                var app = (await GetAllAsync()).FirstOrDefault(entry => entry.Id == id)
                    ?? throw new InvalidOperationException("unknown application");
                LaunchWithVerb(app, "runasuser");
                return new { ok = true };
            }
            case "applications.newWindow":
            {
                // Windows apps almost never expose a "new window" entry point, so Raycast simply
                // starts another instance — Store apps included.
                var id = data?.GetProperty("id").GetString();
                var app = (await GetAllAsync()).FirstOrDefault(entry => entry.Id == id)
                    ?? throw new InvalidOperationException("unknown application");
                Launch(app);
                return new { ok = true };
            }
            case "applications.hide":
            {
                var id = data?.GetProperty("id").GetString();
                var app = (await GetAllAsync()).FirstOrDefault(entry => entry.Id == id);
                if (app?.Path is null) return new { ok = true };
                // Raycast's "Hide Application": minimise every top-level window the app owns.
                var processName = System.IO.Path.GetFileNameWithoutExtension(app.Path);
                foreach (var process in Process.GetProcessesByName(processName))
                {
                    try
                    {
                        var handle = process.MainWindowHandle;
                        if (handle != IntPtr.Zero) ShowWindow(handle, SW_MINIMIZE);
                    }
                    catch
                    {
                        /* access denied / no main window */
                    }
                }
                return new { ok = true };
            }
            case "applications.restart":
            {
                var id = data?.GetProperty("id").GetString();
                var app = (await GetAllAsync()).FirstOrDefault(entry => entry.Id == id)
                    ?? throw new InvalidOperationException("unknown application");
                var processName = System.IO.Path.GetFileNameWithoutExtension(app.Path ?? string.Empty);
                if (!string.IsNullOrEmpty(processName))
                {
                    foreach (var process in Process.GetProcessesByName(processName))
                    {
                        try
                        {
                            process.CloseMainWindow();
                        }
                        catch
                        {
                            /* access denied */
                        }
                    }

                    // Give the app a moment to exit, then start it again so the relaunch wins.
                    await Task.Delay(700);
                }
                Launch(app);
                return new { ok = true };
            }
            case "applications.uninstall":
            {
                // Raycast opens Windows' "Installed apps" settings instead of uninstalling behind
                // the user's back.
                var id = data?.GetProperty("id").GetString();
                var app = (await GetAllAsync()).FirstOrDefault(entry => entry.Id == id)
                    ?? throw new InvalidOperationException("unknown application");
                Process.Start(new ProcessStartInfo("ms-settings:appsfeatures") { UseShellExecute = true });
                return new { ok = true };
            }
            default:
                throw new InvalidOperationException($"no such applications method: {method}");
        }
    }

    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    private const int SW_MINIMIZE = 6;

    private static void LaunchWithVerb(ApplicationEntry app, string verb)
    {
        if (app.IsMsix || (app.BundleId?.Contains("!") ?? false))
        {
            var startInfo = new ProcessStartInfo("explorer.exe", $"shell:AppsFolder\\{app.BundleId}")
            {
                UseShellExecute = true,
                Verb = verb,
            };
            Process.Start(startInfo);
            return;
        }

        if (app.Path is null) throw new InvalidOperationException("no launch target");
        Process.Start(new ProcessStartInfo(app.Path) { UseShellExecute = true, Verb = verb });
    }

    private static void Launch(ApplicationEntry app, bool elevated = false)
    {
        if (app.IsMsix || (app.BundleId?.Contains("!") ?? false))
        {
            // Store apps launch through their AppUserModelID.
            var startInfo = new ProcessStartInfo("explorer.exe", $"shell:AppsFolder\\{app.BundleId}")
            {
                UseShellExecute = true,
            };
            Process.Start(startInfo);
            return;
        }

        if (app.Path is null) throw new InvalidOperationException("no launch target");
        Process.Start(new ProcessStartInfo(app.Path) { UseShellExecute = true, Verb = elevated ? "runas" : "" });
    }
}

/// <summary>Minimal .lnk resolution so Start Menu entries report their real target.</summary>
internal static class ShortcutTarget
{
    public static string? Resolve(string shortcutPath)
    {
        // `WScript.Shell` does NOT implement `IShellLink` directly — you have to ask it for a
        // `CreateShortcut` object first. The old `(IShellLink)Activator.CreateInstance(...)`
        // cast always threw, so every lookup fell back to the .lnk path and the `.exe` filter
        // dropped the entry.
        try
        {
            var shellType = Type.GetTypeFromProgID("WScript.Shell");
            if (shellType is null) return null;
            var shell = Activator.CreateInstance(shellType);
            if (shell is null) return null;

            var shortcut = shellType.InvokeMember(
                "CreateShortcut",
                System.Reflection.BindingFlags.InvokeMethod,
                null,
                shell,
                new object[] { shortcutPath });
            if (shortcut is null) return null;

            var target = shortcut.GetType().InvokeMember(
                "TargetPath",
                System.Reflection.BindingFlags.GetProperty,
                null,
                shortcut,
                null) as string;

            return string.IsNullOrWhiteSpace(target) ? null : target;
        }
        catch
        {
            return null;
        }
    }
}

/// <summary>Derives an AppUserModelID for classic Win32 apps so the payload matches Raycast's `bundleId`.</summary>
internal static class AppUserModelId
{
    public static string ForPath(string path)
    {
        var directory = System.IO.Path.GetDirectoryName(path) ?? string.Empty;
        var fileName = System.IO.Path.GetFileName(path);
        return $"{directory}\\{fileName}";
    }
}

/// <summary>
/// Shell icon extraction with an on-disk cache — the Windows counterpart of Raycast's app icon
/// pipeline (macOS reads NSWorkspace icons; Windows extracts the associated icon of the target and
/// caches it as a PNG data URL keyed by the target path).
/// </summary>
internal static class IconCache
{
    private static readonly string CacheDir = System.IO.Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "RaycastMini", "icon-cache");

    public static string? GetDataUrl(string executablePath)
    {
        try
        {
            Directory.CreateDirectory(CacheDir);
            var key = Convert.ToHexString(
                System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(
                    $"{executablePath.ToLowerInvariant()}|{GetFileTimestamp(executablePath)}")));
            var cacheFile = System.IO.Path.Combine(CacheDir, $"{key}.png");

            byte[] png;
            if (File.Exists(cacheFile))
            {
                png = File.ReadAllBytes(cacheFile);
            }
            else
            {
                using var icon = System.Drawing.Icon.ExtractAssociatedIcon(executablePath);
                if (icon is null) return null;
                using var bitmap = icon.ToBitmap();
                using var stream = new MemoryStream();
                bitmap.Save(stream, System.Drawing.Imaging.ImageFormat.Png);
                png = stream.ToArray();
                File.WriteAllBytes(cacheFile, png);
            }
            return $"data:image/png;base64,{Convert.ToBase64String(png)}";
        }
        catch
        {
            // Icons must never break discovery: access denied, no embedded icon, etc.
            return null;
        }
    }

    private static long GetFileTimestamp(string path)
    {
        try { return File.GetLastWriteTimeUtc(path).Ticks; }
        catch { return 0; }
    }
}

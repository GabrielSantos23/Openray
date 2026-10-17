// Snippet auto-expansion — the low-level keyboard hook.
//
// Raycast's hook lives in native Rust (`native.dll`: REGISTER_SNIPPETS, ENABLE_SNIPPET_AUTO_EXPANSION,
// EXPAND_SNIPPET, `on_snippet_matched` / `on_snippet_match_cancelled`) with the C# shell pushing the
// config (`UpdateSnippetExpansionConfig`, `UpdateSnippetExpansionDisabledApps`). The clone keeps the
// same architecture with C# primitives: a WH_KEYBOARD_LL hook feeds a ring of recently typed
// characters, `SnippetMatcher` decides when a registered keyword completed, and the expansion runs
// on a worker — never inside the hook callback — so keystroke latency is unaffected.
//
// Insertion is synthetic input: backspaces erase the keyword, then KEYEVENTF_UNICODE types the
// resolved text (the `{cursor}` placeholder moves the caret back over the tail afterwards). The
// backend resolves placeholders over the pipe (`snippets.resolve {snippetId}`) because it is alive
// while the launcher is hidden. Snippet text, keywords and resolved content are never logged — ids
// and outcomes only.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Media;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace Openray.Launcher;

public static class SnippetHook
{
    private delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);

    private const int WhKeyboardLl = 13;
    private const int WmKeyDown = 0x0100;
    private const int WmSysKeyDown = 0x0104;
    private const uint LLKHF_INJECTED = 0x10;

    private const int VkBack = 0x08;
    private const int VkTab = 0x09;
    private const int VkReturn = 0x0D;
    private const int VkShift = 0x10;
    private const int VkControl = 0x11;
    private const int VkMenu = 0x12;
    private const int VkCapital = 0x14;
    private const int VkLWin = 0x5B;
    private const int VkRWin = 0x5C;

    private const uint KeyEventfKeyup = 0x0002;
    private const uint KeyEventfUnicode = 0x0004;
    private const uint InputKeyboard = 1;
    private const uint ProcessQueryLimitedInformation = 0x1000;
    private const int TokenQuery = 0x0008;
    private const int TokenElevation = 20;

    /// <summary>Delay (ms) between a match and the expansion, so longer keywords can still win.</summary>
    private static readonly IReadOnlyDictionary<string, int> InjectionDelays = new Dictionary<string, int>
    {
        ["none"] = 0,
        ["short"] = 150,
        ["regular"] = 300,
        ["long"] = 600,
        ["extra-long"] = 1200,
    };

    /// <summary>Settle time (ms) between the backspace phase and the text injection phase.</summary>
    private static readonly IReadOnlyDictionary<string, int> ResponseTimes = new Dictionary<string, int>
    {
        ["instant"] = 100,
        ["quick"] = 200,
        ["default"] = 350,
        ["delayed"] = 600,
        ["extended"] = 1000,
    };

    private static readonly object Gate = new();
    private static readonly nuint InjectedMarker = 0x524D_434E;

    private static NamedPipeBridge? _pipe;
    private static IntPtr _hook;
    private static readonly LowLevelKeyboardProc HookCallback = HookProc;
    private static SnippetMatcher _matcher = new(Array.Empty<SnippetMatcher.Keyword>());
    private static List<char> _buffer = new();
    private static bool _leftEdgeUnknown;
    private static volatile bool _enabled = true;
    private static string _mode = SnippetMatcher.ModeImmediately;
    private static bool _withinWords;
    private static string _completionSound = "none";
    private static IReadOnlyList<string> _disabledApplications = Array.Empty<string>();
    private static volatile bool _launcherVisible;
    private static long _generation;
    private static int _injectionDelayMs;
    private static string _responseTimeName = "default";

    private sealed class Pending
    {
        public long Generation;
        public string SnippetId = "";
        public int MatchLength;
    }

    public static void Install(NamedPipeBridge pipe)
    {
        _pipe = pipe;
        if (_hook != IntPtr.Zero) return;
        var hook = SetWindowsHookEx(WhKeyboardLl, HookCallback, GetModuleHandle(null), 0);
        if (hook == IntPtr.Zero)
        {
            App.Log.Write($"[snippets] could not install the keyboard hook (error {Marshal.GetLastWin32Error()})");
            return;
        }
        _hook = hook;
        App.Log.Write("[snippets] keyboard hook installed");
    }

    public static void Uninstall()
    {
        if (_hook != IntPtr.Zero)
        {
            UnhookWindowsHookEx(_hook);
            _hook = IntPtr.Zero;
        }
    }

    public static void SetLauncherVisible(bool visible) => _launcherVisible = visible;

    /// <summary>`snippets.register {snippetIds, keywords}` — replaces the whole keyword set.</summary>
    public static object RegisterKeywords(JsonElement? data)
    {
        var (ids, keywords) = ReadKeywordPayload(data);
        lock (Gate)
        {
            var pairs = new List<SnippetMatcher.Keyword>();
            for (var i = 0; i < Math.Min(ids.Count, keywords.Count); i++)
            {
                pairs.Add(new SnippetMatcher.Keyword(ids[i], keywords[i]));
            }
            _matcher = new SnippetMatcher(pairs);
            if (_buffer.Count > _matcher.MaxKeywordLength + 16)
            {
                _buffer.RemoveRange(0, _buffer.Count - _matcher.MaxKeywordLength - 16);
                _leftEdgeUnknown = true;
            }
        }
        App.Log.Write($"[snippets] registered {keywords.Count} snippet keyword(s)");
        return new { ok = true };
    }

    /// <summary>`snippets.remove {snippetIds}` — drops those snippets' keywords.</summary>
    public static object RemoveKeywords(JsonElement? data)
    {
        var (ids, _) = ReadKeywordPayload(data);
        var removed = new HashSet<string>(ids);
        lock (Gate)
        {
            _matcher = new SnippetMatcher(_matcher.Keywords.Where(keyword => !removed.Contains(keyword.SnippetId)));
        }
        App.Log.Write($"[snippets] removed {removed.Count} snippet registration(s)");
        return new { ok = true };
    }

    private static (List<string> ids, List<string> keywords) ReadKeywordPayload(JsonElement? data)
    {
        var ids = new List<string>();
        var keywords = new List<string>();
        if (data is { ValueKind: JsonValueKind.Object } payload)
        {
            if (payload.TryGetProperty("snippetIds", out var idsElement) && idsElement.ValueKind == JsonValueKind.Array)
            {
                ids.AddRange(idsElement.EnumerateArray().Select(element => element.GetString() ?? ""));
            }
            if (payload.TryGetProperty("keywords", out var keywordsElement) && keywordsElement.ValueKind == JsonValueKind.Array)
            {
                keywords.AddRange(keywordsElement.EnumerateArray().Select(element => element.GetString() ?? ""));
            }
        }
        return (ids, keywords);
    }

    /// <summary>`snippets.setConfig {…}` — the backend pushes the whole expansion config.</summary>
    public static object ApplyConfig(JsonElement? data)
    {
        if (data is { ValueKind: JsonValueKind.Object } config)
        {
            _enabled = config.TryGetProperty("autoExpansionEnabled", out var enabled) && enabled.ValueKind == JsonValueKind.True;
            _mode = config.TryGetProperty("expansionMode", out var mode) && mode.ValueKind == JsonValueKind.String
                ? mode.GetString() ?? SnippetMatcher.ModeImmediately
                : SnippetMatcher.ModeImmediately;
            _withinWords = config.TryGetProperty("expandWithinWords", out var withinWords) && withinWords.ValueKind == JsonValueKind.True;
            if (config.TryGetProperty("injectionDelay", out var injectionDelay) && injectionDelay.ValueKind == JsonValueKind.String)
            {
                _injectionDelayMs = InjectionDelays.GetValueOrDefault(injectionDelay.GetString() ?? "none", 0);
            }
            if (config.TryGetProperty("responseTime", out var responseTime) && responseTime.ValueKind == JsonValueKind.String)
            {
                _responseTimeName = responseTime.GetString() ?? "default";
            }
            if (config.TryGetProperty("completionSound", out var sound) && sound.ValueKind == JsonValueKind.String)
            {
                _completionSound = sound.GetString() ?? "none";
            }
            if (config.TryGetProperty("disabledApplications", out var disabled) && disabled.ValueKind == JsonValueKind.Array)
            {
                _disabledApplications = disabled.EnumerateArray()
                    .Select(element => element.GetString() ?? "")
                    .Where(pattern => pattern.Length > 0)
                    .ToList();
            }
        }
        App.Log.Write(
            $"[snippets] expansion config applied (enabled={_enabled} mode={_mode} withinWords={_withinWords} " +
            $"disabledApps={_disabledApplications.Count})");
        return new { ok = true };
    }

    private static IntPtr HookProc(int code, IntPtr wParam, IntPtr lParam)
    {
        if (code >= 0)
        {
            try
            {
                var keyboard = Marshal.PtrToStructure<KbdLlHookStruct>(lParam);
                var message = wParam.ToInt32();
                var injected = (keyboard.Flags & LLKHF_INJECTED) != 0 || keyboard.ExtraInfo == (UIntPtr)InjectedMarker;
                if (!injected && message is WmKeyDown or WmSysKeyDown)
                {
                    ProcessKey(keyboard.VkCode, keyboard.ScanCode);
                }
            }
            catch
            {
                // A hook exception would stall every keystroke in the session; swallow and pass on.
            }
        }
        return CallNextHookEx(_hook, code, wParam, lParam);
    }

    private static void ProcessKey(uint vkCode, uint scanCode)
    {
        if ((GetAsyncKeyState(VkControl) & 0x8000) != 0 || (GetAsyncKeyState(VkMenu) & 0x8000) != 0 ||
            (GetAsyncKeyState(VkLWin) & 0x8000) != 0 || (GetAsyncKeyState(VkRWin) & 0x8000) != 0)
        {
            return;
        }

        if (vkCode == VkBack)
        {
            lock (Gate)
            {
                if (_buffer.Count > 0)
                {
                    _buffer.RemoveAt(_buffer.Count - 1);
                    if (_buffer.Count == 0) _leftEdgeUnknown = true;
                }
            }
            return;
        }

        if (vkCode == (uint)VkShift || vkCode == 0xA0 || vkCode == 0xA1 || vkCode == VkCapital) return;

        if (!TryCharFromKey(vkCode, scanCode, out var typed))
        {
            // Anything that moves the caret or dismisses context invalidates the typed stream.
            ClearBuffer();
            return;
        }

        lock (Gate)
        {
            _buffer.Add(typed);
            var capacity = Math.Max(_matcher.MaxKeywordLength + 16, 64);
            if (_buffer.Count > capacity)
            {
                _buffer.RemoveRange(0, _buffer.Count - capacity);
                _leftEdgeUnknown = true;
            }
            var match = _matcher.TryMatch(_buffer, _leftEdgeUnknown, _mode, _withinWords);
            if (match is null) return;

            Interlocked.Increment(ref _generation);
            var pending = new Pending
            {
                Generation = _generation,
                SnippetId = match.SnippetId,
                MatchLength = match.MatchLength,
            };
            _ = Task.Run(() => RunExpansion(pending, match.DelimiterTyped));
        }
    }

    private static void ClearBuffer()
    {
        lock (Gate)
        {
            _buffer.Clear();
            _leftEdgeUnknown = false;
        }
    }

    private static bool TryCharFromKey(uint vkCode, uint scanCode, out char typed)
    {
        typed = '\0';
        if (vkCode == VkTab) { typed = SnippetMatcher.DelimiterTab; return true; }
        if (vkCode == VkReturn) { typed = SnippetMatcher.DelimiterEnter; return true; }

        var state = new byte[256];
        if ((GetAsyncKeyState(VkShift) & 0x8000) != 0)
        {
            state[VkShift] = 0x80;
            state[0xA1] = 0x80;
        }
        var builder = new StringBuilder(4);
        var result = ToUnicodeEx((int)vkCode, (int)scanCode, state, builder, builder.Capacity, 0, GetKeyboardLayout(0));
        if (result != 1) return false;
        typed = builder[0];
        return typed >= ' ' && typed != '\u007F';
    }

    private static async Task RunExpansion(Pending pending, bool delimiterTyped)
    {
        lock (Gate)
        {
            if (pending.Generation != _generation)
            {
                LogCancelled("superseded");
                return;
            }
        }

        if (_mode == SnippetMatcher.ModeImmediately && _injectionDelayMs > 0)
        {
            await Task.Delay(_injectionDelayMs);
            lock (Gate)
            {
                if (pending.Generation != _generation || _buffer.Count != pending.MatchLength)
                {
                    LogCancelled("superseded while waiting");
                    return;
                }
            }
        }

        var reason = ExpansionBlocked();
        if (reason is not null)
        {
            LogCancelled(reason);
            ClearBuffer();
            return;
        }

        string text;
        int? cursor;
        try
        {
            if (_pipe is null) throw new InvalidOperationException("pipe is unavailable");
            var response = await _pipe.RequestAsync("backend", "snippets.resolve", new { snippetId = pending.SnippetId });
            if (response is null) throw new InvalidOperationException("empty resolve response");
            text = response.Value.TryGetProperty("text", out var textElement) ? textElement.GetString() ?? "" : "";
            cursor = response.Value.TryGetProperty("cursor", out var cursorElement) && cursorElement.ValueKind == JsonValueKind.Number
                ? cursorElement.GetInt32()
                : null;
        }
        catch (Exception error)
        {
            App.Log.Write($"[snippets] resolve failed for snippet {pending.SnippetId}: {error.Message}");
            return;
        }

        var truncated = false;
        if (text.Length > 65536)
        {
            text = text[..65536];
            truncated = true;
        }

        var (head, tail) = SnippetMatcher.SplitAtCursor(text, cursor);
        var backspaces = SnippetMatcher.BackspaceCount(pending.MatchLength, delimiterTyped, _mode == SnippetMatcher.ModeDelimiterDiscard);
        var settle = ResponseTimes.GetValueOrDefault(_responseTimeName, 350);
        if (settle > 0) await Task.Delay(settle);

        var inputs = new List<INPUT>();
        for (var i = 0; i < backspaces; i++)
        {
            inputs.Add(KeyInput(VkBack, 0, unicode: false));
            inputs.Add(KeyInput(VkBack, 0, unicode: true));
        }
        foreach (var character in head.Concat(tail))
        {
            var code = character == '\n' ? '\r' : character;
            inputs.Add(CharInput(code, keyUp: false));
            inputs.Add(CharInput(code, keyUp: true));
        }
        for (var i = 0; i < SnippetMatcher.CaretReturnCount(tail); i++)
        {
            inputs.Add(KeyInput(0x25 /* VK_LEFT */, 0, unicode: false));
            inputs.Add(KeyInput(0x25, 0, unicode: true));
        }

        var array = inputs.ToArray();
        var sent = SendInput((uint)array.Length, array, Marshal.SizeOf<INPUT>());
        lock (Gate)
        {
            _buffer.Clear();
            _leftEdgeUnknown = false;
        }
        App.Log.Write(
            $"[snippets] expanded snippet {pending.SnippetId} (chars={text.Length}, backspaces={backspaces}, " +
            $"sent={sent}/{array.Length}{(truncated ? ", truncated" : "")})");
        PlayCompletionSound();

        _ = Task.Run(async () =>
        {
            try
            {
                if (_pipe is not null)
                {
                    await _pipe.RequestAsync("backend", "snippets.updateAccessedAt", new { id = pending.SnippetId });
                }
            }
            catch
            {
                /* bookkeeping only */
            }
        });
    }

    private static void LogCancelled(string reason) => App.Log.Write($"[snippets] match cancelled ({reason})");

    private static string? ExpansionBlocked()
    {
        if (!_enabled) return "expansion is disabled";
        if (_launcherVisible) return "the launcher is visible";

        var foreground = GetForegroundWindow();
        if (foreground == IntPtr.Zero) return "no foreground window";
        _ = GetWindowThreadProcessId(foreground, out var processId);
        if (processId == (uint)Environment.ProcessId) return "the launcher owns the foreground window";
        if (IsDisabledApplication(processId)) return "the application is disabled";
        if (IsElevatedProcess(processId)) return "the application is elevated";
        if (IsPasswordField()) return "the focused field is a password field";
        return null;
    }

    private static bool IsDisabledApplication(uint processId)
    {
        if (_disabledApplications.Count == 0) return false;
        try
        {
            var processName = Process.GetProcessById((int)processId).ProcessName;
            var candidates = new[] { processName, $"{processName}.exe" };
            foreach (var pattern in _disabledApplications)
            {
                var regex = GlobToRegExp(pattern);
                if (candidates.Any(candidate => candidate.Length > 0 && regex.IsMatch(candidate))) return true;
            }
        }
        catch
        {
            // A vanished process cannot match the disabled list.
        }
        return false;
    }

    private static System.Text.RegularExpressions.Regex GlobToRegExp(string pattern)
    {
        var escaped = pattern.Replace(".", "\\.").Replace("*", ".*").Replace("?", ".");
        return new System.Text.RegularExpressions.Regex($"^{escaped}$", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
    }

    private static bool IsElevatedProcess(uint processId)
    {
        var handle = OpenProcess(ProcessQueryLimitedInformation, false, processId);
        if (handle == IntPtr.Zero) return true;
        try
        {
            if (!OpenProcessToken(handle, TokenQuery, out var token)) return true;
            try
            {
                if (!GetTokenInformation(token, TokenElevation, out var elevation, sizeof(int), out _)) return true;
                return elevation != 0;
            }
            finally
            {
                CloseHandle(token);
            }
        }
        finally
        {
            CloseHandle(handle);
        }
    }

    private static bool IsPasswordField()
    {
        try
        {
            var focused = System.Windows.Automation.AutomationElement.FocusedElement;
            return focused?.Current.IsPassword ?? false;
        }
        catch
        {
            return false;
        }
    }

    private static void PlayCompletionSound()
    {
        try
        {
            var sound = _completionSound switch
            {
                "asterisk" => SystemSounds.Asterisk,
                "beep" => SystemSounds.Beep,
                "exclamation" => SystemSounds.Exclamation,
                "hand" => SystemSounds.Hand,
                "question" => SystemSounds.Question,
                _ => null,
            };
            sound?.Play();
        }
        catch
        {
            /* a missing sound profile must not break the expansion */
        }
    }

    private static INPUT KeyInput(int vk, uint scan, bool unicode) => new()
    {
        Type = InputKeyboard,
        Ki = new KEYBDINPUT
        {
            WVk = (ushort)vk,
            WScan = (ushort)scan,
            DwFlags = unicode ? KeyEventfKeyup : 0,
            DwExtraInfo = (UIntPtr)InjectedMarker,
        },
    };

    private static INPUT CharInput(char character, bool keyUp) => new()
    {
        Type = InputKeyboard,
        Ki = new KEYBDINPUT
        {
            WVk = 0,
            WScan = (ushort)character,
            DwFlags = KeyEventfUnicode | (keyUp ? KeyEventfKeyup : 0),
            DwExtraInfo = (UIntPtr)InjectedMarker,
        },
    };

    [StructLayout(LayoutKind.Sequential)]
    private struct KbdLlHookStruct
    {
        public uint VkCode;
        public uint ScanCode;
        public uint Flags;
        public uint Time;
        public UIntPtr ExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct INPUT
    {
        public uint Type;
        public KEYBDINPUT Ki;
        public ulong Padding;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct KEYBDINPUT
    {
        public ushort WVk;
        public ushort WScan;
        public uint DwFlags;
        public uint Time;
        public UIntPtr DwExtraInfo;
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc lpfn, IntPtr hMod, uint dwThreadId);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool UnhookWindowsHookEx(IntPtr hhk);

    [DllImport("user32.dll")]
    private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr GetModuleHandle(string? lpModuleName);

    [DllImport("user32.dll")]
    private static extern short GetAsyncKeyState(int vKey);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int ToUnicodeEx(
        int wVirtKey, int wScanCode, byte[] lpKeyState, StringBuilder pwszBuff, int cchBuff, uint wFlags, IntPtr dwhkl);

    [DllImport("user32.dll")]
    private static extern IntPtr GetKeyboardLayout(uint idThread);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(uint dwDesiredAccess, bool bInheritHandle, uint dwProcessId);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool OpenProcessToken(IntPtr processHandle, int desiredAccess, out IntPtr tokenHandle);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool GetTokenInformation(
        IntPtr tokenHandle, int tokenInformationClass, out int tokenInformation, int tokenInformationLength, out int returnLength);

    [DllImport("kernel32.dll")]
    private static extern bool CloseHandle(IntPtr handle);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint SendInput(uint numberOfInputs, INPUT[] inputs, int sizeOfInput);
}

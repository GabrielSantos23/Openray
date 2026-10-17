// Assertion harness for the snippet expansion decision logic (no external test packages).
//
// `dotnet run --project host.tests` runs every check against the shipped `SnippetMatcher`, the
// pure half of the keyboard hook: keyword matching over a typed-character buffer, the
// backspace/caret plan, and the `{cursor}` split. The Win32 half of the hook is exercised in the
// running app (the manual test checklist in docs/snippets-spec.md).

using System;
using System.Collections.Generic;
using System.Linq;
using Openray.Launcher;

namespace Openray.Host.Tests;

internal static class Program
{
    private static int _failures;
    private static int _count;

    private static void Run(string name, Action check)
    {
        _count++;
        try
        {
            check();
            Console.WriteLine($"PASS {name}");
        }
        catch (Exception error)
        {
            _failures++;
            Console.WriteLine($"FAIL {name}: {error.Message}");
        }
    }

    private static void Equal<T>(T expected, T actual, string context)
    {
        if (!EqualityComparer<T>.Default.Equals(expected, actual))
        {
            throw new Exception($"{context}: expected {expected}, got {actual}");
        }
    }

    private static void True(bool value, string context)
    {
        if (!value) throw new Exception(context);
    }

    private static void Null(object? value, string context)
    {
        if (value is not null) throw new Exception($"{context}: expected null, got {value}");
    }

    private static SnippetMatcher Matcher(params (string id, string keyword)[] keywords) =>
        new(keywords.Select(keyword => new SnippetMatcher.Keyword(keyword.id, keyword.keyword)));

    /// <summary>Feeds a keystroke stream through the same buffer rules the hook uses.</summary>
    private static SnippetMatcher.Match? Feed(
        SnippetMatcher matcher,
        string keys,
        string mode,
        bool withinWords,
        out List<char> buffer)
    {
        buffer = new List<char>();
        var capacity = Math.Max(matcher.MaxKeywordLength + 16, 64);
        var leftEdgeUnknown = false;
        SnippetMatcher.Match? last = null;
        foreach (var key in keys)
        {
            buffer.Add(key);
            if (buffer.Count > capacity)
            {
                buffer.RemoveRange(0, buffer.Count - capacity);
                leftEdgeUnknown = true;
            }
            last = matcher.TryMatch(buffer, leftEdgeUnknown, mode, withinWords);
        }
        return last;
    }

    private static int Main()
    {
        // Immediately mode: a keyword at the end of the stream matches, case-insensitively.
        Run("immediately mode matches at the end of the stream", () =>
        {
            var matcher = Matcher(("s1", ";em"));
            var match = Feed(matcher, "hello ;em", SnippetMatcher.ModeImmediately, withinWords: false, out _);
            True(match is not null, "no match");
            Equal("s1", match!.SnippetId, "snippet id");
            Equal(3, match.MatchLength, "match length");
            False2(match.DelimiterTyped, "no delimiter expected");
        });

        Run("matching is case-insensitive", () =>
        {
            var matcher = Matcher(("s1", ";em"));
            var match = Feed(matcher, ";EM", SnippetMatcher.ModeImmediately, withinWords: false, out _);
            True(match is not null, "no match for ;EM");
        });

        // Expand within Words off: a keyword preceded by a word character must not expand.
        Run("withinWords off blocks a keyword inside a word", () =>
        {
            var matcher = Matcher(("s1", ";em"));
            Null(Feed(matcher, "a;em", SnippetMatcher.ModeImmediately, withinWords: false, out _), "a;em must not match");
            True(Feed(matcher, "a;em", SnippetMatcher.ModeImmediately, withinWords: true, out _) is not null, "a;em must match with withinWords on");
            True(Feed(matcher, " ;em", SnippetMatcher.ModeImmediately, withinWords: false, out _) is not null, "space-delimited keyword must match");
        });

        Run("an unobservable left edge blocks a withinWords-off match", () =>
        {
            var matcher = Matcher(("s1", ";em"));
            // The keyword reaches the buffer's rotated edge, so the boundary is unknown.
            var longPrefix = new string('x', 64);
            Null(Feed(matcher, $"{longPrefix};em", SnippetMatcher.ModeImmediately, withinWords: false, out _), "rotated edge must not match");
        });

        // Longest keyword wins: '@@p' beats '@@' when both complete.
        Run("the longest keyword wins over its prefix", () =>
        {
            var matcher = Matcher(("email", "@@"), ("partner", "@@p"));
            var match = Feed(matcher, "@@p", SnippetMatcher.ModeImmediately, withinWords: false, out _);
            True(match is not null, "no match");
            Equal("partner", match!.SnippetId, "snippet id");
        });

        // After Delimiter: a bare keyword never fires; keyword + delimiter does, for both variants.
        Run("after-delimiter modes wait for a delimiter", () =>
        {
            var matcher = Matcher(("s1", ";em"));
            Null(Feed(matcher, ";em", SnippetMatcher.ModeDelimiterKeep, withinWords: false, out _), "bare keyword must not fire");
            var kept = Feed(matcher, ";em ", SnippetMatcher.ModeDelimiterKeep, withinWords: false, out _);
            True(kept is not null && kept.DelimiterTyped, "keyword + space must fire (keeping)");
            var discarded = Feed(matcher, ";em\r", SnippetMatcher.ModeDelimiterDiscard, withinWords: false, out _);
            True(discarded is not null && discarded.DelimiterTyped, "keyword + enter must fire (discarding)");
            Null(Feed(matcher, ";em ", SnippetMatcher.ModeImmediately, withinWords: false, out _), "immediately mode must not fire behind a delimiter");
        });

        // The injection plan: backspace counts and the cursor split.
        Run("backspace counts follow the mode and the delimiter", () =>
        {
            Equal(3, SnippetMatcher.BackspaceCount(3, delimiterTyped: false, discardDelimiter: false), "immediately");
            Equal(3, SnippetMatcher.BackspaceCount(3, delimiterTyped: true, discardDelimiter: false), "keeping");
            Equal(4, SnippetMatcher.BackspaceCount(3, delimiterTyped: true, discardDelimiter: true), "discarding");
        });

        Run("cursor split walks the caret between the two parts", () =>
        {
            // The resolver already removed the `{cursor}` placeholder; the index points into the
            // resolved text ("beforeafter"), not the raw markup.
            var (head, tail) = SnippetMatcher.SplitAtCursor("beforeafter", 6);
            Equal("before", head, "head");
            Equal("after", tail, "tail");
            Equal(5, SnippetMatcher.CaretReturnCount(tail), "caret return count");
            var (whole, empty) = SnippetMatcher.SplitAtCursor("no cursor", null);
            Equal("no cursor", whole, "no cursor head");
            Equal(string.Empty, empty, "no cursor tail");
        });

        // A backspace in the buffer removes the last typed character, like the target app's text.
        Run("a backspace pops the buffer and kills the pending match", () =>
        {
            var matcher = Matcher(("s1", ";em"));
            var buffer = new List<char> { ';', 'e', 'm' };
            True(matcher.TryMatch(buffer, false, SnippetMatcher.ModeImmediately, false) is not null, "should match");
            buffer.RemoveAt(buffer.Count - 1);
            Null(matcher.TryMatch(buffer, false, SnippetMatcher.ModeImmediately, false), "must not match after backspace");
            buffer.Add('m');
            True(matcher.TryMatch(buffer, false, SnippetMatcher.ModeImmediately, false) is not null, "should match again");
        });

        Console.WriteLine();
        Console.WriteLine($"{_count - _failures}/{_count} checks passed");
        return _failures == 0 ? 0 : 1;
    }

    private static void False2(bool value, string context)
    {
        if (value) throw new Exception(context);
    }
}

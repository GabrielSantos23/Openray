// Pure decision logic for snippet auto-expansion — no Win32, no I/O, so the test harness can drive
// it with a fake keystroke stream.
//
// Raycast's matching rules live in native Rust (`native.dll` exports REGISTER_SNIPPETS /
// EXPAND_SNIPPET) and the shipped artifacts only confirm the event names (`on_snippet_matched`,
// `on_snippet_match_cancelled`) and the documented settings semantics ("with Expand within Words
// off, a Snippet will only get expanded if the keyword is a single word"). The concrete rules here
// are the clone's documented decisions: case-insensitive exact keyword match at the end of the
// typed stream, word-boundary check on the left when `withinWords` is off, and delimiter modes that
// wait for Space/Enter/Tab and keep or drop it.

using System;
using System.Collections.Generic;
using System.Linq;

namespace RaycastMini.Launcher;

public sealed class SnippetMatcher
{
    public sealed record Keyword(string SnippetId, string Text);

    /// <summary>A keyword match at the end of the typed stream.</summary>
    public sealed record Match(string SnippetId, string Keyword, int MatchLength, bool DelimiterTyped);

    public const string ModeImmediately = "immediately";
    public const string ModeDelimiterKeep = "after-delimiter-keeping";
    public const string ModeDelimiterDiscard = "after-delimiter-discarding";

    public const char DelimiterEnter = '\r';
    public const char DelimiterTab = '\t';
    public const char DelimiterSpace = ' ';

    public static readonly IReadOnlyCollection<char> Delimiters = new[] { DelimiterEnter, DelimiterTab, DelimiterSpace };

    private readonly List<Keyword> _keywords;

    public SnippetMatcher(IEnumerable<Keyword> keywords)
    {
        // Longest first so '@@p' wins over '@@' when both match the same stream.
        _keywords = keywords
            .Where(keyword => !string.IsNullOrEmpty(keyword.Text))
            .OrderByDescending(keyword => keyword.Text.Length)
            .ToList();
    }

    public int MaxKeywordLength => _keywords.Count == 0 ? 0 : _keywords[0].Text.Length;

    /// <summary>The registered keywords, longest first (used to rebuild the matcher without reflection).</summary>
    public IReadOnlyList<Keyword> Keywords => _keywords;

    /// <summary>
    /// Scans the typed buffer for a keyword match at its end. `leftEdgeUnknown` is true when the
    /// buffer was rotated or trimmed and the character before the first buffered char is not
    /// observable — with `withinWords` off, a match whose keyword reaches that edge is skipped
    /// rather than guessed.
    /// </summary>
    public Match? TryMatch(IReadOnlyList<char> buffer, bool leftEdgeUnknown, string mode, bool withinWords)
    {
        if (buffer.Count == 0) return null;
        var delimiterTyped = buffer.Count > 0 && Delimiters.Contains(buffer[buffer.Count - 1]);
        foreach (var keyword in _keywords)
        {
            var text = keyword.Text;
            var withDelimiter = delimiterTyped && buffer.Count >= text.Length + 1
                && EndsWith(buffer, text, buffer.Count - 1);
            var withoutDelimiter = buffer.Count >= text.Length && EndsWith(buffer, text, buffer.Count);
            if (!withDelimiter && !withoutDelimiter) continue;

            // Delimiter modes wait for the delimiter; "keyword + delimiter" is the firing state,
            // a bare keyword only arms. Immediately mode fires on the bare keyword only.
            if (mode == ModeImmediately && withDelimiter) continue;
            if (mode != ModeImmediately && !delimiterTyped) continue;

            var keywordStart = buffer.Count - text.Length - (withDelimiter ? 1 : 0);
            if (!withinWords && keywordStart > 0)
            {
                var before = buffer[keywordStart - 1];
                if (char.IsLetterOrDigit(before) || before == '_') continue;
            }
            if (!withinWords && keywordStart == 0 && leftEdgeUnknown) continue;

            return new Match(keyword.SnippetId, text, text.Length, withDelimiter);
        }
        return null;
    }

    private static bool EndsWith(IReadOnlyList<char> buffer, string text, int end)
    {
        if (end < text.Length) return false;
        for (var i = 0; i < text.Length; i++)
        {
            if (char.ToLowerInvariant(buffer[end - text.Length + i]) != char.ToLowerInvariant(text[i])) return false;
        }
        return true;
    }

    /// <summary>
    /// The keyword is erased from the target app before the resolved text is injected; a discarded
    /// delimiter adds one more backspace.
    /// </summary>
    public static int BackspaceCount(int matchLength, bool delimiterTyped, bool discardDelimiter) =>
        matchLength + (delimiterTyped && discardDelimiter ? 1 : 0);

    /// <summary>
    /// `{cursor}` splits the resolved text: type the head, then the tail, then move the caret back
    /// over the tail so it lands between the two parts.
    /// </summary>
    public static (string Head, string Tail) SplitAtCursor(string text, int? cursor)
    {
        if (cursor is null || cursor < 0 || cursor > text.Length) return (text, string.Empty);
        return (text[..cursor.Value], text[cursor.Value..]);
    }

    /// <summary>How many ArrowLeft events it takes to walk the caret back over the tail.</summary>
    public static int CaretReturnCount(string tail) => tail.Length;
}

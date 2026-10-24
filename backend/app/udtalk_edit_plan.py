"""Distribute an assembled caption edit over existing native UD Talk records."""

from bisect import bisect_right
from collections.abc import Sequence
from copy import deepcopy
from difflib import SequenceMatcher

from pydantic import JsonValue


def plan_fragment_edits(fragments: Sequence[dict[str, JsonValue]], text: str) -> list[dict[str, JsonValue]]:
    """Return changed records in input order, retaining every native identifier.

    The caller supplies active fragments in their native order. Equal runs stay
    with their original fragment; a replacement belongs to its first affected
    fragment, and an insertion at a boundary belongs to the preceding fragment.
    Concatenating all resulting record texts reproduces ``text`` exactly.
    Locking, sender identity, edit counts and transmission belong to the caller.
    """
    if not fragments:
        raise ValueError("Cannot plan an edit without a native fragment")
    original: list[str] = []
    ends: list[int] = []
    length = 0
    for fragment in fragments:
        identifier, value = fragment.get("utteranceIdentifier"), fragment.get("text", "")
        if not isinstance(identifier, str) or not identifier or not isinstance(value, str):
            raise ValueError("Native fragment identity or text is invalid")
        original.append(value)
        length += len(value)
        ends.append(length)

    before = "".join(original)
    if before == text:
        return []
    pieces: list[list[str]] = [[] for _ in fragments]
    for operation, start, stop, new_start, new_stop in SequenceMatcher(None, before, text, autojunk=False).get_opcodes():
        if operation == "equal":
            position = start
            while position < stop:
                owner = bisect_right(ends, position)
                end = min(stop, ends[owner])
                pieces[owner].append(before[position:end])
                position = end
        elif operation in ("insert", "replace"):
            position = start - 1 if operation == "insert" and start else start
            owner = bisect_right(ends, position) if before else 0
            pieces[owner].append(text[new_start:new_stop])

    edits: list[dict[str, JsonValue]] = []
    for fragment, prior_text, parts in zip(fragments, original, pieces, strict=True):
        replacement = "".join(parts)
        if replacement == prior_text:
            continue
        command = deepcopy(fragment)
        command["text"] = replacement
        if not isinstance(command.get("originalText"), str) or not command["originalText"]:
            command["originalText"] = prior_text
        command["extendResult"] = None
        edits.append(command)
    return edits

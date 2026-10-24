from copy import deepcopy

from app.udtalk_edit_plan import plan_fragment_edits


def fragment(identifier, text, **metadata):
    return {
        "utteranceIdentifier": identifier, "text": text, "phase": "finalized",
        "endOfUtterance": True, "uniqueIdentifier": "speaker", "timestamp": 1.0,
        "connected": {"timestamp": 1.0, "name": "試験の話者"}, "localeIdentifier": "ja-JP",
        "extendResult": {"reading": "変更前の読み"}, **metadata,
    }


def edited_text(fragments, edits):
    changed = {edit["utteranceIdentifier"]: edit["text"] for edit in edits}
    return "".join(changed.get(item["utteranceIdentifier"], item["text"]) for item in fragments)


def test_synthetic_speech_correction_keeps_the_native_fragment_identifiers_and_metadata():
    fragments = [
        fragment("speech:0", "これは合成音声の接続試験です。\n参加者は13人です。\n予約は取り消しません",
                 originalText="保存された認識原文"),
        fragment("speech:01", "。\n"),
    ]
    previous = deepcopy(fragments)
    text = "合成音声から届いた字幕を訂正しました。参加者は13人です。予約は取り消しません。"

    edits = plan_fragment_edits(fragments, text)

    assert edited_text(fragments, edits) == text
    assert [edit["utteranceIdentifier"] for edit in edits] == ["speech:0", "speech:01"]
    assert edits[0]["originalText"] == "保存された認識原文"
    assert edits[1]["originalText"] == "。\n"
    for edit, original in zip(edits, fragments, strict=True):
        assert edit["uniqueIdentifier"] == original["uniqueIdentifier"]
        assert edit["timestamp"] == original["timestamp"]
        assert edit["localeIdentifier"] == original["localeIdentifier"]
        assert edit["connected"] == original["connected"]
        assert edit["extendResult"] is None
    assert fragments == previous


def test_a_single_suffixed_fragment_is_never_replaced_with_its_aggregate_identifier():
    fragments = [fragment("speech:000", "変更前です。")]

    edits = plan_fragment_edits(fragments, "変更後です。")

    assert len(edits) == 1
    assert edits[0]["utteranceIdentifier"] == "speech:000"
    assert edits[0]["text"] == "変更後です。"
    assert edits[0]["originalText"] == "変更前です。"


def test_removing_a_line_break_does_not_rewrite_the_unchanged_following_fragment():
    fragments = [fragment("speech:0", "前半\n"), fragment("speech:1", "後半")]

    edits = plan_fragment_edits(fragments, "前半後半")

    assert edited_text(fragments, edits) == "前半後半"
    assert len(edits) == 1 and edits[0]["utteranceIdentifier"] == "speech:0"
    assert plan_fragment_edits(fragments, "前半\n後半") == []


def test_replacement_across_all_fragments_clears_text_without_removing_native_records():
    fragments = [fragment("speech:0", "abc"), fragment("speech:1", "def"), fragment("speech:2", "ghi")]

    edits = plan_fragment_edits(fragments, "置き換えた全文。")

    assert edited_text(fragments, edits) == "置き換えた全文。"
    assert [edit["utteranceIdentifier"] for edit in edits] == ["speech:0", "speech:1", "speech:2"]
    assert edits[0]["text"] == "置き換えた全文。"
    assert edits[1]["text"] == edits[2]["text"] == ""
    assert all(edit["phase"] == "finalized" for edit in edits)

from app.models import SourceEvent
from app.transcription.apple import AppleTranscripts


def test_replaced_ranges_are_withdrawn_and_finalization_promotes_unchanged_text():
    transcripts = AppleTranscripts("local")
    first = transcripts.receive({"start": 0.0, "end": 2.0, "text": "途中の文", "is_final": False, "finalized_through": 0.0})
    replacement = transcripts.receive({"start": 0.5, "end": 3.0, "text": "更新した文", "is_final": False, "finalized_through": 0.0})
    assert len(first) == 1 and not first[0].is_final
    assert replacement[0].utterance_id == first[0].utterance_id and replacement[0].removed
    assert replacement[1].text == "更新した文" and not replacement[1].is_final
    final = transcripts.receive({"start": 3.0, "end": 4.0, "text": "次の文", "is_final": False, "finalized_through": 3.0})
    assert final[0].utterance_id == replacement[1].utterance_id and final[0].is_final
    assert final[0].text == "更新した文"
    assert all(isinstance(event, SourceEvent) for event in final)


def test_a_growing_utterance_keeps_its_identity_and_uses_the_final_text():
    transcripts = AppleTranscripts("growing")
    first = transcripts.receive({"start": 0.0, "end": 2.0, "text": "途中", "is_final": False, "finalized_through": 0.0})
    last = transcripts.receive({"start": 0.0, "end": 3.0, "text": "最後の全文", "is_final": True, "finalized_through": 3.0})
    assert len(last) == 1 and last[0].utterance_id == first[0].utterance_id
    assert last[0].is_final and last[0].text == "最後の全文" and not last[0].removed


def test_merged_pending_ranges_withdraw_the_old_second_row_before_finalizing():
    transcripts = AppleTranscripts("merged")
    first = transcripts.receive({"start": 0.0, "end": 1.0, "text": "前半", "is_final": False, "finalized_through": 0.0})
    second = transcripts.receive({"start": 1.0, "end": 2.0, "text": "後半", "is_final": False, "finalized_through": 0.0})
    merged = transcripts.receive({"start": 0.0, "end": 2.0, "text": "前半と後半", "is_final": True, "finalized_through": 2.0})
    assert merged[0].utterance_id == second[0].utterance_id and merged[0].removed
    assert merged[-1].utterance_id == first[0].utterance_id and merged[-1].is_final
    assert merged[-1].text == "前半と後半"

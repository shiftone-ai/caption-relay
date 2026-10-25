"""Coordinates reception, AI work and explicit human saves across both modes."""

import asyncio
from collections.abc import Mapping

import httpx2 as httpx

from .ai_provider import AiFailure, AiProvider, AiUnavailable
from .connections import Connections
from .dictionary import WordDictionary
from .models import AiCorrectionContext, Caption, CaptionPatch, ConnectionSettings, ConnectionStatus, DictionarySnapshot, FormattedResult, SourceEvent, SourceIgnored
from .relay import CaptionRelay, RevisionConflict
from .udtalk_editor import EditorError
from .transcription.openai import Connector, openai_connect


class CaptionWorkflow:
    def __init__(self, relay: CaptionRelay, web_url: str | None, environment: Mapping[str, str],
                 ai_transport: httpx.AsyncBaseTransport | None = None,
                 editor_transport: httpx.AsyncBaseTransport | None = None, audio_connector: Connector = openai_connect,
                 dictionary: WordDictionary | None = None) -> None:
        self.relay = relay
        self.dictionary = dictionary if dictionary is not None else WordDictionary()
        self.connections = Connections(self.source_event, web_url, editor_transport, environment, audio_connector,
                                       keywords=self.dictionary.keywords)
        self.provider = AiProvider(environment, ai_transport)
        self.relay.ai_availability(self.provider.available)
        self._tasks: dict[str, asyncio.Task[None]] = {}
        self._slots = asyncio.Semaphore(2)
        self._generation = 0
        self._ai_paused = 0

    def start(self) -> None:
        self.connections.start()

    async def stop(self) -> None:
        self._ai_paused += 1
        try:
            await self._cancel_ai()
            await self.connections.stop()
        finally:
            self._ai_paused -= 1

    async def reset_captions(self) -> None:
        self._ai_paused += 1
        try:
            async def reset() -> None:
                await self._cancel_ai()
                self.relay.reset_captions()
            await self.connections.reset_captions(reset)
        finally:
            self._ai_paused -= 1

    async def _cancel_ai(self) -> None:
        self._generation += 1
        self._ai_paused += 1
        tasks = dict(self._tasks)
        try:
            for caption_id, task in tasks.items():
                task.cancel()
                caption = self.relay.caption(caption_id)
                if caption.ai_request is not None:
                    self.relay.ai_status(caption_id, caption.ai_request.id, "failed", "接続が終了したため、AIの訂正を停止しました。")
            await asyncio.gather(*tasks.values(), return_exceptions=True)
        finally:
            for caption_id, task in tasks.items():
                if self._tasks.get(caption_id) is task:
                    self._tasks.pop(caption_id)
            self._ai_paused -= 1

    async def configure(self, settings: ConnectionSettings) -> ConnectionStatus:
        self._ai_paused += 1
        try:
            generation = self._generation
            result = await self.connections.configure(settings, self._cancel_ai)
            self.relay.connection_mode(settings.mode, reset_context=generation != self._generation)
            return result
        finally:
            self._ai_paused -= 1

    def source_event(self, event: SourceEvent, remote_edit: bool = False) -> Caption | SourceIgnored:
        result = self.relay.source_event(event, remote_edit=remote_edit)
        if not isinstance(result, Caption):
            return result
        pending = self._tasks.get(result.id)
        # A save's own poll can receive an update. Let its validation fail and
        # release the lock rather than cancelling itself before cleanup awaits.
        if pending is not None and pending is not asyncio.current_task():
            self._tasks.pop(result.id)
            pending.cancel()
        if result.ai_request is not None:
            if self._ai_paused:
                self.relay.ai_status(result.id, result.ai_request.id, "failed", "接続の切り替えまたは終了中のため、AIの訂正を停止しました。")
            elif result.ai_request.model_id not in self.provider.available:
                self.relay.ai_status(result.id, result.ai_request.id, "unavailable", "選択したAIのAPIキーが設定されていません。")
            elif len(self._tasks) >= 64:
                self.relay.ai_status(result.id, result.ai_request.id, "failed", "AIの処理待ちが多いため、原文を保持しています。")
            else:
                self._tasks[result.id] = asyncio.create_task(self._correct(
                    result, self._generation, self.dictionary.snapshot(), self.relay.ai_context(result.id)))
        return self.relay.caption(result.id)

    async def _correct(self, caption: Caption, generation: int, dictionary: DictionarySnapshot,
                       context: AiCorrectionContext) -> None:
        plan = caption.ai_request
        assert plan is not None
        try:
            async with self._slots:
                self.relay.ai_status(caption.id, plan.id, "running")
                result = await self.provider.correct(plan, caption.original, dictionary, context)
                if generation == self._generation:
                    await self.formatted_result(caption.id, result)
        except (AiFailure, AiUnavailable, EditorError, RevisionConflict) as error:
            self.relay.ai_status(caption.id, plan.id, "failed", str(error) if not isinstance(error, RevisionConflict)
                                 else "原文が更新されたため、AIの訂正を送りませんでした。")
        finally:
            if self._tasks.get(caption.id) is asyncio.current_task():
                self._tasks.pop(caption.id, None)

    async def patch_caption(self, caption_id: str, patch: CaptionPatch) -> Caption:
        before = self.relay.validate_patch(caption_id, patch)
        # Always protect the original version across the network await, including old clients.
        guarded = patch.model_copy(update={"base_source_revision": before.source_revision})
        def validate() -> None:
            self.relay.validate_patch(caption_id, guarded)
        await self.connections.write(caption_id, patch.text, validate)
        return self.relay.patch_caption(caption_id, guarded)

    async def formatted_result(self, caption_id: str, result: FormattedResult) -> Caption | SourceIgnored:
        def valid() -> None:
            latest = self.relay.caption(caption_id)
            if latest.source_revision != result.source_revision or (result.ai is not None and (
                latest.ai_request is None or latest.ai_request.id != result.ai.request_id
                or latest.ai_request.model_id != result.ai.model_id
            )):
                raise RevisionConflict(latest)
            if latest.human_edited:
                raise RevisionConflict(latest)

        current = self.relay.caption(caption_id)
        if current.source_revision != result.source_revision:
            return SourceIgnored(status="stale")
        if result.ai is not None:
            planned = current.ai_request
            if planned is None or planned.id != result.ai.request_id or planned.model_id != result.ai.model_id:
                return SourceIgnored(status="stale")
            if current.ai_result is not None:
                return SourceIgnored(status="duplicate")
        if not current.human_edited:
            try:
                await self.connections.write(caption_id, result.text, valid)
            except RevisionConflict:
                return SourceIgnored(status="stale")
        return self.relay.formatted_result(caption_id, result)

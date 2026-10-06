import asyncio
import json

import httpx2 as httpx
import pytest

from app.relay import CaptionRelay
from app.udtalk_web import UdtalkWebInput

URL = "https://live.udtalk.jp/" + "a" * 64


class ViewerServer:
    def __init__(self, *, protected=False, malformed=False, transient=False):
        self.protected = protected
        self.malformed = malformed
        self.transient = transient
        self.polls = []
        self.departed = False

    def handle(self, request):
        if request.method == "GET":
            return httpx.Response(200, text='<udtalk v-bind:token-txt="{&quot;hash&quot;:&quot;private-token&quot;}"></udtalk>')
        body = json.loads(request.content)
        route = request.url.path.split("/")[-2]
        if route == "checkAuth":
            assert body == {"t": "a" * 64}
            return httpx.Response(200, json={"status": 1, "requires": self.protected})
        if route == "initialize":
            assert body["t"] == "private-token"
            return httpx.Response(200, json={"status": 1, "userid": 123})
        if route == "webTalk":
            return httpx.Response(200, json={"status": 1, "key": "private-key"})
        if route == "webTalkCurrent":
            return httpx.Response(200, json={"status": 1, "number": 10, "current": 20})
        if route == "webTalkMessage":
            self.polls.append(body)
            if self.transient and len(self.polls) == 1:
                return httpx.Response(504)
            if self.malformed:
                return httpx.Response(200, json={"status": 1, "current": 21, "number": 11,
                    "messages": [[{"meta": '{"text":"private secret"}'}]]})
            meta = {"utteranceIdentifier": "speech:00", "phase": "finalized", "type": 0,
                "text": "認識結果", "endOfUtterance": True, "connected": {"timestamp": 1.0}}
            return httpx.Response(200, json={"status": 1, "current": 21, "number": 11,
                "messages": [[{"meta": json.dumps(meta)}]]})
        if route == "awayWebTalk":
            self.departed = True
        return httpx.Response(200, json={"status": 1})


async def until(predicate):
    async with asyncio.timeout(4):
        while not predicate():
            await asyncio.sleep(0.01)


def test_web_reader_preserves_cursor_across_transient_failure_and_replay():
    async def verify():
        relay = CaptionRelay()
        server = ViewerServer(transient=True)
        source = UdtalkWebInput(URL, relay.source_event, httpx.MockTransport(server.handle))
        source.start()
        try:
            await until(lambda: len(server.polls) >= 3)
            assert server.polls[0] == server.polls[1]
            assert server.polls[2]["l"] == 11 and server.polls[2]["c"] == 21
            assert source.status.state == "live"
            assert source.status.received_events == 1
            assert relay.public_snapshot().captions[0].text == "認識結果"
            assert "private" not in source.status.model_dump_json()
        finally:
            await source.stop()
        assert server.departed
    asyncio.run(verify())


def test_protected_talk_stops_without_attempting_login():
    async def verify():
        server = ViewerServer(protected=True)
        source = UdtalkWebInput(URL, CaptionRelay().source_event, httpx.MockTransport(server.handle))
        source.start()
        await until(lambda: source.status.state == "failed")
        await source.stop()
        assert server.polls == []
    asyncio.run(verify())


def test_transient_initialization_failure_resumes_the_same_reader():
    async def verify():
        server = ViewerServer()
        initializations = 0
        key_requests = 0

        def handle(request):
            nonlocal initializations, key_requests
            route = request.url.path.split("/")[-2]
            if route == "initialize":
                initializations += 1
            if route == "webTalk":
                key_requests += 1
                if key_requests == 1:
                    return httpx.Response(503)
            return server.handle(request)

        source = UdtalkWebInput(URL, CaptionRelay().source_event, httpx.MockTransport(handle))
        source.start()
        try:
            await until(lambda: source.status.state == "live")
            assert initializations == 1
            assert key_requests == 2
        finally:
            await source.stop()
        assert server.departed
    asyncio.run(verify())


def test_invalid_messages_stop_without_leaking_body(caplog):
    async def verify():
        relay = CaptionRelay()
        server = ViewerServer(malformed=True)
        source = UdtalkWebInput(URL, relay.source_event, httpx.MockTransport(server.handle))
        source.start()
        await until(lambda: source.status.state == "failed")
        await source.stop()
        assert relay.captions() == []
        assert server.departed
        assert "private secret" not in caplog.text
        assert "private-key" not in caplog.text
        assert URL not in caplog.text
    asyncio.run(verify())


@pytest.mark.parametrize("url", [
    "http://live.udtalk.jp/" + "a" * 64,
    "https://example.com/" + "a" * 64,
    URL + "?secret=1", URL + "/", "https://user:pass@live.udtalk.jp/" + "a" * 64,
])
def test_only_exact_official_viewer_link_is_accepted(url):
    with pytest.raises(ValueError, match="official Web viewing link"):
        UdtalkWebInput(url, CaptionRelay().source_event).start()

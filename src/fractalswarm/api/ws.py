"""The event stream: ``WS /api/runs/{id}/events?from_seq=&speed=&pace=``.

- A finished run (its log ends with ``run.completed``) is replayed at its recorded pace:
  events sharing a virtual timestamp go out as one batch, and the gap to the next batch is
  ``Δts_virtual / speed`` (speed 1–20, idle gaps capped at ``MAX_GAP_S``). ``pace=none``
  sends everything at once.
- A running run is tailed: the backlog goes out at once, then new rows of its SQLite log are
  polled every ``POLL_S`` until ``run.completed`` appears.

Messages are JSON: ``{"kind": "hello", "run": ...}``, ``{"kind": "events", "events": [...]}``,
and finally ``{"kind": "end", "last_seq": N}``.
"""

import asyncio
from itertools import groupby
from typing import Any

import anyio
from starlette.websockets import WebSocket, WebSocketDisconnect

from fractalswarm.api.catalog import Catalog

MIN_SPEED, MAX_SPEED = 1.0, 20.0
MAX_GAP_S = 2.0
POLL_S = 0.25
TAIL_BATCH = 500


async def stream_events(ws: WebSocket, catalog: Catalog) -> None:
    await ws.accept()
    try:
        try:
            entry = catalog.get(ws.path_params["run_id"])
            from_seq = max(int(ws.query_params.get("from_seq", "1")), 1)
            speed = float(ws.query_params.get("speed", "1"))
        except (KeyError, ValueError):
            await ws.send_json({"kind": "error", "error": "unknown run or bad query"})
            await ws.close(code=1008)
            return
        speed = min(max(speed, MIN_SPEED), MAX_SPEED)
        paced = ws.query_params.get("pace", "replay") != "none"

        # Reads of the log leave the event loop: a whole log takes the best part of a second.
        last = await anyio.to_thread.run_sync(catalog.last, entry)
        listing = await anyio.to_thread.run_sync(catalog.listing, entry)
        await ws.send_json({"kind": "hello", "run": listing, "speed": speed})
        if last is not None and last["type"] == "run.completed":
            events = await anyio.to_thread.run_sync(catalog.read, entry, from_seq)
            sent = await _replay(ws, events, speed, paced)
        else:
            sent = await _tail(ws, catalog, entry, from_seq)
        await ws.send_json({"kind": "end", "last_seq": sent})
        await ws.close()
    except WebSocketDisconnect:
        return


async def _replay(ws: WebSocket, events: list[dict[str, Any]], speed: float, paced: bool) -> int:
    last_seq, previous_ts = 0, None
    for ts, batch in groupby(events, key=lambda event: event["ts_virtual"]):
        if paced and previous_ts is not None:
            await asyncio.sleep(min((ts - previous_ts) / 1000 / speed, MAX_GAP_S))
        batch = list(batch)
        await ws.send_json({"kind": "events", "events": batch})
        last_seq, previous_ts = batch[-1]["seq"], ts
    return last_seq


async def _tail(ws: WebSocket, catalog: Catalog, entry, from_seq: int) -> int:
    next_seq, last_seq = from_seq, from_seq - 1
    while True:
        batch = await anyio.to_thread.run_sync(catalog.read, entry, next_seq, TAIL_BATCH)
        if batch:
            await ws.send_json({"kind": "events", "events": batch})
            last_seq = batch[-1]["seq"]
            next_seq = last_seq + 1
            if batch[-1]["type"] == "run.completed":
                return last_seq
            if len(batch) == TAIL_BATCH:
                continue
        await _wait_or_disconnect(ws, POLL_S)


async def _wait_or_disconnect(ws: WebSocket, seconds: float) -> None:
    """Sleep, but notice a client that went away (so an idle tail does not poll forever)."""
    try:
        message = await asyncio.wait_for(ws.receive(), seconds)
    except TimeoutError:
        return
    if message["type"] == "websocket.disconnect":
        raise WebSocketDisconnect(message.get("code", 1000))

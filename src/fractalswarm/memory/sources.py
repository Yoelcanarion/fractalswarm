"""What the run may fetch and what it has read on the web, rebuilt from the log (spec §11, §13).

A reducer, so every actor reads the same answer and an heir after a takeover (or a replay)
rebuilds it from the events alone:
- provenance: the URLs of the task (``run.started``, ``corpus.sources``) and the hits of every
  search that passed the firewall (``web.hits``). A URL outside it is never fetched;
- pages: the text of every fetched page that passed the firewall (``web.page``), which is the
  evidence a citation is checked against.
"""

from typing import Any

from fractalswarm.kernel.events import Event
from fractalswarm.safety.fetch_policy import Provenance, normalize_url


class SourcesView:
    name = "sources"

    def __init__(self) -> None:
        self.provenance = Provenance()
        self.pages: dict[str, str] = {}  # normalized URL -> the text the agent saw

    def admit(self, actor: str, event_type: str, payload: dict[str, Any]) -> None:
        return None

    def apply(self, event: Event) -> None:
        payload = event.payload
        if event.type == "run.started":
            corpus = (payload.get("params") or {}).get("corpus") or {}
            self.provenance.add_all(corpus.get("sources") or [], "task")
        elif event.type == "web.hits":
            self.provenance.add_all(payload["urls"], payload["source"])
        elif event.type == "web.page":
            for url in (payload["url"], payload["final_url"]):
                self.pages[_key(url)] = payload["text"]

    def source_of(self, url: str) -> str | None:
        return self.provenance.source_of(url)

    def page(self, url: str) -> str | None:
        return self.pages.get(_key(url))


def _key(url: str) -> str:
    try:
        return normalize_url(url)
    except ValueError:
        return url

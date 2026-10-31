"""A real run that cannot have PromptGuard 2 says what screens its inputs instead."""

from types import SimpleNamespace

import pytest

from fractalswarm import cli
from fractalswarm.safety import firewall
from fractalswarm.safety.firewall import HeuristicBackend

SETTINGS = SimpleNamespace(hf_token=None)


def test_auto_says_so_when_only_the_patterns_are_there(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
):
    monkeypatch.setattr(firewall, "default_backend", lambda token: HeuristicBackend())
    assert cli.pick_scanner("auto", SETTINGS).backend.name == "heuristic"
    said = capsys.readouterr()
    assert "a pattern scanner screens the inputs" in said.err
    assert said.out == ""  # the lines a script reads stay as they are


def test_auto_is_silent_with_promptguard(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
):
    guard = SimpleNamespace(name="promptguard2-22m")
    monkeypatch.setattr(firewall, "default_backend", lambda token: guard)
    assert cli.pick_scanner("auto", SETTINGS).backend is guard
    assert capsys.readouterr().err == ""


def test_asking_for_the_patterns_is_silent(capsys: pytest.CaptureFixture[str]):
    assert cli.pick_scanner("heuristic", SETTINGS).backend.name == "heuristic"
    assert capsys.readouterr().err == ""

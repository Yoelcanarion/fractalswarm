"""Intake: a person pastes the talks and notes of a real conference, and Muse reads them into
the input of a program run (the arena's "live input").

- ``actor.py``: the ``intake`` scenario. It scans the pasted text, makes one LLM call and logs
  ``intake.proposed``. It is a run like any other, so it is logged and replayable.
- ``schema.py``: what the model returns (``t2_intake``), and ``shape.py`` fits that into the
  one shape T2 runs on (3 tracks, 8-15 talks, 2 days, the generator's slot grid).
- ``pseudonym.py``, ``truth.py``, ``store.py``: email pseudonyms, the approved input in the
  checker's truth schema, and the private directory they live in.
- ``fake.py``: the $0 path, which reads the generator's wording with the bench's parsers.

Nothing a person types goes into git: it lives in ``FRACTALSWARM_PRIVATE_DIR``.
"""

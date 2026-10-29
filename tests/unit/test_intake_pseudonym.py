"""Pseudonyms: an email address a person typed never reaches a log or a model."""

from fractalswarm.intake.pseudonym import DOMAIN, Pseudonyms


def test_every_address_is_replaced_and_the_same_address_gets_the_same_alias() -> None:
    p = Pseudonyms()
    text = "Ana <Ana.Ruiz@Example.org> wrote to bob@x.io; ana.ruiz@example.org again."
    masked = p.mask(text)
    assert "example.org" not in masked.lower() and "x.io" not in masked
    assert masked == (
        f"Ana <person-01@{DOMAIN}> wrote to person-02@{DOMAIN}; person-01@{DOMAIN} again."
    )


def test_masking_twice_changes_nothing_and_numbering_follows_the_text() -> None:
    first = Pseudonyms()
    masked = first.mask("z@a.com then y@b.com")
    assert Pseudonyms().mask(masked) == masked
    assert masked.startswith(f"person-01@{DOMAIN} then person-02@{DOMAIN}")


def test_masking_walks_nested_values_and_leaves_the_rest() -> None:
    p = Pseudonyms()
    value = {"a": ["mail me: me@home.org", 3, None], "b": {"c": "no address", "d": 1.5}}
    assert p.mask_value(value) == {
        "a": [f"mail me: person-01@{DOMAIN}", 3, None],
        "b": {"c": "no address", "d": 1.5},
    }


def test_the_mapping_goes_back_to_the_real_address_and_can_be_resumed() -> None:
    p = Pseudonyms()
    p.mask("one@a.org two@b.org")
    mapping = p.mapping()["emails"]
    assert mapping == {f"person-01@{DOMAIN}": "one@a.org", f"person-02@{DOMAIN}": "two@b.org"}
    resumed = Pseudonyms({real: alias for alias, real in mapping.items()})
    assert resumed.mask("two@b.org and new@c.org") == (f"person-02@{DOMAIN} and person-03@{DOMAIN}")


def test_names_are_replaced_as_whole_words_longest_first() -> None:
    p = Pseudonyms()
    value = {"body": "Hi, ana ruiz here. Ana Ruiz-Smith is not me; Ana neither.", "list": ["Ana"]}
    masked = p.mask_names(value, ["Ana", "Ana Ruiz"])
    assert masked["body"] == "Hi, Speaker 01 here. Speaker 01-Smith is not me; Speaker 02 neither."
    assert masked["list"] == ["Speaker 02"]
    assert p.mapping()["names"] == {"Speaker 01": "Ana Ruiz", "Speaker 02": "Ana"}

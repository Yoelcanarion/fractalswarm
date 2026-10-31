import { Fragment } from "react";

import { Tooltip } from "../components/ui";
import { AvailabilityGrid } from "./AvailabilityGrid";
import { addSpeaker, addTalk, patchSpeaker, patchTalk, patchTrack, removeSpeaker, removeTalk, restoreRow, talksOf } from "./edit";
import { describeCells } from "./format";
import { BLOCK_FIELDS, FIELD_WORDS, type Fact, type Selection } from "./highlight";
import { PREFERENCES, type Preference, type Proposal, type Speaker, type Talk } from "./proposal";
import type { Backend } from "./launch";
import { ProvenanceBadge } from "./ProvenanceBadge";
import { provenanceOf, removedRows } from "./provenance";

export interface TablesProps {
  original: Proposal;
  working: Proposal;
  facts: Fact[];
  selection: Selection | null;
  onSelect: (selection: Selection | null) => void;
  onChange: (next: Proposal) => void;
  /** Approved: the reading is read-only. */
  locked: boolean;
  /** Who read the text. */
  reader: Backend | null | undefined;
}

const QUOTE_SHOWN = 240;

/** Chips for the sources of a row: one per sentence it was read from, pressed when that one is picked. A chip for a
 * sentence that is not in the pasted text says so: Muse reworded it, and the page will not mark a place it did not find. */
function SourceChips({ kind, id, facts, selection, onSelect }: { kind: "talks" | "speakers"; id: string; facts: Fact[]; selection: Selection | null; onSelect: TablesProps["onSelect"] }) {
  const mine = facts.filter((fact) => fact.kind === kind && fact.id === id);
  if (mine.length === 0) return <span className="srcchips__none">no source</span>;
  return (
    <span className="srcchips">
      {mine.map((fact) => (
        <button
          key={fact.key}
          type="button"
          className={`srcchip${fact.span === null ? " srcchip--missing" : ""}`}
          aria-pressed={selection?.kind === kind && selection.id === id && selection.field === fact.field}
          title={fact.span === null ? "Not found in the text you pasted: Muse reworded it" : "Show where this was read"}
          onClick={(event) => {
            event.stopPropagation();
            const pressed = selection?.kind === kind && selection.id === id && selection.field === fact.field;
            onSelect(pressed ? { kind, id, field: null } : { kind, id, field: fact.field });
          }}
        >
          {FIELD_WORDS[fact.field]}
          {fact.span === null ? " ?" : ""}
        </button>
      ))}
    </span>
  );
}

/** The sentences of the picked row, as Muse quoted them, and whether each is in the text. */
function Quotes({ kind, id, facts }: { kind: "talks" | "speakers"; id: string; facts: Fact[] }) {
  const mine = facts.filter((fact) => fact.kind === kind && fact.id === id);
  if (mine.length === 0) return <p className="quotes__none">Nothing was quoted for this row: it has no source in the text.</p>;
  return (
    <ul className="quotes">
      {mine.map((fact) => (
        <li key={fact.key} className={fact.span === null ? "quotes__item quotes__item--missing" : "quotes__item"}>
          <b>{FIELD_WORDS[fact.field]}</b>{" "}
          <q>{BLOCK_FIELDS.has(fact.field) && fact.quote.length > QUOTE_SHOWN ? `${fact.quote.slice(0, QUOTE_SHOWN).trimEnd()}…` : fact.quote}</q>{" "}
          <span className="quotes__where">{fact.span === null ? "not found in the text" : `in the ${fact.span.box === "talks" ? "talks" : fact.span.box === "notes" ? "notes" : "conference line"}`}</span>
        </li>
      ))}
    </ul>
  );
}

/** Muse's rows the person took out, so nothing vanishes silently, with a way back. */
function Removed<T extends { id: string }>({ rows, name, onRestore, locked }: { rows: T[]; name: (row: T) => string; onRestore: (id: string) => void; locked: boolean }) {
  if (rows.length === 0) return null;
  return (
    <p className="removed">
      Taken out of the reading:{" "}
      {rows.map((row) => (
        <span key={row.id} className="removed__item">
          <span className="mono">{row.id}</span> {name(row)}{" "}
          <button type="button" className="linkbtn" disabled={locked} onClick={() => onRestore(row.id)}>
            Put back
          </button>
        </span>
      ))}
    </p>
  );
}

function Was({ shown, fields, field }: { shown: string; fields: string[]; field: string }) {
  return fields.includes(field) ? <small className="was">Read as {shown}</small> : null;
}

const pickRow = (kind: "talks" | "speakers", id: string): Selection => ({ kind, id, field: null });

/** The id of a row's element, to bring it into view when its sentence is picked in the text. */
export const rowId = (kind: "talks" | "speakers", id: string): string => `row-${kind}-${id}`;

/** Click or focus on a row picks it, unless it is already the one: a sentence picked inside it stays picked. */
const pickIfNew = (selection: Selection | null, kind: "talks" | "speakers", id: string, onSelect: TablesProps["onSelect"]) => {
  if (!(selection?.kind === kind && selection.id === id)) onSelect(pickRow(kind, id));
};

function TalksTable({ original, working, facts, selection, onSelect, onChange, locked, reader }: TablesProps) {
  const removed = removedRows(original, working, "talks");
  const change = (id: string, patch: Partial<Omit<Talk, "id">>) => onChange(patchTalk(working, id, patch));
  return (
    <section className="rt" aria-label="Talks">
      <header className="rt__head">
        <h3 className="rt__title">
          Talks <span className="rt__count">{working.talks.length}</span>
        </h3>
        <button
          type="button"
          className="btn"
          disabled={locked}
          onClick={() => {
            const next = addTalk(working, original);
            onChange(next);
            onSelect(pickRow("talks", next.talks[next.talks.length - 1].id));
          }}
        >
          Add a talk
        </button>
      </header>
      <table className="rtable rtable--cards">
        <thead>
          <tr>
            <th scope="col">Id</th>
            <th scope="col" className="rtable__wide">
              Title
            </th>
            <th scope="col">Speaker, track</th>
            <th scope="col">Attendance</th>
            <th scope="col">Sources</th>
            <th scope="col">
              <span className="sr-only">Remove</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {working.talks.map((talk) => {
            const prov = provenanceOf(original, working, "talks", talk.id);
            const was = original.talks.find((row) => row.id === talk.id);
            const picked = selection?.kind === "talks" && selection.id === talk.id;
            return (
              <Fragment key={talk.id}>
                <tr id={rowId("talks", talk.id)} className={`rrow${picked ? " rrow--picked" : ""}`} onClick={() => pickIfNew(selection, "talks", talk.id, onSelect)} onFocus={() => pickIfNew(selection, "talks", talk.id, onSelect)}>
                  <th scope="row" className="mono">
                    {talk.id}
                  </th>
                  <td>
                    {/* a title is checked against the text word by word, so it shows whole */}
                    <textarea
                      aria-label={`${talk.id} title`}
                      className="rtable__title"
                      rows={3}
                      value={talk.title}
                      disabled={locked}
                      onChange={(event) => change(talk.id, { title: event.target.value.replace(/\s*\n\s*/g, " ") })}
                    />
                    {was && <Was shown={`“${was.title}”`} fields={prov.fields} field="title" />}
                  </td>
                  <td className="rtable__stack">
                    <select aria-label={`${talk.id} speaker`} value={talk.speaker_id} disabled={locked} onChange={(event) => change(talk.id, { speaker_id: event.target.value })}>
                      {!working.speakers.some((speaker) => speaker.id === talk.speaker_id) && <option value={talk.speaker_id}>none</option>}
                      {working.speakers.map((speaker) => (
                        <option key={speaker.id} value={speaker.id}>
                          {speaker.name || speaker.id}
                        </option>
                      ))}
                    </select>
                    <select aria-label={`${talk.id} track`} value={talk.track_id} disabled={locked} onChange={(event) => change(talk.id, { track_id: event.target.value })}>
                      {!working.tracks.some((track) => track.id === talk.track_id) && <option value={talk.track_id}>none</option>}
                      {working.tracks.map((track) => (
                        <option key={track.id} value={track.id}>
                          {track.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td data-label="Attendance">
                    <input
                      aria-label={`${talk.id} attendance`}
                      className="rtable__number"
                      type="number"
                      min={0}
                      step={1}
                      inputMode="numeric"
                      placeholder="not stated"
                      value={talk.attendance ?? ""}
                      disabled={locked}
                      onChange={(event) => {
                        const text = event.target.value;
                        if (text === "") change(talk.id, { attendance: null });
                        else if (/^\d+$/.test(text)) change(talk.id, { attendance: Number(text) });
                      }}
                    />
                    {was && <Was shown={was.attendance === null ? "nothing" : String(was.attendance)} fields={prov.fields} field="attendance" />}
                  </td>
                  <td className="rtable__stack">
                    <ProvenanceBadge {...prov} reader={reader} />
                    <SourceChips kind="talks" id={talk.id} facts={facts} selection={selection} onSelect={onSelect} />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn--icon"
                      aria-label={`Take ${talk.id} out`}
                      title="Take this talk out of the reading"
                      disabled={locked}
                      onClick={(event) => {
                        event.stopPropagation();
                        onChange(removeTalk(working, talk.id));
                      }}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
                {picked && (
                  <tr className="rdetail">
                    <td />
                    <td colSpan={5}>
                      <Quotes kind="talks" id={talk.id} facts={facts} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      <Removed rows={removed} name={(row) => `“${row.title}”`} locked={locked} onRestore={(id) => onChange(restoreRow(working, original, "talks", id))} />
    </section>
  );
}

const PREFERENCE_WORDS: Record<Preference, string> = { morning: "Morning", afternoon: "Afternoon" };

function SpeakersTable({ original, working, facts, selection, onSelect, onChange, locked, reader }: TablesProps) {
  const removed = removedRows(original, working, "speakers");
  const change = (id: string, patch: Partial<Omit<Speaker, "id">>) => onChange(patchSpeaker(working, id, patch));
  return (
    <section className="rt" aria-label="Speakers and their constraints">
      <header className="rt__head">
        <h3 className="rt__title">
          Speakers and constraints <span className="rt__count">{working.speakers.length}</span>
        </h3>
        <button
          type="button"
          className="btn"
          disabled={locked}
          onClick={() => {
            const next = addSpeaker(working, original);
            onChange(next);
            onSelect(pickRow("speakers", next.speakers[next.speakers.length - 1].id));
          }}
        >
          Add a speaker
        </button>
      </header>
      <table className="rtable rtable--cards">
        <thead>
          <tr>
            <th scope="col">Id</th>
            <th scope="col">Name</th>
            <th scope="col">Availability</th>
            <th scope="col">Preference</th>
            <th scope="col">Sources</th>
            <th scope="col">From</th>
            <th scope="col">
              <span className="sr-only">Remove</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {working.speakers.map((speaker) => {
            const prov = provenanceOf(original, working, "speakers", speaker.id);
            const was = original.speakers.find((row) => row.id === speaker.id);
            const picked = selection?.kind === "speakers" && selection.id === speaker.id;
            const talks = talksOf(working, speaker.id);
            return (
              <Fragment key={speaker.id}>
                <tr id={rowId("speakers", speaker.id)} className={`rrow${picked ? " rrow--picked" : ""}`} onClick={() => pickIfNew(selection, "speakers", speaker.id, onSelect)} onFocus={() => pickIfNew(selection, "speakers", speaker.id, onSelect)}>
                  <th scope="row" className="mono">
                    {speaker.id}
                  </th>
                  <td>
                    <input aria-label={`${speaker.id} name`} value={speaker.name} disabled={locked} onChange={(event) => change(speaker.id, { name: event.target.value })} />
                    {was && <Was shown={`“${was.name}”`} fields={prov.fields} field="name" />}
                  </td>
                  <td className="rtable__avail" data-label="Availability">
                    {describeCells(working, speaker.available)}
                    {was && <Was shown={describeCells(original, was.available)} fields={prov.fields} field="available" />}
                  </td>
                  <td data-label="Preference">
                    <select
                      aria-label={`${speaker.id} preference`}
                      value={speaker.preference ?? ""}
                      disabled={locked}
                      onChange={(event) => change(speaker.id, { preference: event.target.value === "" ? null : (event.target.value as Preference) })}
                    >
                      <option value="">no preference</option>
                      {PREFERENCES.map((value) => (
                        <option key={value} value={value}>
                          {PREFERENCE_WORDS[value]}
                        </option>
                      ))}
                    </select>
                    {was && <Was shown={was.preference === null ? "none" : PREFERENCE_WORDS[was.preference]} fields={prov.fields} field="preference" />}
                  </td>
                  <td>
                    <SourceChips kind="speakers" id={speaker.id} facts={facts} selection={selection} onSelect={onSelect} />
                  </td>
                  <td>
                    <ProvenanceBadge {...prov} reader={reader} />
                  </td>
                  <td>
                    <Tooltip
                      focusable={locked || talks.length > 0}
                      placement="left"
                      label={talks.length > 0 ? `${speaker.name || speaker.id} still has ${talks.length === 1 ? "a talk" : `${talks.length} talks`}: give them to someone else first` : "Take this speaker out of the reading"}
                    >
                      <button
                        type="button"
                        className="btn btn--icon"
                        aria-label={`Take ${speaker.id} out`}
                        disabled={locked || talks.length > 0}
                        onClick={(event) => {
                          event.stopPropagation();
                          onChange(removeSpeaker(working, speaker.id));
                        }}
                      >
                        ✕
                      </button>
                    </Tooltip>
                  </td>
                </tr>
                {picked && (
                  <tr className="rdetail">
                    <td />
                    <td colSpan={6}>
                      <Quotes kind="speakers" id={speaker.id} facts={facts} />
                      <AvailabilityGrid proposal={working} speaker={speaker} disabled={locked} onChange={(next) => change(speaker.id, { available: next.available })} />
                      {speaker.email !== "" && <p className="rdetail__email mono">{speaker.email}</p>}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      <Removed rows={removed} name={(row) => row.name} locked={locked} onRestore={(id) => onChange(restoreRow(working, original, "speakers", id))} />
    </section>
  );
}

function TracksTable({ original, working, onChange, locked, reader }: TablesProps) {
  return (
    <section className="rt" aria-label="Tracks">
      <header className="rt__head">
        <h3 className="rt__title">
          Tracks <span className="rt__count">{working.tracks.length}</span>
        </h3>
      </header>
      <table className="rtable">
        <thead>
          <tr>
            <th scope="col">Id</th>
            <th scope="col">Name</th>
            <th scope="col">Talks</th>
            <th scope="col">From</th>
          </tr>
        </thead>
        <tbody>
          {working.tracks.map((track) => {
            const prov = provenanceOf(original, working, "tracks", track.id);
            return (
              <tr key={track.id} className="rrow">
                <th scope="row" className="mono">
                  {track.id}
                </th>
                <td>
                  <input aria-label={`${track.id} name`} value={track.name} disabled={locked} onChange={(event) => onChange(patchTrack(working, track.id, { name: event.target.value }))} />
                </td>
                <td>{working.talks.filter((talk) => talk.track_id === track.id).length}</td>
                <td>
                  <ProvenanceBadge {...prov} reader={reader} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

/** Muse's reading as tables a person can correct: talks, speakers with their constraints, tracks. Every row says where it
 * comes from, every constraint carries the sentence it was read from, and rooms are read-only (they came from the form). */
export function ReviewTables(props: TablesProps) {
  const { working } = props;
  return (
    <div className="review__tables">
      <TalksTable {...props} />
      <SpeakersTable {...props} />
      <TracksTable {...props} />
      <p className="review__rooms">
        <b>Rooms</b> (from the form, or the program&rsquo;s default): {working.rooms.map((room) => `${room.name} ${room.capacity}`).join(" · ") || "none"}
      </p>
    </div>
  );
}

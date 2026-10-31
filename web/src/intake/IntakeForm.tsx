import type { ReactNode } from "react";

import { Details } from "../components/ui";
import type { Site } from "../lib/controls";

import { BOX_LIMIT, formProblems, roomsOf, type Backend, type ReadingForm } from "./launch";
import { LIMITS } from "./validate";

export interface IntakeFormProps {
  form: ReadingForm;
  onForm: (next: ReadingForm) => void;
  backend: Backend;
  onBackend: (backend: Backend) => void;
  /** The server lets a launch be billed (`GET api/capabilities`: `real`). */
  realAllowed: boolean;
  /** Where the page runs (the privacy notice says what is true there). */
  site?: Site;
  busy: boolean;
  /** Why the last call failed, in the server's words. */
  error: string | null;
  onRead: () => void;
  onSample: () => void;
  sampling: boolean;
  /** Empty the form and the page's memory of it. */
  onClear: () => void;
  /** The spend panel of a billed reading, when there is one to show. */
  spend: ReactNode;
}

/** What stays private and what leaves the machine, said before anything is pasted. On the static site there is no server and no folder of its:
 * what is pasted stays in the page, and the notice says what the app does with it, which is what a person who runs it will meet. */
export function PrivacyNotice({ backend, site = "server" }: { backend: Backend; site?: Site }) {
  if (site === "static") {
    return (
      <aside className="privacy" aria-label="Private data">
        <h3 className="privacy__title">Private by design</h3>
        <ul>
          <li>What you paste stays in this page: this site has no server, so it is not sent, stored or logged anywhere, and a reload clears it.</li>
          <li>
            In the app, which you run yourself, it is kept in a private folder on your machine, outside the repo, and is never bundled or committed. Email addresses
            are replaced by placeholders (person-01@example.invalid) before anything is logged or read by a model.
          </li>
          <li>The app&rsquo;s practice reader runs on your machine, so nothing leaves it; with Muse, which is billed, the text (addresses replaced) is sent to Meta&rsquo;s model API.</li>
        </ul>
      </aside>
    );
  }
  return (
    <aside className="privacy" aria-label="Private data">
      <h3 className="privacy__title">Private by design</h3>
      <ul>
        <li>What you paste is kept on this machine, in the server&rsquo;s private folder, outside the repo. It replays locally and is never bundled or committed.</li>
        <li>Email addresses are replaced by placeholders (person-01@example.invalid) before anything is logged or read by a model.</li>
        <li>Contributor pricing is forced off for runs on your text.</li>
        <li className={backend === "real" ? "privacy__out" : undefined}>
          {backend === "real"
            ? "With Muse, the text (addresses replaced) is sent to Meta’s model API."
            : "The practice reader runs on this machine: nothing leaves it."}
        </li>
      </ul>
    </aside>
  );
}

/** The program the text is fitted to: fixed, so the person knows what Muse will tell them it had to merge, split or cut. */
export function ShapeCard() {
  return (
    <section className="panel shape" aria-label="The program">
      <h3 className="panel__title">The program</h3>
      <p className="shape__line">
        <b>2 days</b> · <b>3 tracks × 2 blocks</b> · <b>{LIMITS.minTalks} to {LIMITS.maxTalks} talks</b>
      </p>
      <p className="shape__note">The shape is fixed. The reader fits what you paste to it, and says when it had to merge, split or cut.</p>
    </section>
  );
}

const count = (text: string): string => `${text.length.toLocaleString("en-US")} / ${BOX_LIMIT.toLocaleString("en-US")}`;

export function IntakeForm({ form, onForm, backend, onBackend, realAllowed, site = "server", busy, error, onRead, onSample, sampling, onClear, spend }: IntakeFormProps) {
  const set = <K extends keyof ReadingForm>(key: K, value: ReadingForm[K]) => onForm({ ...form, [key]: value });
  const problems = formProblems(form, backend);
  const roomProblems = roomsOf(form.rooms).problems;
  const real = backend === "real";
  // what the optional fields hold is shown, never folded away: the sample text fills them
  const moreFilled = form.notes !== "" || form.conference !== "" || form.rooms.length > 0;
  return (
    <div className="intake__form">
      <div className="intake__fields">
        <label className="field">
          <span className="field__label">
            Talks <span className="field__hint">titles, speakers, abstracts. Required.</span>
          </span>
          <textarea className="field__box" rows={14} value={form.talks} onChange={(event) => set("talks", event.target.value)} spellCheck={false} autoComplete="off" placeholder="Submission 1&#10;Title: …&#10;Speaker: …&#10;Track: …&#10;Abstract: …" />
          <span className="field__count mono">{count(form.talks)}</span>
        </label>
        {problems.length > 0 && form.talks.trim() !== "" && (
          <ul className="field__problems">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        )}
        <Details id="more" summary="Add emails, notes, rooms or a conference name" hint="all optional" open={moreFilled}>
          <div className="intake__fields">
            <label className="field">
              <span className="field__label">
                Emails or notes <span className="field__hint">availability, preferences, how many are expected. Optional.</span>
              </span>
              <textarea className="field__box" rows={10} value={form.notes} onChange={(event) => set("notes", event.target.value)} spellCheck={false} autoComplete="off" />
              <span className="field__count mono">{count(form.notes)}</span>
            </label>
            <label className="field field--line">
              <span className="field__label">
                Conference <span className="field__hint">a name or a line about it. Optional.</span>
              </span>
              <input value={form.conference} onChange={(event) => set("conference", event.target.value)} autoComplete="off" />
            </label>
            <fieldset className="rooms">
              <legend className="field__label">
                Rooms <span className="field__hint">optional: none means the program&rsquo;s default rooms.</span>
              </legend>
              {form.rooms.map((room, i) => (
                <div key={i} className="rooms__row">
                  <input aria-label={`Room ${i + 1} name`} placeholder="Name" value={room.name} onChange={(event) => set("rooms", form.rooms.map((r, j) => (j === i ? { ...r, name: event.target.value } : r)))} />
                  <input
                    aria-label={`Room ${i + 1} capacity`}
                    className="rooms__capacity"
                    inputMode="numeric"
                    placeholder="Seats"
                    value={room.capacity}
                    onChange={(event) => set("rooms", form.rooms.map((r, j) => (j === i ? { ...r, capacity: event.target.value } : r)))}
                  />
                  <button type="button" className="btn" aria-label={`Remove room ${i + 1}`} onClick={() => set("rooms", form.rooms.filter((_, j) => j !== i))}>
                    Remove
                  </button>
                </div>
              ))}
              <button type="button" className="btn" onClick={() => set("rooms", [...form.rooms, { name: "", capacity: "" }])}>
                Add a room
              </button>
              {roomProblems.length > 0 && <p className="field__problem">{roomProblems.join("; ")}.</p>}
            </fieldset>
            <label className="check">
              <input type="checkbox" checked={form.names} onChange={(event) => set("names", event.target.checked)} />
              Also replace the speakers&rsquo; names with &ldquo;Speaker NN&rdquo; in what the agents read
            </label>
            <div>
              <button type="button" className="btn" disabled={busy || (form.talks === "" && form.notes === "" && form.conference === "" && form.rooms.length === 0)} onClick={onClear}>
                Clear everything
              </button>
            </div>
          </div>
        </Details>
      </div>

      <div className="intake__side">
        <ShapeCard />
        <PrivacyNotice backend={backend} site={site} />
        <Details id="reader" summary="Reader" hint={real ? "Muse · billed" : "the practice reader · free"} open={real}>
          <fieldset className="reader">
            <legend className="sr-only">Reader</legend>
            <label className="reader__choice">
              <input type="radio" name="reader" checked={!real} onChange={() => onBackend("fake")} />
              <span>
                <b>Practice reader</b> · free
                <span className="reader__says">Runs on this machine. It understands only the sample&rsquo;s wording.</span>
              </span>
            </label>
            <label className={`reader__choice${realAllowed ? "" : " reader__choice--off"}`}>
              <input type="radio" name="reader" checked={real} disabled={!realAllowed} onChange={() => onBackend("real")} />
              <span>
                <b>Muse</b> · billed
                <span className="reader__says">{realAllowed ? "Reads any wording. The cost is checked first." : "Billed launches are off here."}</span>
              </span>
            </label>
          </fieldset>
        </Details>
        <div className="intake__actions">
          {!real && (
            <button type="button" className="btn btn--big btn--on" disabled={busy || problems.length > 0} onClick={onRead}>
              {busy ? "Starting…" : "Read with the practice reader"}
            </button>
          )}
          <button type="button" className="btn" disabled={sampling || busy} onClick={onSample}>
            {sampling ? "Loading…" : "Use the sample text"}
          </button>
        </div>
        {real && problems.length === 0 && spend}
        {real && problems.length > 0 && <p className="field__problem">Fill in the form first: the cost depends on the text.</p>}
        {error !== null && (
          <p className="intake__error" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

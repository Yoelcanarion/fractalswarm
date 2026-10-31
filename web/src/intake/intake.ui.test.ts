// The intake page drawn on the server (react-dom/server) over W2's real bodies: no browser, but every render path
// runs, and what a person must always be able to see (where a row comes from, what stops the approval, what a billed
// launch costs before the word can be typed) is checked in the markup. The look is checked on screenshots.

import { readdirSync, readFileSync } from "node:fs";
import { createElement, type FunctionComponent } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { occurrences, plainText } from "../arena/helps/testing";
import { createIntakeApi } from "./api";
import { addTalk, patchTalk, removeTalk } from "./edit";
import { FIELD_WORDS } from "./highlight";
import { IntakeFlow, type IntakeFlowProps } from "./IntakePage";
import { IntakeForm, type IntakeFormProps } from "./IntakeForm";
import { DEFAULT_CHOICE, emptyForm, scenarioLabel } from "./launch";
import { LoadingReading, Reading, Stopped } from "./ReadingView";
import { phaseOf } from "./flow";
import { diffProposal } from "./provenance";
import { ReviewScreen, type ReviewScreenProps } from "./ReviewScreen";
import { RunPanel, type RunPanelProps } from "./RunPanel";
import { SourcePane } from "./SourcePane";
import { SpendPanel, type SpendPanelProps } from "./SpendPanel";
import { Steps } from "./Steps";
import { checkProposal } from "./validate";
import { museReading, museTexts, preflightOf, stateOf } from "./testing";
import { gateFor } from "./spend";

const html = <P extends object>(component: FunctionComponent<P>, props: P): string => renderToStaticMarkup(createElement(component, props));
const never = createIntakeApi(() => new Promise(() => undefined));
const nothing = () => undefined;

const muse = museReading();
const texts = museTexts();
const scans = stateOf("intake.proposed.json").scans;

describe("the steps", () => {
  it("marks where the person is, and the steps before it as done", () => {
    const markup = html(Steps, { current: "Review" });
    expect(occurrences(markup, 'aria-current="step"')).toBe(1);
    expect(occurrences(markup, "steps__item--done")).toBe(2);
    expect(plainText(markup)).toContain("Paste");
    expect(plainText(markup)).toContain("Run");
  });
});

describe("the form", () => {
  const form = (over: Partial<IntakeFormProps> = {}): string =>
    html(IntakeForm, { form: emptyForm(), onForm: nothing, backend: "fake", onBackend: nothing, realAllowed: false, busy: false, error: null, onRead: nothing, onSample: nothing, sampling: false, onClear: nothing, spend: null, ...over });
  const readButton = (markup: string): string => /<button[^>]*>(?:Read with the practice reader|Starting…)<\/button>/.exec(markup)?.[0] ?? "";

  it("says before anything is pasted that it is kept on this machine, is never bundled, and where the addresses go", () => {
    const text = plainText(form());
    expect(text).toContain("kept on this machine");
    expect(text).toContain("never bundled or committed");
    expect(text).toContain("Email addresses are replaced by placeholders");
  });

  it("says on the static site what is true of what is pasted: it stays in the page, and the private folder is the app's", () => {
    const text = plainText(form({ site: "static" }));
    expect(text).toContain("Private by design");
    expect(text).toContain("What you paste stays in this page: this site has no server, so it is not sent, stored or logged anywhere, and a reload clears it.");
    expect(text).toContain("In the app, which you run yourself, it is kept in a private folder on your machine, outside the repo, and is never bundled or committed.");
    expect(text).toContain("Email addresses are replaced by placeholders");
    expect(text).toContain("with Muse, which is billed, the text (addresses replaced) is sent to Meta’s model API");
    expect(text).not.toContain("kept on this machine");
    expect(text).not.toContain("the server’s private folder");
    // a server's box is as it was
    expect(plainText(form({ site: "server" }))).toContain("in the server’s private folder, outside the repo");
  });

  it("gives the program's fixed shape, so the person knows what Muse will fit the text to", () => {
    const text = plainText(form());
    expect(text).toContain("2 days");
    expect(text).toContain("3 tracks × 2 blocks");
    expect(text).toContain("8 to 15 talks");
  });

  it("asks for talks, notes, a conference line and rooms, and counts the characters against the server's limit", () => {
    const markup = form();
    expect(occurrences(markup, "<textarea")).toBe(2);
    const text = plainText(markup);
    expect(text).toContain("Talks");
    expect(text).toContain("Emails or notes");
    expect(text).toContain("Conference");
    expect(text).toContain("Add a room");
    expect(text).toContain("0 / 200,000");
  });

  it("cannot read an empty form, and can read one with talks", () => {
    expect(readButton(form())).toContain("disabled");
    expect(readButton(form({ form: { ...emptyForm(), talks: "Submission 1" } }))).not.toContain("disabled");
    expect(readButton(form({ form: { ...emptyForm(), talks: "Submission 1" }, busy: true }))).toContain("disabled");
  });

  it("says a half-filled room is a mistake, in the person's terms", () => {
    const text = plainText(form({ form: { ...emptyForm(), talks: "x", rooms: [{ name: "Main", capacity: "" }] } }));
    expect(text).toContain("Room Main needs a capacity of at least 1");
  });

  it("offers Muse only when the server lets a launch be billed, and says so when it does not", () => {
    const off = form({ realAllowed: false });
    expect(plainText(off)).toContain("Billed launches are off here.");
    expect(/<input[^>]*type="radio"[^>]*disabled/.test(off)).toBe(true);
    const on = form({ realAllowed: true });
    expect(plainText(on)).toContain("The cost is checked first.");
    expect(plainText(on)).not.toContain("Billed launches are off");
  });

  it("with Muse, says the text leaves the machine, drops the free button for the spend panel, and waits for a form to price", () => {
    const text = plainText(form({ backend: "real", realAllowed: true }));
    expect(text).toContain("With Muse, the text (addresses replaced) is sent to Meta’s model API.");
    expect(text).not.toContain("Read with the practice reader");
    expect(text).toContain("Fill in the form first: the cost depends on the text.");
    const priced = html(IntakeForm, {
      form: { ...emptyForm(), talks: "Submission 1" },
      onForm: nothing,
      backend: "real",
      onBackend: nothing,
      realAllowed: true,
      busy: false,
      error: null,
      onRead: nothing,
      onSample: nothing,
      sampling: false,
      onClear: nothing,
      spend: createElement("div", null, "the spend panel"),
    });
    expect(plainText(priced)).toContain("the spend panel");
  });

  it("shows what the server said when it did not take the form", () => {
    expect(plainText(form({ error: "the notes box is over 200000 characters" }))).toContain("the notes box is over 200000 characters");
  });
});

describe("the review", () => {
  const props = (over: Partial<ReviewScreenProps> = {}): ReviewScreenProps => ({
    original: muse,
    working: muse,
    texts,
    scans,
    selection: null,
    box: "talks",
    locked: false,
    issues: checkProposal(muse),
    edits: [],
    approving: false,
    approveError: null,
    approved: null,
    approvalWarnings: [],
    runPanel: null,
    onSelect: nothing,
    onBox: nothing,
    onChange: nothing,
    onApprove: nothing,
    ...over,
  });
  const review = (over: Partial<ReviewScreenProps> = {}): string => html(ReviewScreen, props(over));
  /** A review of Muse's reading after some edits, with the edits the server would list and the checks on the result. */
  const edited = (working: typeof muse, over: Partial<ReviewScreenProps> = {}): string => review({ working, issues: checkProposal(working), edits: diffProposal(muse, working), ...over });
  const approveButton = (markup: string): string => /<button[^>]*>(?:Approve this reading|Approving…)<\/button>/.exec(markup)?.[0] ?? "";

  it("shows every talk, speaker and track Muse read, each with where it comes from", () => {
    const markup = review();
    expect(occurrences(markup, 'id="row-talks-T')).toBe(12);
    expect(occurrences(markup, 'id="row-speakers-S')).toBe(9);
    expect(occurrences(markup, 'class="prov prov--muse"')).toBe(12 + 9 + 3);
    expect(plainText(markup)).not.toContain("Edited by you");
  });

  it("shows the constraints: availability in words, a preference, an expected attendance, each with its source", () => {
    const markup = review();
    const text = plainText(markup);
    expect(text).toContain("Any time");
    expect(text).toContain("Day 1 all day");
    expect(markup).toContain('<option value="morning" selected="">Morning</option>');
    expect(markup).toContain('value="33"');
    for (const field of ["attendance_source", "availability_source", "preference_source", "track_source"] as const) expect(markup).toContain(`>${FIELD_WORDS[field]}</button>`);
  });

  it("marks, in the text pasted, the sentence picked, and shows its quote and where it stands", () => {
    const markup = review({ selection: { kind: "talks", id: "T01", field: "attendance_source" } });
    expect(markup).toMatch(/<mark class="src src--active" data-active="true"[^>]*>Expected audience: about 33 participants\.<\/mark>/);
    const text = plainText(markup);
    expect(text).toContain("Showing where talk T01 · attendance was read.");
    expect(markup).toContain("<q>Expected audience: about 33 participants.</q>");
    expect(text).toContain("in the talks");
    // only the picked row opens its quotes
    expect(occurrences(markup, 'class="rdetail"')).toBe(1);
    // every other sentence a row was read from is marked too, but not as the one picked
    expect(occurrences(markup, "src src--sentence")).toBeGreaterThan(10);
  });

  it("opens the notes box for a speaker's email, where the availability was read", () => {
    const markup = review({ box: "notes", selection: { kind: "speakers", id: "S02", field: "availability_source" } });
    expect(markup).toMatch(/<mark class="src src--active" data-active="true"[^>]*>I can only do afternoons/);
    expect(plainText(markup)).toContain("Showing where speaker S02 · availability was read.");
    // the speaker's cells of the grid, as buttons a person can press
    expect(markup.match(/class="avail__cell( avail__cell--on)?"/g)?.length).toBe(muse.days.length * muse.slots.length);
    // a cell that is given is a tick as well as a colour, and a cell that is not is empty
    const given = occurrences(markup, "avail__cell--on");
    expect(given).toBeGreaterThan(0);
    expect(markup.match(/avail__cell--on"[^>]*><span aria-hidden="true">✓<\/span><\/button>/g)?.length).toBe(given);
    expect(markup).not.toMatch(/class="avail__cell"[^>]*>[^<]/);
  });

  it("says, instead of marking a wrong place, that a sentence is not in the text", () => {
    const reworded = patchTalk(muse, "T01", { attendance_source: "The room will be packed." });
    const markup = edited(reworded, { selection: { kind: "talks", id: "T01", field: "attendance_source" } });
    expect(markup).toContain("srcchip--missing");
    expect(plainText(markup)).toContain("not found in the text. Muse reworded it.");
    expect(markup).not.toContain("The room will be packed.</mark>");
  });

  it("puts what the person changed next to what Muse read, and an added row as theirs", () => {
    const markup = edited(addTalk(patchTalk(muse, "T01", { attendance: 40 }), muse));
    const text = plainText(markup);
    expect(text).toContain("Edited by you");
    expect(text).toContain("Muse read 33");
    expect(text).toContain("Added by you");
    // the order of the server's own list: what was added, what was removed, then the fields changed
    expect(text).toContain("2 edits to Muse’s reading: talk T13 added; talk T01: attendance.");
  });

  it("lists a row that was taken out, with a way back", () => {
    const text = plainText(edited(removeTalk(muse, "T05")));
    expect(text).toContain("Taken out of Muse’s reading:");
    expect(text).toContain("Put back");
  });

  it("does not let a speaker who still has a talk be taken out, and says why", () => {
    const markup = review();
    // a disabled button takes no focus, so its wrapper does, and the reason is in the hint it opens
    expect(markup).toMatch(/tabindex="0"[^>]*><button[^>]*aria-label="Take [^"]+ out"[^>]*disabled/);
    expect(markup).toMatch(/role="tooltip" class="tip__bubble">[^<]*still has (a talk|\d+ talks)[^<]*</);
  });

  it("stops the approval on what the server would refuse, and says what", () => {
    let few = muse;
    for (const talk of muse.talks.slice(0, 5)) few = removeTalk(few, talk.id);
    const markup = edited(few);
    expect(approveButton(markup)).toContain("disabled");
    expect(plainText(markup)).toContain("the program needs at least 8 talks; this has 7");
  });

  it("lets the approval through on advice, and keeps the advice in view", () => {
    // the one talk of a speaker removed: the speaker is left out of the program, as the server says it will
    const markup = edited(removeTalk(muse, "T05"));
    expect(approveButton(markup)).not.toContain("disabled");
    expect(plainText(markup)).toContain("1 thing to know");
    expect(plainText(markup)).toContain("Quinn Tanaka has no talk in the program: left out");
  });

  it("shows Muse's own notes, or says there were none", () => {
    expect(plainText(review())).toContain("Muse left no notes on this reading.");
    const noted = { ...muse, warnings: ["Dara Duarte gives a talk but wrote no note: any time is assumed"] };
    expect(plainText(review({ original: noted, working: noted }))).toContain("Dara Duarte gives a talk but wrote no note: any time is assumed");
  });

  it("says what the scan found in the boxes", () => {
    expect(plainText(review())).toContain("Scanned 3 boxes: all allowed; email addresses replaced in talks and notes.");
  });

  it("after the approval is frozen: no approve bar, no input that can be edited, and the server's record on show", () => {
    const approved = stateOf("intake.approved.json").approved;
    expect(approved).not.toBeNull();
    const markup = review({ locked: true, approved, approvalWarnings: ["Quinn Tanaka has no talk in the program: left out"], runPanel: createElement("div", null, "the run panel") });
    const text = plainText(markup);
    expect(text).not.toContain("Approve this reading");
    expect(text).toContain("Approved");
    expect(text).toContain("2026-10-29 16:24 UTC");
    expect(text).toContain("fingerprint 08e68651a110");
    expect(text).toContain("2 edits to Muse’s reading: speaker S02: preference; talk T01: attendance.");
    expect(text).toContain("Quinn Tanaka has no talk in the program: left out");
    expect(text).toContain("the run panel");
    expect(text).toContain("These rows are Muse’s reading. The server keeps the version you approved");
    const inputs = markup.match(/<(input|select|button)[^>]*>/g) ?? [];
    const editable = inputs.filter((tag) => /aria-label="(T|S|track)[^"]*(title|speaker|track|attendance|name|preference)|aria-label="Conference name"/.test(tag));
    expect(editable.length).toBeGreaterThan(30);
    for (const tag of editable) expect(tag, tag).toContain("disabled");
  });
});

describe("the text you pasted, drawn", () => {
  it("never reads it as markup: a tag in the text is text", () => {
    const hostile = "Submission 1 <script>alert(1)</script> <img src=x onerror=alert(2)>";
    const markup = html(SourcePane, { texts: { talks: hostile }, facts: [], selection: null, active: new Set<string>(), box: "talks", onBox: nothing, onPick: nothing });
    expect(markup).not.toContain("<script>");
    expect(markup).not.toContain("<img");
    expect(markup).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
});

describe("reading and stopping", () => {
  it("says the reader is working, and what the scan found already", () => {
    const text = plainText(html(Reading, { state: stateOf("intake.proposed.json") }));
    expect(text).toContain("Reading your text…");
    expect(text).toContain("Talks allowed · addresses replaced");
  });

  it("says what the firewall blocked and why, that no model saw it, and offers the way back", () => {
    const phase = phaseOf(stateOf("intake.refused.json"));
    expect(phase.name).toBe("stopped");
    if (phase.name !== "stopped") return;
    const markup = html(Stopped, { headline: phase.headline, details: phase.details, scans: phase.state.scans, onStartOver: nothing });
    const text = plainText(markup);
    expect(text).toContain("The firewall blocked notes before any model read it.");
    expect(text).toContain("prompt-injection score 0.9700");
    expect(text).toContain("Notes block");
    expect(text).toContain("Nothing was sent to a model.");
    expect(text).toContain("Back to the form");
    expect(text).not.toContain("Try again");
  });

  it("offers to ask the server again when a reading could not be fetched, next to the way back", () => {
    const markup = html(Stopped, { headline: "The reading could not be fetched.", details: ["502 Bad Gateway"], scans: [], onStartOver: nothing, onRetry: nothing });
    const text = plainText(markup);
    expect(text).toContain("The reading could not be fetched.");
    expect(text).toContain("502 Bad Gateway");
    expect(text).toContain("Try again");
    expect(text).toContain("Back to the form");
    expect(markup).toContain('role="alert"');
    expect(markup.indexOf("Try again")).toBeLessThan(markup.indexOf("Back to the form"));
  });

  it("holds the place of the reading while the server is asked which state it is in, and does not say it is reading", () => {
    const markup = html(LoadingReading, {});
    expect(plainText(markup)).toContain("Loading the reading…");
    expect(plainText(markup)).not.toContain("Reading your text");
    expect(markup).toContain('role="status"');
    expect(markup).toContain("skeleton");
  });
});

describe("billed spend", () => {
  const checkedOk = { preflight: preflightOf(), priced: "p", at: 0 };
  const panel = (over: Partial<SpendPanelProps> = {}): string =>
    html(SpendPanel, { what: "the arena pair", checked: null, checking: false, error: null, gate: { launch: false, reason: "Check the cost first." }, typed: "", onTyped: nothing, onCheck: nothing, onLaunch: nothing, launching: false, launchLabel: "Start (billed)", ...over });

  it("asks only for the check at first: no word to type, no launch", () => {
    const markup = panel();
    expect(plainText(markup)).toContain("charged to the project’s budget");
    expect(plainText(markup)).toContain("Check the cost");
    expect(markup).not.toContain("<input");
    expect(markup).not.toContain("Start (billed)");
  });

  it("shows the worst case and the caps before the word can be typed", () => {
    const markup = panel({ checked: checkedOk, gate: gateFor(checkedOk, "p", "", 1) });
    const text = plainText(markup);
    expect(text).toContain("Worst case $1.50");
    expect(text).toContain("Left under the project cap ($150.00): $137.50");
    expect(text).toContain("Left under the phase cap ($50.00): $49.32");
    expect(text.indexOf("Worst case")).toBeLessThan(text.indexOf("to confirm"));
    expect(text).toContain("Type SPEND to confirm");
    expect(/<button[^>]*>Start \(billed\)<\/button>/.exec(markup)?.[0]).toContain("disabled");
  });

  it("opens the launch only for the word typed exactly", () => {
    const wrong = gateFor(checkedOk, "p", "spend", 1);
    expect(wrong.launch).toBe(false);
    expect(/<button[^>]*>Start \(billed\)<\/button>/.exec(panel({ checked: checkedOk, gate: wrong, typed: "spend" }))?.[0]).toContain("disabled");
    const right = gateFor(checkedOk, "p", "SPEND", 1);
    expect(right).toEqual({ launch: true, token: "tok-1" });
    expect(/<button[^>]*>Start \(billed\)<\/button>/.exec(panel({ checked: checkedOk, gate: right, typed: "SPEND" }))?.[0]).not.toContain("disabled");
  });

  it("shows a refusal, and gives no word to type", () => {
    const refused = { preflight: preflightOf({ ok: false, token: null, expires_in_s: null, refusals: ["real runs from the UI are off: start the server with FRACTALSWARM_ALLOW_UI_REAL=1"] }), priced: "p", at: 0 };
    const markup = panel({ checked: refused, gate: gateFor(refused, "p", "", 1) });
    expect(plainText(markup)).toContain("real runs from the UI are off");
    expect(plainText(markup)).toContain("Worst case");
    expect(markup).not.toContain("<input");
  });

  it("says when the check itself failed", () => {
    expect(plainText(panel({ error: "could not reach the server: offline" }))).toContain("could not reach the server: offline");
  });
});

describe("running the approved reading", () => {
  const run = (over: Partial<RunPanelProps> = {}): string => html(RunPanel, { api: never, intakeId: "intake-1", realAllowed: true, canStart: true, onStarted: nothing, ...over });
  const escaped = (word: string): string => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pressed = (markup: string, word: string): boolean => new RegExp(`<button[^>]*aria-checked="true"[^>]*>${escaped(word)}</button>`).test(markup);

  it("opens on the arena pair against the ideal durable supervisor, on half the brains, free", () => {
    const markup = run();
    expect(pressed(markup, "Arena pair")).toBe(true);
    expect(pressed(markup, "Ideal durable supervisor")).toBe(true);
    expect(pressed(markup, "Half the brains")).toBe(true);
    expect(pressed(markup, "Practice LLM · free")).toBe(true);
    expect(plainText(markup)).toContain("Start the arena pair");
    expect(plainText(markup)).not.toContain("SPEND");
    expect(plainText(markup)).not.toContain("Billed:");
  });

  it("starts nothing on a server that does not start runs, and says so", () => {
    const markup = run({ canStart: false });
    expect(plainText(markup)).toContain("This server does not start runs from the API");
    expect(/<button[^>]*>Start the arena pair<\/button>/.exec(markup)?.[0]).toContain("disabled");
  });

  it("does not offer the billed model on a server that does not allow it", () => {
    const markup = run({ realAllowed: false });
    expect(/<button[^>]*role="radio"[^>]*disabled[^>]*>Meta Model API · billed<\/button>/.test(markup)).toBe(true);
    expect(plainText(markup)).toContain("Billed launches are off here.");
  });

  it("billed, puts the cost check where the free button was, and the free button is gone", () => {
    const markup = run({ initial: { ...DEFAULT_CHOICE, backend: "real" } });
    const text = plainText(markup);
    expect(text).toContain("Billed: the arena pair");
    expect(text).toContain("Check the cost");
    expect(text).not.toContain("Start the arena pair");
    expect(markup).not.toContain("<input");
  });

  it("one run asks for the system and a failure profile instead", () => {
    const markup = run({ initial: { ...DEFAULT_CHOICE, mode: "run", scenario: "durable", runChaos: "C2" } });
    expect(pressed(markup, "One run")).toBe(true);
    expect(pressed(markup, scenarioLabel("durable"))).toBe(true);
    expect(pressed(markup, "C2")).toBe(true);
    expect(plainText(markup)).toContain("C2: 3 crashes");
    expect(plainText(markup)).toContain("Start the run");
  });
});

describe("the flow", () => {
  const flow = (over: Partial<IntakeFlowProps> = {}): string => html(IntakeFlow, { api: never, intakeId: null, realAllowed: false, canStart: true, ...over });

  it("opens on the form, at the first step", () => {
    const markup = flow();
    expect(plainText(markup)).toContain("New task");
    expect(markup).toMatch(/aria-current="step"[^>]*><span[^>]*>1<\/span>Paste/);
    expect(plainText(markup)).toContain("kept on this machine");
  });

  it("waits on the server for a reading in the address, at the second step", () => {
    const markup = flow({ intakeId: "intake-1" });
    expect(plainText(markup)).toContain("Loading the reading…");
    expect(markup).toMatch(/aria-current="step"[^>]*><span[^>]*>2<\/span>Read/);
  });

  it("opens every address with the same head: the page's one h1, what it is for, and the steps beside it", () => {
    for (const markup of [flow(), flow({ intakeId: "intake-1" })]) {
      expect(markup.match(/<h1/g)).toHaveLength(1);
      expect(markup).toContain('<h1 class="pagehead__title">New task</h1>');
      expect(plainText(markup)).toContain("Paste the talks and the emails or notes.");
      expect(markup).toContain('<span class="term">Muse</span>');
      expect(markup).toMatch(/pagehead__actions[^]*aria-current="step"/);
    }
  });

  it("says when the server does not start runs", () => {
    expect(plainText(flow({ canStart: false }))).toContain("This server does not start runs from the API, so reading and running live text needs fractalswarm serve");
    expect(plainText(flow({ canStart: false }))).not.toContain("static demo bundle");
  });

  it("says on the static site that it starts no run and what to run instead, and not that a server does not", () => {
    const notice = plainText(/<p class="intake__notice"[^>]*>[\s\S]*?<\/p>/.exec(flow({ canStart: false, site: "static" }))?.[0] ?? "");
    expect(notice).toBe("This site starts no run. Reading and running your text needs the app: uv run fractalswarm serve.");
    expect(flow({ canStart: true, site: "static" })).not.toContain("intake__notice");
  });
});

describe("what the page never does with what was pasted", () => {
  // the code, without the comments that explain these very rules
  const codeOf = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const sources = readdirSync(new URL(".", import.meta.url))
    .filter((name) => /\.tsx?$/.test(name) && !/\.test\.ts$/.test(name))
    .map((name) => ({ name, code: codeOf(readFileSync(new URL(name, import.meta.url), "utf-8")) }));

  it("looks at every source file of the page", () => {
    expect(sources.length).toBeGreaterThan(20);
  });

  it("does not put it in the browser's storage: the text can be private, and a reload clears it", () => {
    for (const { name, code } of sources) expect(code, name).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie/);
  });

  it("does not render it as markup", () => {
    for (const { name, code } of sources) expect(code, name).not.toMatch(/dangerouslySetInnerHTML|innerHTML|insertAdjacentHTML/);
  });

  it("calls the server in one place, which says every POST is JSON", () => {
    for (const { name, code } of sources.filter((source) => source.name !== "api.ts")) expect(code, name).not.toMatch(/\bfetch\(|XMLHttpRequest|sendBeacon/);
    expect(readFileSync(new URL("api.ts", import.meta.url), "utf-8")).toContain('"Content-Type": "application/json"');
  });
});

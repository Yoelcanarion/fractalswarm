import { useState } from "react";

import type { ViewState } from "../lib/reducer";
import { attackSeen, emailStatuses, highlight, unknownSources, type EmailStatus, type Violation } from "../lib/security";
import { Card, GenericRows, Nothing, Pill, PStat, Subhead, virtualSeconds } from "./PanelParts";

// What the codes of a scope violation mean (planning/scope.py).
const CODE_MEANING: Record<string, string> = {
  unmapped_node: "the subgoal is not a node of the approved plan",
  data_category_outside_envelope: "it touches data the plan never approved",
};

const VERDICT: Record<EmailStatus["verdict"], { label: string; tone: "muted" | "bad" | "warn" }> = {
  clean: { label: "allowed", tone: "muted" },
  quarantined: { label: "quarantined", tone: "bad" },
  blocked: { label: "caused a blocked subgoal", tone: "warn" },
};

const clip = (text: string, max = 110): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const speaker = (from: string): string => from.replace(/\s*<.*>\s*$/, "");

/** An email's text, as plain text. Emails are untrusted: they are never rendered as markup. */
function EmailText({ status, violations }: { status: EmailStatus; violations: Violation[] }) {
  const { email } = status;
  const quoted = violations.map((v) => highlight(email.body, v.objective)).find((parts) => parts !== null) ?? null;
  return (
    <div className="email">
      <div className="email__head">
        <b className="mono">{email.id}</b> {speaker(email.from)} <span className="muted">· {email.subject}</span>
      </div>
      <pre className="email__body">
        {quoted ? (
          <>
            {quoted[0]}
            <mark title="the sentence the blocked subgoal quotes">{quoted[1]}</mark>
            {quoted[2]}
          </>
        ) : (
          email.body
        )}
      </pre>
    </div>
  );
}

function ViolationCard({ violation }: { violation: Violation }) {
  const passed = violation.firewallDecision === "allow";
  return (
    <div className="blocked">
      <div className="blocked__head">
        <Pill tone="bad">
          <span className="blocked__word">BLOCKED</span>
        </Pill>
        <b className="mono">{violation.subgoalId}</b>
        <span className="muted">
          proposed by {violation.proposedBy || violation.actor}
          {violation.branch ? ` on branch ${violation.branch}` : ""} · t = {virtualSeconds(violation.ts)}
        </span>
      </div>
      {violation.objective && <blockquote className="blocked__ask">{violation.objective}</blockquote>}
      <div className="blocked__codes">
        {violation.codes.map((code) => (
          <Pill key={code} tone="bad" title={CODE_MEANING[code]}>
            {code}
          </Pill>
        ))}
        {violation.dataCategories.map((category) => (
          <Pill key={category} tone="warn" title="data category the subgoal touches">
            {category}
          </Pill>
        ))}
      </div>
      <ul className="blocked__reasons">
        {violation.reasons.map((reason) => (
          <li key={reason}>{reason}</li>
        ))}
      </ul>
      <div className="muted blocked__evidence">
        evidence: email <b className="mono">{violation.sourceId || "?"}</b> · firewall {violation.firewallDecision || "?"}
        {violation.score !== null ? ` (score ${violation.score.toFixed(2)}${violation.backend ? `, ${violation.backend}` : ""})` : ""}
        {passed ? " — it passed the firewall; the scope check caught it" : ""} · scope token <span className="mono">{violation.scopeToken.slice(0, 18)}</span>
      </div>
    </div>
  );
}

export function SecurityView({ view }: { view: ViewState }) {
  const { security } = view.panels;
  const statuses = emailStatuses(security);
  const flagged = statuses.filter((s) => s.verdict !== "clean");
  const clean = statuses.filter((s) => s.verdict === "clean");
  const [picked, setPicked] = useState<string | null>(null);
  const [showClean, setShowClean] = useState(false);
  const selected = statuses.find((s) => s.email.id === (picked ?? flagged[0]?.email.id)) ?? null;
  const quarantined = security.quarantines.length;
  const blocked = security.violations.length;
  const routedOut = security.routings.filter((r) => r.contributor).length;
  const hard = view.schedule.hardViolations;
  const unknown = unknownSources(security);

  // The audit trail: every decision that is not a plain "allowed" scan, oldest first.
  const trail = [
    ...security.policies.map((p) => ({ seq: p.seq, ts: p.ts, kind: "policy", tone: p.decision === "allow" ? "muted" : "warn", text: `${p.decision}${p.categories.length ? ` · ${p.categories.join(", ")}` : ""}${p.explanation ? `: ${p.explanation}` : ""}` })),
    ...security.scans.filter((s) => s.decision !== "allow").map((s) => ({ seq: s.seq, ts: s.ts, kind: `scan ${s.decision}`, tone: "bad", text: `${s.surface} ${s.sourceId} (${s.score.toFixed(2)}, ${s.backend}): ${s.reasons.join("; ") || "flagged"}` })),
    ...security.quarantines.map((q) => ({ seq: q.seq, ts: q.ts, kind: "quarantined", tone: "bad", text: `${q.surface} ${q.sourceId}: ${q.reason}` })),
    ...security.violations.map((v) => ({ seq: v.seq, ts: v.ts, kind: "scope violation", tone: "bad", text: `${v.subgoalId}: ${v.reasons.join("; ")}` })),
    ...security.approvals.map((a) => ({ seq: a.seq, ts: a.ts, kind: "scope approval", tone: "good", text: `${a.subgoalId} approved by ${a.approver}${a.reason ? `: ${a.reason}` : ""}` })),
    ...security.denied.map((d) => ({ seq: d.seq, ts: d.ts, kind: "tool denied", tone: "bad", text: `${d.tool}${d.target ? ` → ${d.target}` : ""}: ${d.reason}` })),
    ...security.routings.filter((r) => !r.contributor).map((r) => ({ seq: r.seq, ts: r.ts, kind: "routed: Standard", tone: "muted", text: `${r.requestId}: ${r.reason}` })),
  ].sort((a, b) => a.seq - b.seq);

  return (
    <div className="security">
      <section className={`panel security__banner ${attackSeen(security) ? "security__banner--contained" : ""}`}>
        <div className="security__title">
          {attackSeen(security) ? (
            <Pill tone="good">
              <span className="security__verdict">ATTACK CONTAINED</span>
            </Pill>
          ) : (
            <Pill tone="muted">
              <span className="security__verdict">no attack seen</span>
            </Pill>
          )}
          <div className="muted">
            {attackSeen(security)
              ? "The poisoned email never became work: the firewall or the scope check stopped it, and the audit says why."
              : "Every email was scanned and allowed, and every subgoal is a node of the approved plan."}
          </div>
        </div>
        <div className="pstats">
          <PStat label="emails scanned" value={security.scanned} />
          <PStat label="quarantined" value={quarantined} tone={quarantined > 0 ? "bad" : ""} title="the firewall replaced the email with a stub before any planner saw it" />
          <PStat label="subgoals blocked" value={blocked} tone={blocked > 0 ? "bad" : ""} title="scope.violation: the subgoal is not in the approved plan" />
          <PStat label="tools denied" value={security.denied.length} tone={security.denied.length > 0 ? "bad" : ""} />
          {security.routings.length > 0 && <PStat label="to Contributor" value={`${routedOut} / ${security.routings.length}`} title="security.routed: the firewall's routing decisions" />}
          {hard !== null && <PStat label="hard violations" value={hard} tone={hard === 0 ? "good" : "bad"} title="the schedule's checker: the attack did not change the result" />}
        </div>
      </section>

      <div className="security__cols">
        <Card title="1 · The emails" hint="what the planners were given">
          {statuses.length === 0 ? (
            <Nothing>This run carries no emails.</Nothing>
          ) : (
            <>
              <ul className="elist">
                {flagged.map((s) => (
                  <li key={s.email.id}>
                    <button className={`erow erow--${s.verdict} ${selected?.email.id === s.email.id ? "erow--on" : ""}`} onClick={() => setPicked(s.email.id)}>
                      <b className="mono">{s.email.id}</b> <span>{speaker(s.email.from)}</span>
                      <Pill tone={VERDICT[s.verdict].tone}>{VERDICT[s.verdict].label}</Pill>
                      {s.scan && s.scan.decision !== "allow" && <span className="muted">score {s.scan.score.toFixed(2)}</span>}
                    </button>
                  </li>
                ))}
                {flagged.length === 0 && <Nothing>No email was flagged.</Nothing>}
              </ul>
              {clean.length > 0 && (
                <button className="btn" onClick={() => setShowClean(!showClean)}>
                  {showClean ? "Hide" : "Show"} the {clean.length} allowed emails
                </button>
              )}
              {showClean && (
                <ul className="elist elist--clean">
                  {clean.map((s) => (
                    <li key={s.email.id}>
                      <button className={`erow ${selected?.email.id === s.email.id ? "erow--on" : ""}`} onClick={() => setPicked(s.email.id)}>
                        <b className="mono">{s.email.id}</b> <span>{speaker(s.email.from)}</span> <span className="muted">{clip(s.email.subject, 40)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {selected && (
                <>
                  <Subhead hint={VERDICT[selected.verdict].label}>The email</Subhead>
                  <EmailText status={selected} violations={selected.violations} />
                  {selected.verdict === "quarantined" && (
                    <div className="email__stub">
                      <Subhead hint="what a planner saw instead">Stub</Subhead>
                      <pre className="email__body">{security.quarantines.find((q) => q.sourceId === selected.email.id)?.stub ?? "(quarantined)"}</pre>
                      <div className="muted">{selected.scan?.reasons.join("; ")}</div>
                    </div>
                  )}
                </>
              )}
              {unknown.length > 0 && <div className="muted">Sources named by the audit but not in the corpus: {unknown.join(", ")}.</div>}
            </>
          )}
        </Card>

        <Card title="2 · The task split" hint="what the plan was approved to do, and what drifted">
          {blocked === 0 ? (
            <Nothing>No subgoal has been blocked.</Nothing>
          ) : (
            security.violations.map((v) => <ViolationCard key={v.seq} violation={v} />)
          )}
          {security.scope ? (
            <>
              <Subhead hint={`approved by ${security.scope.by} · token ${security.scope.token.slice(0, 14)}`}>Approved plan: {security.scope.nodes.length} nodes</Subhead>
              <table className="ptable">
                <tbody>
                  {security.scope.nodes.map((node) => (
                    <tr key={node.nodeId}>
                      <td className="mono">{node.nodeId}</td>
                      <td className="clip" title={node.objective}>{clip(node.objective, 70)}</td>
                      <td>{node.dataCategories.map((c) => <Pill key={c} tone="muted">{c}</Pill>)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <Nothing>The plan has not been approved yet.</Nothing>
          )}
        </Card>

        <Card title="3 · The audit" hint="every decision, with its reason">
          {trail.length === 0 ? (
            <Nothing>No decision beyond "allowed" has been logged. {security.scanned} emails scanned.</Nothing>
          ) : (
            <ol className="trail">
              {trail.map((entry) => (
                <li key={`${entry.kind}-${entry.seq}`} className={`trail__row trail__row--${entry.tone}`}>
                  <div>
                    <span className="mono muted">{entry.seq}</span> <b>{entry.kind}</b> <span className="muted">t = {virtualSeconds(entry.ts)}</span>
                  </div>
                  <div className="trail__text">{entry.text}</div>
                </li>
              ))}
            </ol>
          )}
          <div className="muted">
            {security.scanned - security.scans.filter((s) => s.decision !== "allow").length} scans allowed · {routedOut} routings to Contributor
          </div>
          <GenericRows rows={security.other} title="Security events this view does not read yet" />
        </Card>
      </div>
    </div>
  );
}

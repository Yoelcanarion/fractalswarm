import { Card, PageHeader } from "../components/ui";
import { REPO_URL } from "../lib/links";

/** New task on the static showcase. There is no server to read a text, so there is no form to fill in for nothing: only where the real one is. */
export function StaticIntake() {
  return (
    <div className="intake">
      <PageHeader
        className="intake__head"
        title="New task"
        lead="In the app you paste the talks and the emails or notes, and check each row against the text it came from. By default the run kills half the brains, and you get the finished program. This site only shows recorded runs, so that happens on your machine."
      />
      <Card title="Run it on your own text" className="staticnew">
        <ol className="staticnew__steps">
          <li>
            Get the code: <code>git clone {REPO_URL}</code>
          </li>
          <li>
            In its folder, start the app with <a href="https://docs.astral.sh/uv/">uv</a>: <code>uv run fractalswarm serve</code>
          </li>
          <li>Open New task there, and paste your text or use the sample.</li>
        </ol>
        <p className="muted">The practice reader and the practice model are free, need no key and stay on your machine. With Muse, which is billed, the text goes to Meta&rsquo;s model API, with email addresses replaced.</p>
        <div className="staticnew__actions">
          <a className="btn btn--on" href={REPO_URL}>
            Get the code
          </a>
          <a className="btn" href="#/arena">
            Watch a recorded pair
          </a>
        </div>
      </Card>
    </div>
  );
}

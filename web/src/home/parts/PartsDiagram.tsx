import { COPY } from "../copy";

const PITCH = 28;

/** The parts a better supervisor needs: itself, a standby, and something to watch both, over the workers.
 * `workers` is the number of agents of the running example, from the data. */
export function PartsDiagram({ workers }: { workers: number | null }) {
  const labels = COPY.problem.parts;
  const count = workers ?? 0;
  const left = 280 - (count * PITCH) / 2;
  return (
    <svg
      className="home-parts"
      viewBox="0 0 560 290"
      role="img"
      aria-label={`${labels.supervisor}, ${labels.standby} and ${labels.watcher}, above the ${labels.workers.toLowerCase()}.`}
    >
      <g className="home-parts__links">
        <path pathLength={1} d="M160 76 H210" />
        <path pathLength={1} d="M350 76 H400" />
        <path pathLength={1} d="M280 126 V176" />
        <path pathLength={1} d="M90 126 V176 H470 V126" />
      </g>
      {[
        { x: 20, label: labels.supervisor },
        { x: 210, label: labels.standby },
        { x: 400, label: labels.watcher },
      ].map((box) => (
        <g key={box.label} className="home-parts__box" transform={`translate(${box.x} 26)`}>
          <rect width="140" height="100" rx="16" />
          <circle cx="70" cy="40" r="12" />
          <circle cx="70" cy="40" r="19" className="home-parts__ring" />
          <text x="70" y="82" textAnchor="middle">
            {box.label}
          </text>
        </g>
      ))}
      <g className="home-parts__workers">
        {Array.from({ length: count }, (_, i) => (
          <rect key={i} x={left + i * PITCH + (PITCH - 14) / 2} y="214" width="14" height="14" rx="3" />
        ))}
        <text x="280" y="272" textAnchor="middle">
          {labels.workers}
        </text>
      </g>
    </svg>
  );
}

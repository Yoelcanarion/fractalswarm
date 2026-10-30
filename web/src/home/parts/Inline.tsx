import type { ReactNode } from "react";

/** The text of a markdown cell with its `code` spans drawn as code. Nothing else of markdown is read: the claims and the
 * assumptions use backticks and nothing else. Backticks that do not pair up stay as written. */
export function Inline({ text }: { text: string }): ReactNode {
  const parts = text.split("`");
  if (parts.length % 2 === 0) return text;
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <code key={i} className="home-code">
            {part}
          </code>
        ) : (
          part
        ),
      )}
    </>
  );
}

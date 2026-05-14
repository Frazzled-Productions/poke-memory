import { Fragment, type ReactNode } from "react";

// Minimal inline renderer for changelog bullets. Handles backtick code spans,
// Markdown links `[label](url)`, and bare `#NNN` GitHub issue/PR references.
// Anything outside those three forms renders as plain text.
export function BulletText({ text }: { text: string }) {
  return <>{renderInline(text)}</>;
}

const TOKEN_RE = /(`[^`]+`)|(\[[^\]]+\]\([^)]+\))|(\(#(\d+)\))/g;

function renderInline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;
  for (const match of text.matchAll(TOKEN_RE)) {
    const index = match.index ?? 0;
    if (index > lastIndex) out.push(text.slice(lastIndex, index));

    if (match[1]) {
      out.push(
        <code
          key={key++}
          className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-[0.85em] text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200"
        >
          {match[1].slice(1, -1)}
        </code>,
      );
    } else if (match[2]) {
      const labelEnd = match[2].indexOf("]");
      const label = match[2].slice(1, labelEnd);
      const url = match[2].slice(labelEnd + 2, -1);
      if (!/^https?:\/\//i.test(url)) {
        out.push(label);
      } else {
        out.push(
          <a
            key={key++}
            href={url}
            className="text-theme-primary underline underline-offset-2 hover:no-underline"
            rel="noreferrer"
            target="_blank"
          >
            {label}
          </a>,
        );
      }
    } else if (match[3]) {
      const num = match[4];
      out.push(
        <Fragment key={key++}>
          {"("}
          <a
            href={`https://github.com/fraserbrookhouse/poke-memory/issues/${num}`}
            className="text-theme-primary underline underline-offset-2 hover:no-underline"
            rel="noreferrer"
            target="_blank"
          >
            {`#${num}`}
          </a>
          {")"}
        </Fragment>,
      );
    }

    lastIndex = index + match[0].length;
  }
  if (lastIndex < text.length) out.push(text.slice(lastIndex));
  return out;
}

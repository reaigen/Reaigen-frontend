import * as React from "react";

import { cn } from "../lib/utils";

function inlineMarkup(text: string, keyPrefix: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_)/g);
  return parts.filter(Boolean).map((part, index) => {
    const key = `${keyPrefix}-${index}`;
    if ((part.startsWith("**") && part.endsWith("**")) || (part.startsWith("__") && part.endsWith("__"))) {
      return <strong key={key} className="font-semibold text-foreground">{part.slice(2, -2)}</strong>;
    }
    if ((part.startsWith("*") && part.endsWith("*")) || (part.startsWith("_") && part.endsWith("_"))) {
      return <em key={key}>{part.slice(1, -1)}</em>;
    }
    return <React.Fragment key={key}>{part}</React.Fragment>;
  });
}

export function FormattedDescription({ text, className }: { text: string; className?: string }) {
  const blocks = text.trim().split(/\n\s*\n/u).filter(Boolean);
  return (
    <div className={cn("space-y-[1.15em]", className)}>
      {blocks.map((block, blockIndex) => {
        const lines = block.split("\n");
        const list = lines.length > 0 && lines.every((line) => /^\s*[-*+]\s+/.test(line));
        if (list) {
          return (
            <ul key={`block-${blockIndex}`} className="list-disc space-y-1.5 pl-5 marker:text-foreground/35">
              {lines.map((line, lineIndex) => (
                <li key={`line-${lineIndex}`}>{inlineMarkup(line.replace(/^\s*[-*+]\s+/, ""), `b${blockIndex}-l${lineIndex}`)}</li>
              ))}
            </ul>
          );
        }
        return (
          <p key={`block-${blockIndex}`}>
            {lines.map((line, lineIndex) => (
              <React.Fragment key={`line-${lineIndex}`}>
                {lineIndex > 0 ? <br /> : null}
                {inlineMarkup(line, `b${blockIndex}-l${lineIndex}`)}
              </React.Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}

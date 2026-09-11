import * as React from "react";
import { cn } from "../utils";

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean;
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, error, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          "flex min-h-[80px] w-full resize-none rounded-xl border border-input bg-card px-4 py-3 text-sm text-foreground ring-offset-background",
          "placeholder:text-muted-foreground",
          "transition-[background-color,border-color,box-shadow] duration-150 hover:border-foreground/30",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className,
          error && "border-destructive focus-visible:border-destructive focus-visible:ring-destructive/30",
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Textarea.displayName = "Textarea";

export { Textarea };

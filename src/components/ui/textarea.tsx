import * as React from "react";

import { cn } from "@/lib/utils";

const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<"textarea">>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          "bevel-in flex min-h-[60px] w-full px-[3px] py-[2px] text-[11px] text-black placeholder:text-w95-shadow focus-visible:outline-none disabled:bg-w95-face disabled:text-w95-shadow",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Textarea.displayName = "Textarea";

export { Textarea };

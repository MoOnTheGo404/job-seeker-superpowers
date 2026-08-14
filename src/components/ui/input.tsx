import * as React from "react";

import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          // Sunken field: bevel-in, white well, square corners, no focus ring —
          // Win95 showed focus with the caret alone.
          "bevel-in flex min-h-[21px] w-full px-[3px] py-[2px] text-[11px] text-black file:border-0 file:bg-transparent file:text-[11px] file:text-black placeholder:text-w95-shadow focus-visible:outline-none disabled:bg-w95-face disabled:text-w95-shadow",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };

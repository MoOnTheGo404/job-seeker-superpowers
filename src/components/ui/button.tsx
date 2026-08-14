import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/*
 * Win95 controls have no hover state and no transition — they only change on
 * press, when the bevel inverts and the label shifts a pixel down-right. The
 * `active:bevel-pressed` utility does both.
 *
 * Disabled buttons don't fade; they get the embossed gray treatment (a white
 * shadow offset behind dark-gray text), which is what Win95 actually did.
 */
const w95Raised =
  "bevel-out text-black active:bevel-pressed disabled:text-w95-shadow disabled:[text-shadow:1px_1px_0_var(--w95-light)]";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap text-[11px] font-normal select-none focus-visible:outline focus-visible:outline-1 focus-visible:outline-dotted focus-visible:outline-black focus-visible:outline-offset-[-4px] disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:size-3.5 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: w95Raised,
        destructive: `${w95Raised} text-destructive`,
        outline: w95Raised,
        secondary: w95Raised,
        // The only genuinely flat control in the OS: toolbar-style text.
        ghost: "text-black hover:bg-w95-title hover:text-white disabled:text-w95-shadow",
        link: "text-[#0000ee] underline underline-offset-2 hover:text-[#551a8b]",
      },
      size: {
        default: "min-h-[23px] px-4 py-[3px]",
        sm: "min-h-[21px] px-3 py-[2px]",
        lg: "min-h-[27px] px-6 py-[5px]",
        icon: "size-[23px] p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };

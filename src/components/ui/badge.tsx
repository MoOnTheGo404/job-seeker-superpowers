import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center px-[5px] py-0 text-[10px] font-normal focus:outline-none",
  {
    variants: {
      variant: {
        default: "bevel-in-thin bg-w95-face text-black",
        // Reads like a selected list-row: navy fill, white text.
        secondary: "bg-w95-title text-white",
        destructive: "bevel-in-thin bg-w95-face text-destructive",
        outline: "bevel-in-thin bg-w95-face text-black",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };

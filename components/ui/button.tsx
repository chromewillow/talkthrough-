import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-medium tracking-[0.01em] transition-[color,background-color,border-color,box-shadow,opacity] duration-300 ease-out outline-none select-none disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
  {
    variants: {
      variant: {
        // The one warm thing on the page: reserved for the primary action.
        default:
          "bg-gold text-primary-foreground hover:bg-gold-bright hover:shadow-[0_0_48px_-14px_rgb(231_200_127/0.75)] active:bg-gold",
        outline:
          "border border-border bg-white/[0.015] text-soft-white hover:border-periwinkle/35 hover:bg-periwinkle/[0.07]",
        secondary: "bg-periwinkle/[0.09] text-soft-white hover:bg-periwinkle/[0.15]",
        ghost: "text-muted-foreground hover:bg-periwinkle/[0.07] hover:text-soft-white",
        link: "rounded-none px-0 text-periwinkle underline-offset-4 hover:text-soft-white hover:underline",
      },
      size: {
        default: "h-11 px-6",
        sm: "h-9 px-4 text-[0.8125rem]",
        lg: "h-12 px-8 text-[0.9375rem]",
        icon: "size-10",
        "icon-sm": "size-8",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : "button";
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

export { Button, buttonVariants };

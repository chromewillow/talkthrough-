"use client";

import * as React from "react";
import { Switch as SwitchPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer inline-flex h-[1.375rem] w-[2.375rem] shrink-0 cursor-pointer items-center rounded-full border border-input bg-white/[0.03] p-[3px] transition-colors duration-300 outline-none",
        "data-[state=checked]:border-gold/50 data-[state=checked]:bg-gold/15",
        "focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block size-3.5 rounded-full bg-muted-foreground transition-[transform,background-color] duration-300 data-[state=checked]:translate-x-4 data-[state=checked]:bg-gold"
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };

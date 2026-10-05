import * as React from "react";

import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "flex h-11 w-full min-w-0 rounded-xl border border-input bg-white/[0.02] px-4 text-[0.9375rem] text-soft-white transition-[border-color,background-color,box-shadow] duration-300 outline-none",
        "placeholder:text-faint selection:bg-gold/30",
        "hover:border-periwinkle/30 focus-visible:border-periwinkle/55 focus-visible:bg-white/[0.035] focus-visible:shadow-[0_0_0_4px_rgb(143_156_255/0.08)] focus-visible:outline-none",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "aria-invalid:border-destructive/60",
        "file:border-0 file:bg-transparent file:text-sm file:font-medium",
        className,
      )}
      {...props}
    />
  );
}

export { Input };

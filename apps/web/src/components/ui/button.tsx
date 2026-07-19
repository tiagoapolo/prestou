import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-bold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4",
  { variants: { variant: {
    default: "bg-primary text-primary-foreground hover:opacity-90",
    destructive: "bg-destructive text-white hover:opacity-90",
    outline: "border border-border bg-background hover:bg-muted",
    secondary: "bg-secondary text-secondary-foreground hover:opacity-85",
    ghost: "hover:bg-muted hover:text-foreground",
    link: "text-primary underline-offset-4 hover:underline",
  }, size: { default: "h-12 px-5 py-2", sm: "h-9 rounded-lg px-3", lg: "h-14 px-7", icon: "size-11 rounded-full" } }, defaultVariants: { variant: "default", size: "default" } },
);

function Button({ className, variant, size, asChild = false, ...props }: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}
export { Button, buttonVariants };

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { LoaderCircle } from "lucide-react";
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

interface ButtonProps extends React.ComponentProps<"button">, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
  loadingLabel?: React.ReactNode;
}

function Button({ className, variant, size, asChild = false, loading = false, loadingLabel, disabled, children, ...props }: ButtonProps) {
  const classes = cn(buttonVariants({ variant, size, className }));

  if (asChild) {
    return <Slot data-slot="button" className={classes} {...props}>{children}</Slot>;
  }

  return <button
    data-slot="button"
    data-loading={loading || undefined}
    className={classes}
    disabled={disabled || loading}
    aria-busy={loading || undefined}
    {...props}
  >
    {loading && <LoaderCircle className="animate-spin" aria-hidden="true" />}
    {loading ? loadingLabel ?? children : children}
  </button>;
}
export { Button, buttonVariants };

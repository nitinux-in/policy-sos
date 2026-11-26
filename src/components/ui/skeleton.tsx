import { cn } from "cn"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      // Custom radius tokens (rounded-card etc.) aren't merged by cn, so only add the default when none is given
      className={cn("animate-pulse bg-accent", !/\brounded-/.test(className ?? "") && "rounded-tile", className)}
      {...props}
    />
  )
}

export { Skeleton }

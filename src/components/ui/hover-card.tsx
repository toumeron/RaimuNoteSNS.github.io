import * as React from "react";
import * as HoverCardPrimitive from "@radix-ui/react-hover-card";
import { Slot } from "@radix-ui/react-slot";

import { cn } from "@/lib/utils";

const HoverCard = HoverCardPrimitive.Root;

const HoverCardTrigger = React.forwardRef<
  React.ElementRef<typeof HoverCardPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof HoverCardPrimitive.Trigger>
>(({ asChild, ...props }, ref) => {
  const [canHover, setCanHover] = React.useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(hover: hover)').matches,
  );
  React.useEffect(() => {
    const media = window.matchMedia('(hover: hover)');
    const update = () => setCanHover(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  // Radix's touchstart preventDefault runs in React's passive listener.
  // Touch-only devices keep the original link/click behavior without hover.
  if (!canHover) {
    return asChild ? <Slot ref={ref} {...props} /> : <a ref={ref} {...props} />;
  }
  return <HoverCardPrimitive.Trigger ref={ref} asChild={asChild} {...props} />;
});
HoverCardTrigger.displayName = HoverCardPrimitive.Trigger.displayName;

const HoverCardContent = React.forwardRef<
  React.ElementRef<typeof HoverCardPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof HoverCardPrimitive.Content>
>(({ className, align = "center", sideOffset = 4, ...props }, ref) => (
  <HoverCardPrimitive.Content
    ref={ref}
    align={align}
    sideOffset={sideOffset}
    className={cn(
      "z-50 w-64 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
      className,
    )}
    {...props}
  />
));
HoverCardContent.displayName = HoverCardPrimitive.Content.displayName;

export { HoverCard, HoverCardTrigger, HoverCardContent };

import * as React from "react";
import * as AvatarPrimitive from "@radix-ui/react-avatar";

import { cn } from "@/lib/utils";
import { SpaceIcon } from '@/components/spaces/SpaceIcon';
import { useSpaces } from '@/components/spaces/SpaceContext';

const Avatar = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Root> & { userId?: string }
>(({ className, userId, children, ...props }, ref) => {
  const { spaces, open } = useSpaces();
  const live = userId ? spaces.find(space => space.host_id === userId) : undefined;
  return (
  <AvatarPrimitive.Root
    ref={ref}
    className={cn("relative flex h-10 w-10 shrink-0 overflow-hidden rounded-full", className, live && 'lime-space-avatar')}
    {...props}
    {...(live ? {
      role: 'button', tabIndex: 0, 'aria-label': `${live.title}に参加`,
      onClick: (event: React.MouseEvent) => { event.preventDefault(); event.stopPropagation(); open(live.id); },
      onKeyDown: (event: React.KeyboardEvent) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); open(live.id); } },
    } : {})}
  >{children}{live && <span aria-hidden="true" className="lime-space-avatar-badge"><SpaceIcon /></span>}</AvatarPrimitive.Root>
); });
Avatar.displayName = AvatarPrimitive.Root.displayName;

const AvatarImage = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Image>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Image>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Image ref={ref} className={cn("aspect-square h-full w-full", className)} {...props} />
));
AvatarImage.displayName = AvatarPrimitive.Image.displayName;

const AvatarFallback = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Fallback>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Fallback>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Fallback
    ref={ref}
    className={cn("flex h-full w-full items-center justify-center rounded-full bg-muted", className)}
    {...props}
  />
));
AvatarFallback.displayName = AvatarPrimitive.Fallback.displayName;

export { Avatar, AvatarImage, AvatarFallback };

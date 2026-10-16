import * as React from "react";
import {isDeferredPrivateMedia,resolvePrivateMediaUrl} from "@/lib/privateMediaFetch";
import * as AvatarPrimitive from "@radix-ui/react-avatar";
import { cn } from "@/lib/utils";
import { SpaceIcon, useSpaces } from "@/components/spaces/SpaceProvider";

// twitterAvatar
/** Twitter's avatar suffix selects a thumbnail; omit it to use the uploaded image. */
function twitterAvatarUrl(value: string | undefined): string | undefined {
  if (!value) return value;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'pbs.twimg.com' || !url.pathname.startsWith('/profile_images/')) return value;
    url.pathname = url.pathname.replace(/_(?:normal|bigger|mini|\d+x\d+)(\.[a-z0-9]+)$/i, '$1');
    return url.href;
  } catch { return value; }
}

// avatar
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
>(({ className, ...props }, ref) => {
  const input=props.src,deferred=!!input&&isDeferredPrivateMedia(input);
  const [resolved,setResolved]=React.useState<{input:string;url:string|null}>();
  React.useEffect(()=>{
    if(!input||!deferred)return;
    let active=true;
    void resolvePrivateMediaUrl(input).then(url=>{if(active)setResolved({input,url});}).catch(()=>{if(active)setResolved({input,url:null});});
    return()=>{active=false;};
  },[input,deferred]);
  const src=deferred?(resolved?.input===input?resolved.url??undefined:undefined):input;
  return <AvatarPrimitive.Image ref={ref} className={cn("aspect-square h-full w-full", className)} {...props} src={twitterAvatarUrl(src)} referrerPolicy={props.referrerPolicy??(/^https:\/\/pbs[.]twimg[.]com\//.test(src??'')?'no-referrer':undefined)} />;
});
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

export { Avatar };
export { AvatarImage };
export { AvatarFallback };
export { twitterAvatarUrl };

import type {ComponentProps} from 'react';
import {DropdownMenuContent} from '@/components/ui/dropdown-menu';
export function ChatMenuContent({children,className='',...props}:ComponentProps<typeof DropdownMenuContent>){
 return <DropdownMenuContent {...props} className={`dm-chat-menu ${className}`}>{children}</DropdownMenuContent>;
}

import type {ComponentProps} from 'react';
import {X} from 'lucide-react';
import {DropdownMenuContent,DropdownMenuItem} from '@/components/ui/dropdown-menu';
export function ChatMenuContent({children,className='',...props}:ComponentProps<typeof DropdownMenuContent>){
 return <DropdownMenuContent {...props} className={`dm-chat-menu ${className}`}><DropdownMenuItem className="dm-mobile-menu-close"><X size={20}/>閉じる</DropdownMenuItem>{children}</DropdownMenuContent>;
}

import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import "dayjs/locale/ja";

// format
dayjs.extend(relativeTime);
dayjs.locale('ja');

const formatRelative = (iso: string) => dayjs(iso).fromNow();
const formatDate = (iso: string) => dayjs(iso).format('YYYY/MM/DD HH:mm');

// displayUsername
/** Presentation only: stored handles and profile routes retain their provider suffix. */
function displayUsername(username:string|null|undefined):string{
 return (username??'').replace(/@(?:twitter|x)\.com$/i,'');
}

export { formatRelative };
export { formatDate };
export { displayUsername };

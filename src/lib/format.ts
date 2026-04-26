import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/ja';

dayjs.extend(relativeTime);
dayjs.locale('ja');

export const formatRelative = (iso: string) => dayjs(iso).fromNow();
export const formatDate = (iso: string) => dayjs(iso).format('YYYY/MM/DD HH:mm');

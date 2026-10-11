import type { AssistantItem } from './aiFriends';
export type FriendCallUtterance = { name: string; content: string };
export const GROUP_CALL_LISTEN = '[LISTEN]';
export const GROUP_CALL_INSTRUCTION = '\nこれは複数の友達とユーザーによるグループ音声通話です。会話記録の話者名を区別し、先にユーザーと他の友達の発言を最後まで聞いてから、自分として発言してください。自分への呼びかけ、質問への回答、自分ならではの意見がある場合にだけ、自然な口調で1〜2文、120文字以内で話してください。他の人の回答の繰り返し、不要な相づち、全員への一律の返答は不要です。今は聞くだけでよい場合は [LISTEN] だけを返してください。他の参加者やユーザーの発言を代弁しないでください。';

/** Only one request and one spoken reply at a time; each next friend hears completed turns. */
export async function runGroupFriendTurn({ participants, history, userName, text, signal, ask, speak }: {
  participants: AssistantItem[]; history: FriendCallUtterance[]; userName: string; text: string; signal: AbortSignal;
  ask: (friend: AssistantItem, history: FriendCallUtterance[], signal: AbortSignal) => Promise<string>;
  speak: (friend: AssistantItem, reply: string, signal: AbortSignal) => Promise<void>;
}) {
  if (signal.aborted) return;
  history.push({ name: userName, content: text });
  for (const friend of participants) {
    if (signal.aborted) return;
    const reply = (await ask(friend, history.slice(-20).map(turn => ({ ...turn })), signal)).trim();
    if (signal.aborted) return;
    if (!reply || reply === GROUP_CALL_LISTEN) continue;
    await speak(friend, reply, signal);
    if (signal.aborted) return;
    history.push({ name: friend.name, content: reply });
    if (history.length > 40) history.splice(0, history.length - 40);
  }
}

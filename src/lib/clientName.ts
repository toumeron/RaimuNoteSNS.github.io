/** Device platform available to the web client; do not guess a hardware model. */
export function getClientName(userAgent = navigator.userAgent, maxTouchPoints = navigator.maxTouchPoints): string {
  let device = 'Web';
  if (/iPhone/i.test(userAgent)) device = 'iPhone';
  else if (/iPad/i.test(userAgent) || (/Macintosh/i.test(userAgent) && maxTouchPoints > 1)) device = 'iPad';
  else if (/Android/i.test(userAgent)) device = 'Android';
  else if (/Windows/i.test(userAgent)) device = 'Windows';
  else if (/Macintosh|Mac OS X/i.test(userAgent)) device = 'Mac';
  else if (/Linux/i.test(userAgent)) device = 'Linux';
  return `LimeNote for ${device}`;
}

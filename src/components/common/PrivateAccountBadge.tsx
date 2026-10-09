export function PrivateAccountBadge({ className = 'h-4 w-4' }: { className?: string }) {
  return <svg role="img" aria-label="非公開アカウント" viewBox="0 0 24 24" className={`inline-block shrink-0 text-current ${className}`}>
    <path fillRule="evenodd" fill="currentColor" d="M6 8.5V6a6 6 0 0 1 12 0v2.5c2.4.7 4 2.7 4 5.5v4a6 6 0 0 1-6 6H8a6 6 0 0 1-6-6v-4c0-2.8 1.6-4.8 4-5.5Zm2.5-.5h7V6a3.5 3.5 0 0 0-7 0v2ZM9 14v2.5h6V14H9Z" />
  </svg>;
}

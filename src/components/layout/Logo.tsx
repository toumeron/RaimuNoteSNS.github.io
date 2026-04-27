import { Heart } from 'lucide-react';
import { Link } from 'react-router-dom';

export function Logo({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const sizes = {
    sm: { text: 'text-lg', icon: 'h-5 w-5' },
    md: { text: 'text-2xl', icon: 'h-6 w-6' },
    lg: { text: 'text-4xl', icon: 'h-9 w-9' },
  } as const;
  const s = sizes[size];
  return (
    <Link to="/" className="inline-flex items-center gap-2 font-display font-black">
      <span className={`${s.text} bg-gradient-primary bg-clip-text text-transparent`}>
        Laime
      </span>
      <span className={`${s.text} text-accent`}>Note</span>
    </Link>
  );
}

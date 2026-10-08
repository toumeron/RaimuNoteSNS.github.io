import { Star } from 'lucide-react';

export function ReviewStars({ value }: { value: number }) {
  return <span className="inline-flex shrink-0 text-orange-500" role="img" aria-label={`5つ星のうち${value}`}>
    {[1,2,3,4,5].map(star => <span key={star} className="relative h-5 w-5">
      <Star className="absolute inset-0 h-5 w-5" />
      <span className="absolute inset-y-0 left-0 overflow-hidden" style={{width:`${Math.max(0, Math.min(1, value-star+1))*100}%`}}>
        <Star className="h-5 w-5 fill-current" />
      </span>
    </span>)}
  </span>;
}


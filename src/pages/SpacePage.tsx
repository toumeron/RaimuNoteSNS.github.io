import { useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { useSpaces } from '@/components/spaces/SpaceContext';
export default function SpacePage() {
  const { id } = useParams();
  const spaces = useSpaces();
  const opened = useRef<string>();
  useEffect(() => {
    if (id && opened.current !== id) { opened.current = id; if (id === 'new') spaces.create(); else spaces.open(id); }
  }, [id, spaces]);
  return <div className="p-6"><h1 className="text-xl font-bold">スペース</h1><button className="mt-4 text-primary" onClick={() => id === 'new' ? spaces.create() : spaces.open(id!)}>スペースを開く</button></div>;
}

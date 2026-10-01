// Local regression harness: renders the production voice UI without an account or AI request.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from 'next-themes';
import { VoiceMode, VrmStage, LipSync, createBus, CHAT_EXT_STYLES, VPOP_STYLES } from '../../src/pages/ChatPage';
import '../../src/index.css';
import * as THREE from 'three';

THREE.Scene.prototype.onBeforeRender = function(renderer, scene, camera) {
  (window as any).avatarScene = { scene, camera, renderer };
};

const bus = createBus(new LipSync());
function Harness() {
  const [open, setOpen] = useState(true);
  const [source, setSource] = useState<any>(null);
  const [camera, setCamera] = useState<any>('full');
  const [night, setNight] = useState(false);
  Object.assign(window, { avatarHarness: {
    bus, setSource, setCamera, setNight,
    projectedBounds: () => {
      const { scene, camera } = (window as any).avatarScene;
      const box = new THREE.Box3().setFromObject(scene, true);
      const points: THREE.Vector3[] = [];
      for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) points.push(new THREE.Vector3(x, y, z).project(camera));
      return { minX: Math.min(...points.map((p) => p.x)), maxX: Math.max(...points.map((p) => p.x)), minY: Math.min(...points.map((p) => p.y)), maxY: Math.max(...points.map((p) => p.y)) };
    },
    show: () => { setSource(null); setOpen(true); },
    hide: () => { setSource(null); setOpen(false); },
  } });
  return <ThemeProvider attribute="class" defaultTheme="light">
    <div className="vpop-root" style={{ height: '100vh', position: 'relative' }}>
      <style>{VPOP_STYLES}</style><style>{CHAT_EXT_STYLES}</style>
      {source ? <VrmStage source={source} bus={bus} camera={camera} night={night} onStatus={(s) => { (window as any).avatarStatus = s; }} /> :
        open ? <VoiceMode onClose={() => setOpen(false)} onAsk={async () => 'こんにちは。ありがとう。今日も楽しくお話ししましょう。'} /> :
        <button onClick={() => setOpen(true)}>ボイスを再開</button>}
    </div>
  </ThemeProvider>;
}
createRoot(document.getElementById('root')!).render(<Harness />);

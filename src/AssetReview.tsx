import React, { useState } from 'react';
import { Stage3D } from './components/Stage3D';
import { MONEY_VALUES, BoxData } from './types/game';

// Development-only public specimens, never a game-state or hidden-value inspector.
export default function AssetReview() {
  const count = 26;
  const [opened, setOpened] = useState<number[]>([]);
  const [sample, setSample] = useState({ fps: 0, calls: 0, triangles: 0 });
  const values = [Math.max(...MONEY_VALUES), 750000, 1000, 1];
  const boxes: BoxData[] = Array.from({ length: count }, (_, i) => {
    const isOpened = opened.includes(i + 1);
    const value = values[i % values.length];
    if (isOpened) {
      return {
        id: i + 1,
        value,
        revealedAmount: value,
        isPlayerBox: false,
        isOpened: true,
      };
    }
    return {
      id: i + 1,
      isPlayerBox: false,
      isOpened: false,
    };
  });
  return <main style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
    <div style={{ padding: 12, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
      <strong>资产预览 · 公开示例金额</strong>
      <span>26 箱正式布局</span>
      <button onClick={() => setOpened(boxes.map(b => b.id))}>全部打开</button>
      <button onClick={() => setOpened([])}>全部关闭</button>
      <output aria-label="渲染采样">5 秒采样：{sample.fps} FPS · {sample.calls} calls · {sample.triangles} triangles</output>
    </div>
    <div style={{ flex: 1, minHeight: 0 }}><Stage3D boxes={boxes} playerBoxId={null} phase="OPEN_BOXES" fastMode={false} onPerformance={setSample} onBoxClick={id => setOpened(ids => [...ids, id])} /></div>
  </main>;
}

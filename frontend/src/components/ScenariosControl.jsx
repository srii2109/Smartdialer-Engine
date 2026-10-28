import React from 'react';
import { Cpu } from 'lucide-react';

export default function ScenariosControl({ onRunScenario }) {
  return (
    <div style={{ background: '#111827', padding: 14, borderRadius: 12, border: '1px solid #1f2937' }}>
      <h3 style={{ margin: '0 0 10px 0', fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
        <Cpu size={16} color="#818cf8" />
        Assignment Pacing Scenarios
      </h3>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <button
          onClick={() => onRunScenario('A')}
          style={{
            background: '#1f2937',
            border: '1px solid #374151',
            color: '#f3f4f6',
            padding: 8,
            borderRadius: 6,
            fontSize: 11,
            cursor: 'pointer',
            textAlign: 'left',
            transition: 'border-color 0.15s ease'
          }}
        >
          <b style={{ color: '#60a5fa' }}>Scenario A</b><br />
          20% Answer | 120s Talk
        </button>

        <button
          onClick={() => onRunScenario('B')}
          style={{
            background: '#1f2937',
            border: '1px solid #374151',
            color: '#f3f4f6',
            padding: 8,
            borderRadius: 6,
            fontSize: 11,
            cursor: 'pointer',
            textAlign: 'left',
            transition: 'border-color 0.15s ease'
          }}
        >
          <b style={{ color: '#34d399' }}>Scenario B</b><br />
          50% Answer | 90s Talk
        </button>

        <button
          onClick={() => onRunScenario('C')}
          style={{
            background: '#1f2937',
            border: '1px solid #374151',
            color: '#f3f4f6',
            padding: 8,
            borderRadius: 6,
            fontSize: 11,
            cursor: 'pointer',
            textAlign: 'left',
            transition: 'border-color 0.15s ease'
          }}
        >
          <b style={{ color: '#f59e0b' }}>Scenario C</b><br />
          70% Answer | 180s Talk
        </button>

        <button
          onClick={() => onRunScenario('D')}
          style={{
            background: '#1f2937',
            border: '1px solid #374151',
            color: '#f3f4f6',
            padding: 8,
            borderRadius: 6,
            fontSize: 11,
            cursor: 'pointer',
            textAlign: 'left',
            transition: 'border-color 0.15s ease'
          }}
        >
          <b style={{ color: '#c084fc' }}>Scenario D</b><br />
          Dynamic / Chaos Mode
        </button>
      </div>
    </div>
  );
}

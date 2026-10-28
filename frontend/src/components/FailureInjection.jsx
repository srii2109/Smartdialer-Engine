import React from 'react';
import { AlertTriangle } from 'lucide-react';

export default function FailureInjection({ onInjectFailure }) {
  return (
    <div style={{ background: '#111827', padding: 14, borderRadius: 12, border: '1px solid #1f2937' }}>
      <h3 style={{ margin: '0 0 10px 0', fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
        <AlertTriangle size={16} color="#ef4444" />
        Failure Injection Tests
      </h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <button
          onClick={() => onInjectFailure('worker_crash')}
          style={{
            background: '#1f2937',
            border: '1px solid #ef4444',
            color: '#fca5a5',
            padding: '6px 10px',
            borderRadius: 6,
            fontSize: 11,
            cursor: 'pointer',
            textAlign: 'left',
            transition: 'background 0.15s ease'
          }}
        >
          ⚡ <b>Worker Crash Recovery:</b> Orphans call &amp; triggers sweeper
        </button>

        <button
          onClick={() => onInjectFailure('provider_outage')}
          style={{
            background: '#1f2937',
            border: '1px solid #f59e0b',
            color: '#fde047',
            padding: '6px 10px',
            borderRadius: 6,
            fontSize: 11,
            cursor: 'pointer',
            textAlign: 'left',
            transition: 'background 0.15s ease'
          }}
        >
          ⚠️ <b>Provider Outage:</b> Simulates telecom gateway failure
        </button>

        <button
          onClick={() => onInjectFailure('duplicate_event')}
          style={{
            background: '#1f2937',
            border: '1px solid #374151',
            color: '#d1d5db',
            padding: '6px 10px',
            borderRadius: 6,
            fontSize: 11,
            cursor: 'pointer',
            textAlign: 'left',
            transition: 'background 0.15s ease'
          }}
        >
          🔄 <b>Duplicate Webhook:</b> Tests idempotency suppression
        </button>

        <button
          onClick={() => onInjectFailure('out_of_order')}
          style={{
            background: '#1f2937',
            border: '1px solid #374151',
            color: '#d1d5db',
            padding: '6px 10px',
            borderRadius: 6,
            fontSize: 11,
            cursor: 'pointer',
            textAlign: 'left',
            transition: 'background 0.15s ease'
          }}
        >
          🔀 <b>Out-of-Order Webhooks:</b> Tests monotonic precedence
        </button>
      </div>
    </div>
  );
}

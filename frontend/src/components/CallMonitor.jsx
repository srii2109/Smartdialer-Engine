import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Radio, AlertCircle } from 'lucide-react';

const CALL_BADGES = {
  INITIATED: {
    label: 'Initiated',
    dot: '#60a5fa',
    bg: 'rgba(59, 130, 246, 0.1)',
    text: '#93c5fd',
    border: 'rgba(59, 130, 246, 0.3)'
  },
  RINGING: {
    label: 'Ringing',
    dot: '#f59e0b',
    bg: 'rgba(245, 158, 11, 0.1)',
    text: '#fde047',
    border: 'rgba(245, 158, 11, 0.3)',
    pulse: true
  },
  ANSWERED: {
    label: 'Answered',
    dot: '#10b981',
    bg: 'rgba(16, 185, 129, 0.1)',
    text: '#6ee7b7',
    border: 'rgba(16, 185, 129, 0.3)'
  },
  CONNECTED: {
    label: 'Connected',
    dot: '#a855f7',
    bg: 'rgba(168, 85, 247, 0.12)',
    text: '#c084fc',
    border: 'rgba(168, 85, 247, 0.35)',
    pulse: true
  },
  COMPLETED: {
    label: 'Completed',
    dot: '#34d399',
    bg: 'rgba(52, 211, 153, 0.1)',
    text: '#34d399',
    border: 'rgba(52, 211, 153, 0.3)'
  },
  FAILED: {
    label: 'Failed',
    dot: '#ef4444',
    bg: 'rgba(239, 68, 68, 0.1)',
    text: '#fca5a5',
    border: 'rgba(239, 68, 68, 0.3)'
  },
  CANCELLED: {
    label: 'Cancelled',
    dot: '#9ca3af',
    bg: 'rgba(156, 163, 175, 0.1)',
    text: '#9ca3af',
    border: 'rgba(156, 163, 175, 0.3)'
  }
};

export default function CallMonitor({ calls }) {
  const [filter, setFilter] = useState('ALL');

  const filteredCalls = (calls || []).filter((c) => {
    if (filter === 'ACTIVE') return ['INITIATED', 'RINGING', 'ANSWERED', 'CONNECTED'].includes(c.state);
    if (filter === 'COMPLETED') return c.state === 'COMPLETED';
    if (filter === 'FAILED') return c.state === 'FAILED';
    return true;
  });

  return (
    <div className="glass-panel" style={{
      borderRadius: 16,
      padding: 20,
      display: 'flex',
      flexDirection: 'column',
      gap: 14
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8, color: '#f8fafc' }}>
            <Radio size={18} color="#f59e0b" />
            Live Calls &amp; Telephony Stream
            <span style={{ fontSize: 12, color: '#94a3b8', fontWeight: 500 }}>
              ({calls?.length || 0} events)
            </span>
          </h3>
          <p style={{ margin: '2px 0 0', fontSize: 12, color: '#64748b' }}>
            Monotonic state precedence and duplicate event suppression active.
          </p>
        </div>

        {/* Quick Filter */}
        <div style={{ display: 'flex', gap: 6 }}>
          {[
            { id: 'ALL', label: 'All' },
            { id: 'ACTIVE', label: 'In Flight' },
            { id: 'COMPLETED', label: 'Completed' },
            { id: 'FAILED', label: 'Failed' }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setFilter(tab.id)}
              style={{
                background: filter === tab.id ? '#1e293b' : 'transparent',
                color: filter === tab.id ? '#f8fafc' : '#94a3b8',
                border: filter === tab.id ? '1px solid #475569' : '1px solid rgba(255, 255, 255, 0.08)',
                padding: '4px 10px',
                borderRadius: 8,
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.15s ease'
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Calls Stream List */}
      <div style={{
        maxHeight: 520,
        overflowY: 'auto',
        paddingRight: 4,
        display: 'flex',
        flexDirection: 'column',
        gap: 8
      }}>
        <AnimatePresence initial={false}>
          {filteredCalls.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: '#64748b', fontSize: 13 }}>
              No calls matching the current filter.
            </div>
          ) : (
            filteredCalls.map((c) => {
              const badge = CALL_BADGES[c.state] || {
                label: c.state,
                dot: '#9ca3af',
                bg: '#1f2937',
                text: '#f3f4f6',
                border: '#374151'
              };

              const isLive = ['INITIATED', 'RINGING', 'ANSWERED', 'CONNECTED'].includes(c.state);

              return (
                <motion.div
                  key={c.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.2 }}
                  style={{
                    background: isLive ? 'rgba(30, 58, 138, 0.25)' : 'rgba(15, 23, 42, 0.7)',
                    padding: '12px 14px',
                    borderRadius: 10,
                    border: isLive ? '1px solid rgba(59, 130, 246, 0.4)' : '1px solid rgba(255, 255, 255, 0.06)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                    transition: 'border-color 0.2s ease'
                  }}
                >
                  {/* Call Header */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: '#f8fafc' }}>{c.id}</span>
                      <span style={{ fontSize: 10, color: '#64748b' }}>({c.mode || 'PROGRESSIVE'})</span>
                    </div>

                    <span style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      fontSize: 11,
                      fontWeight: 700,
                      padding: '2px 9px',
                      borderRadius: 6,
                      background: badge.bg,
                      color: badge.text,
                      border: `1px solid ${badge.border}`
                    }}>
                      <span style={{ position: 'relative', display: 'flex', width: 6, height: 6 }}>
                        {badge.pulse && (
                          <span style={{
                            position: 'absolute',
                            inset: 0,
                            borderRadius: '50%',
                            backgroundColor: badge.dot,
                            animation: 'beaconPulse 1.6s infinite'
                          }} />
                        )}
                        <span style={{
                          position: 'relative',
                          width: 6,
                          height: 6,
                          borderRadius: '50%',
                          backgroundColor: badge.dot
                        }} />
                      </span>
                      {badge.label}
                    </span>
                  </div>

                  {/* Details */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#cbd5e1' }}>
                    <span>Borrower: <b style={{ color: '#f8fafc' }}>{c.borrower_name || c.borrower_id}</b></span>
                    <span>
                      Agent:{' '}
                      {c.agent_id ? (
                        <b style={{ color: '#818cf8' }}>{c.agent_id}</b>
                      ) : (
                        <i style={{ color: '#64748b' }}>Pending Assignment</i>
                      )}
                    </span>
                  </div>

                  {/* Error Alert if any */}
                  {c.error_reason && (
                    <div style={{
                      fontSize: 11,
                      color: '#f87171',
                      background: 'rgba(239, 68, 68, 0.1)',
                      border: '1px solid rgba(239, 68, 68, 0.25)',
                      padding: '4px 8px',
                      borderRadius: 6,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6
                    }}>
                      <AlertCircle size={12} />
                      <span>{c.error_reason}</span>
                    </div>
                  )}
                </motion.div>
              );
            })
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

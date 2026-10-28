import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShieldCheck, ArrowRight } from 'lucide-react';

export default function SafetyAuditLog({ logs, onNavigateToCompliance }) {
  return (
    <div className="glass-panel" style={{
      borderRadius: 16,
      padding: 20,
      display: 'flex',
      flexDirection: 'column',
      gap: 14
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8, color: '#f8fafc' }}>
            <ShieldCheck size={18} color="#a855f7" />
            Safety Gatekeeper Decisions
          </h3>
          <p style={{ margin: '2px 0 0', fontSize: 12, color: '#64748b' }}>
            Non-bypassable compliance gate evaluations.
          </p>
        </div>

        {onNavigateToCompliance && (
          <button
            onClick={onNavigateToCompliance}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#818cf8',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              transition: 'color 0.15s ease'
            }}
          >
            Full Trail <ArrowRight size={13} />
          </button>
        )}
      </div>

      <div style={{
        maxHeight: 520,
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        paddingRight: 4
      }}>
        <AnimatePresence initial={false}>
          {(!logs || logs.length === 0) ? (
            <div style={{ color: '#64748b', fontSize: 12, textAlign: 'center', padding: '36px 0' }}>
              No decisions logged yet. Start the dialer to begin compliance evaluations.
            </div>
          ) : (
            logs.slice(0, 15).map((log) => {
              const isApproved = log.decision === 'APPROVED';
              const isReduced = log.decision === 'REDUCED';
              const borderColor = isApproved ? '#10b981' : isReduced ? '#f59e0b' : '#ef4444';
              const textColor = isApproved ? '#34d399' : isReduced ? '#fbbf24' : '#f87171';
              const bgBadge = isApproved
                ? 'rgba(16, 185, 129, 0.12)'
                : isReduced
                ? 'rgba(245, 158, 11, 0.12)'
                : 'rgba(239, 68, 68, 0.12)';

              return (
                <motion.div
                  key={log.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2 }}
                  style={{
                    background: 'rgba(15, 23, 42, 0.7)',
                    padding: '11px 14px',
                    borderRadius: 10,
                    fontSize: 11,
                    border: '1px solid rgba(255, 255, 255, 0.06)',
                    borderLeft: `3px solid ${borderColor}`,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 5
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{
                      color: textColor,
                      fontWeight: 800,
                      background: bgBadge,
                      padding: '2px 8px',
                      borderRadius: 4
                    }}>
                      {log.decision}
                    </span>
                    <span style={{ color: '#94a3b8', fontSize: 11 }}>
                      Approved: <b style={{ color: '#f8fafc' }}>{log.approved_calls ?? log.approvedCalls}</b> / {log.requested_calls ?? log.requestedCalls}
                    </span>
                    <span style={{ color: '#64748b', fontSize: 10 }}>
                      {log.timestamp || `#${log.id}`}
                    </span>
                  </div>
                  <div style={{ color: '#cbd5e1', fontSize: 11, marginTop: 2, lineHeight: 1.4 }}>
                    {log.reason}
                  </div>
                </motion.div>
              );
            })
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

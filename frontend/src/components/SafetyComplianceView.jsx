import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { ShieldCheck, ShieldAlert, Server } from 'lucide-react';

export default function SafetyComplianceView({ status, logs }) {
  const [filter, setFilter] = useState('ALL');

  const abandonmentPct = status?.abandonmentRatePct ?? 0;
  const isCompliant = abandonmentPct <= 3.0;
  const provider = status?.providerHealth;

  const filteredLogs = (logs || []).filter((l) => {
    if (filter === 'APPROVED') return l.decision === 'APPROVED';
    if (filter === 'REDUCED') return l.decision === 'REDUCED';
    if (filter === 'REJECTED') return l.decision === 'REJECTED' || l.decision === 'FORCED_PROGRESSIVE';
    return true;
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      
      {/* Top Row: Compliance Metrics & Provider Health */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
        
        {/* Compliance Meter */}
        <div className="glass-panel" style={{
          borderRadius: 16,
          padding: 22,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          position: 'relative',
          overflow: 'hidden'
        }}>
          <div style={{
            position: 'absolute',
            top: 0,
            right: 0,
            width: 100,
            height: 100,
            background: isCompliant
              ? 'radial-gradient(circle at top right, rgba(16, 185, 129, 0.2), transparent 70%)'
              : 'radial-gradient(circle at top right, rgba(239, 68, 68, 0.2), transparent 70%)',
            pointerEvents: 'none'
          }} />

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', letterSpacing: '0.05em' }}>
                REGULATORY COMPLIANCE MONITOR
              </span>
              <h3 style={{ margin: '4px 0 0', fontSize: 20, fontWeight: 800, color: isCompliant ? '#34d399' : '#f87171' }}>
                {isCompliant ? 'Strictly Compliant (FCC / FTC)' : 'Threshold Breach Detected'}
              </h3>
            </div>
            <div style={{
              background: isCompliant ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
              padding: 12,
              borderRadius: 12,
              border: `1px solid ${isCompliant ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`
            }}>
              {isCompliant ? <ShieldCheck size={26} color="#10b981" /> : <ShieldAlert size={26} color="#ef4444" />}
            </div>
          </div>

          <div style={{ marginTop: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 8 }}>
              <span style={{ color: '#cbd5e1' }}>Current Abandonment Rate:</span>
              <span style={{ fontWeight: 800, color: isCompliant ? '#34d399' : '#f87171' }}>
                {abandonmentPct}% <span style={{ fontSize: 11, color: '#64748b', fontWeight: 500 }}>(Ceiling: 3.00%)</span>
              </span>
            </div>
            <div style={{ width: '100%', height: 8, background: 'rgba(30, 41, 59, 0.8)', borderRadius: 4, overflow: 'hidden' }}>
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${Math.min(100, (abandonmentPct / 3.0) * 100)}%` }}
                transition={{ duration: 0.8, ease: 'easeOut' }}
                style={{
                  height: '100%',
                  background: isCompliant
                    ? 'linear-gradient(90deg, #10b981, #34d399)'
                    : 'linear-gradient(90deg, #f59e0b, #ef4444)',
                  borderRadius: 4
                }}
              />
            </div>
          </div>

          <p style={{ margin: '14px 0 0', fontSize: 11, color: '#94a3b8', lineHeight: 1.5 }}>
            The Safety Controller acts as an automated non-bypassable circuit breaker that instantly caps or forces Progressive (1:1) mode if abandonment risk rises.
          </p>
        </div>

        {/* Active Provider Health */}
        <div className="glass-panel" style={{
          borderRadius: 16,
          padding: 22,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', letterSpacing: '0.05em' }}>
                TELECOM GATEWAY HEALTH
              </span>
              <h3 style={{ margin: '4px 0 0', fontSize: 20, fontWeight: 800, color: '#f8fafc' }}>
                {provider?.providerId || status?.activeProvider}
              </h3>
            </div>
            <div style={{
              background: 'rgba(99, 102, 241, 0.15)',
              padding: 12,
              borderRadius: 12,
              border: '1px solid rgba(99, 102, 241, 0.3)'
            }}>
              <Server size={26} color="#818cf8" />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 18 }}>
            <div style={{ background: 'rgba(15, 23, 42, 0.7)', padding: 12, borderRadius: 10, border: '1px solid rgba(255, 255, 255, 0.06)' }}>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>Carrier Latency</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: '#f8fafc', marginTop: 2 }}>
                {provider?.avgLatencyMs || 0} ms
              </div>
            </div>
            <div style={{ background: 'rgba(15, 23, 42, 0.7)', padding: 12, borderRadius: 10, border: '1px solid rgba(255, 255, 255, 0.06)' }}>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>Success Health</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: provider?.isHealthy ? '#34d399' : '#f87171', marginTop: 2 }}>
                {provider?.healthPct || 100}%
              </div>
            </div>
          </div>

          <div style={{
            marginTop: 14,
            fontSize: 11,
            color: provider?.outageActive ? '#f87171' : '#34d399',
            display: 'flex',
            alignItems: 'center',
            gap: 6
          }}>
            <span style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              backgroundColor: provider?.outageActive ? '#ef4444' : '#10b981'
            }} />
            {provider?.outageActive ? 'Outage simulation active — Dispatches throttled' : 'Provider status healthy & reachable'}
          </div>
        </div>

      </div>

      {/* Bottom Section: Audit Log Table */}
      <div className="glass-panel" style={{
        borderRadius: 16,
        padding: 22,
        display: 'flex',
        flexDirection: 'column',
        gap: 16
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8, color: '#f8fafc' }}>
              <ShieldCheck size={18} color="#a855f7" />
              Safety Controller Audit Trail (MySQL)
            </h3>
            <p style={{ margin: '2px 0 0', fontSize: 12, color: '#64748b' }}>
              Every evaluation cycle writes an immutable audit record with requested vs approved calls and justifications.
            </p>
          </div>

          <div style={{ display: 'flex', gap: 6 }}>
            {[
              { id: 'ALL', label: 'All Decisions' },
              { id: 'APPROVED', label: 'Approved' },
              { id: 'REDUCED', label: 'Reduced' },
              { id: 'REJECTED', label: 'Blocked / Fallback' }
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setFilter(tab.id)}
                style={{
                  background: filter === tab.id ? '#1e293b' : 'transparent',
                  color: filter === tab.id ? '#f8fafc' : '#94a3b8',
                  border: filter === tab.id ? '1px solid #475569' : '1px solid rgba(255, 255, 255, 0.08)',
                  padding: '5px 12px',
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

        <div style={{ maxHeight: 420, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filteredLogs.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '36px 0', color: '#64748b', fontSize: 13 }}>
              No audit logs recorded for this filter.
            </div>
          ) : (
            filteredLogs.map((log) => {
              const isApproved = log.decision === 'APPROVED';
              const isReduced = log.decision === 'REDUCED';
              const borderCol = isApproved ? '#10b981' : isReduced ? '#f59e0b' : '#ef4444';
              const textCol = isApproved ? '#34d399' : isReduced ? '#fbbf24' : '#f87171';

              return (
                <div
                  key={log.id}
                  style={{
                    background: 'rgba(15, 23, 42, 0.7)',
                    border: '1px solid rgba(255, 255, 255, 0.06)',
                    borderLeft: `4px solid ${borderCol}`,
                    borderRadius: 10,
                    padding: '11px 16px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 5
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 12, fontWeight: 800, color: textCol }}>
                        {log.decision}
                      </span>
                      <span style={{ fontSize: 11, color: '#94a3b8' }}>
                        Approved: <b style={{ color: '#f8fafc' }}>{log.approved_calls ?? log.approvedCalls}</b> / Requested:{' '}
                        <b>{log.requested_calls ?? log.requestedCalls}</b>
                      </span>
                      <span style={{
                        fontSize: 10,
                        padding: '2px 7px',
                        borderRadius: 4,
                        background: '#1e293b',
                        color: '#93c5fd'
                      }}>
                        {log.mode}
                      </span>
                    </div>
                    <span style={{ fontSize: 11, color: '#64748b' }}>
                      {log.timestamp}
                    </span>
                  </div>

                  <div style={{ fontSize: 12, color: '#cbd5e1' }}>
                    {log.reason}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

    </div>
  );
}

import React from 'react';
import { motion } from 'framer-motion';
import { Server, Lock } from 'lucide-react';

export default function PipelineDiagram({ status }) {
  if (!status) return null;

  const isPredictive = status.mode === 'PREDICTIVE';
  const lastDecision = status.lastSafetyDecision;
  const providerHealth = status.providerHealth;

  const decisionBadgeStyle = (() => {
    if (!lastDecision) return { bg: 'rgba(51, 65, 85, 0.4)', text: '#94a3b8', border: 'rgba(148, 163, 184, 0.2)' };
    switch (lastDecision.decision) {
      case 'APPROVED':
        return { bg: 'rgba(16, 185, 129, 0.15)', text: '#34d399', border: 'rgba(16, 185, 129, 0.4)' };
      case 'REDUCED':
        return { bg: 'rgba(245, 158, 11, 0.15)', text: '#fbbf24', border: 'rgba(245, 158, 11, 0.4)' };
      case 'REJECTED':
      case 'FORCED_PROGRESSIVE':
        return { bg: 'rgba(239, 68, 68, 0.15)', text: '#f87171', border: 'rgba(239, 68, 68, 0.4)' };
      default:
        return { bg: 'rgba(51, 65, 85, 0.4)', text: '#94a3b8', border: 'rgba(148, 163, 184, 0.2)' };
    }
  })();

  const nodes = [
    {
      step: '1. CAMPAIGN ENGINE',
      accent: '#6366f1',
      title: status.mode,
      statusText: status.isRunning ? 'Active Loop (800ms)' : 'Paused',
      statusDot: status.isRunning ? '#10b981' : '#64748b',
      desc: status.isRunning ? 'Continuous worker dispatch' : 'Engine in standby'
    },
    {
      step: '2. PACING ENGINE',
      accent: '#3b82f6',
      title: `Requested: ${lastDecision ? lastDecision.requestedCalls : 0} calls`,
      desc: isPredictive ? "Little's Law stochastic model" : '1:1 Available agent parity'
    },
    {
      step: '3. SAFETY CONTROLLER',
      accent: '#a855f7',
      isGatekeeper: true,
      title: `Approved: ${lastDecision ? lastDecision.approvedCalls : 0} calls`,
      badge: lastDecision ? lastDecision.decision : 'IDLE',
      badgeStyle: decisionBadgeStyle,
      desc: lastDecision ? lastDecision.reason : 'Waiting next evaluation cycle'
    },
    {
      step: '4. CALL ALLOCATOR',
      accent: '#10b981',
      title: 'Atomic SQL CAS',
      desc: 'FOR UPDATE SKIP LOCKED (0 race conditions)'
    },
    {
      step: '5. TELECOM PROVIDER',
      accent: '#f59e0b',
      title: status.activeProvider,
      statusDot: providerHealth.isHealthy ? '#10b981' : '#ef4444',
      statusText: `Health ${providerHealth.healthPct}% (${providerHealth.avgLatencyMs}ms)`,
      desc: providerHealth.outageActive ? 'Outage simulation active' : 'Gateway reachable'
    }
  ];

  return (
    <motion.section
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="glass-panel"
      style={{
        padding: '18px 22px',
        borderRadius: 16,
        marginBottom: 24,
        position: 'relative'
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            background: 'rgba(99, 102, 241, 0.15)',
            padding: 6,
            borderRadius: 8,
            border: '1px solid rgba(99, 102, 241, 0.3)'
          }}>
            <Server size={16} color="#818cf8" />
          </div>
          <div>
            <h2 style={{ margin: 0, fontSize: 14, fontWeight: 800, letterSpacing: '0.02em', color: '#f8fafc' }}>
              NON-BYPASSABLE PIPELINE FLOW
            </h2>
            <span style={{ fontSize: 11, color: '#94a3b8' }}>
              Campaign $\longrightarrow$ Pacing Engine $\longrightarrow$ <b style={{ color: '#c084fc' }}>Safety Controller (Gatekeeper)</b> $\longrightarrow$ Call Allocator $\longrightarrow$ Telecom
            </span>
          </div>
        </div>

        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 11,
          color: '#c084fc',
          background: 'rgba(168, 85, 247, 0.1)',
          padding: '4px 10px',
          borderRadius: 8,
          border: '1px solid rgba(168, 85, 247, 0.3)',
          fontWeight: 600
        }}>
          <Lock size={12} />
          <span>Compliance Guard Active</span>
        </div>
      </div>

      {/* Nodes Row with animated connector flows */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: 12,
        alignItems: 'stretch'
      }}>
        {nodes.map((node, i) => (
          <motion.div
            key={i}
            whileHover={{ y: -2, transition: { duration: 0.15 } }}
            style={{
              position: 'relative',
              background: node.isGatekeeper
                ? 'linear-gradient(135deg, rgba(30, 27, 75, 0.7), rgba(19, 17, 44, 0.85))'
                : 'rgba(15, 23, 42, 0.75)',
              border: `1px solid ${node.isGatekeeper ? 'rgba(168, 85, 247, 0.45)' : 'rgba(255, 255, 255, 0.08)'}`,
              borderTop: `3px solid ${node.accent}`,
              borderRadius: 12,
              padding: '14px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              boxShadow: node.isGatekeeper ? '0 0 20px rgba(168, 85, 247, 0.15)' : 'none'
            }}
          >
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 10, fontWeight: 800, color: node.accent, letterSpacing: '0.05em' }}>
                  {node.step}
                </span>
                {node.badge && (
                  <span style={{
                    fontSize: 9,
                    fontWeight: 800,
                    padding: '2px 6px',
                    borderRadius: 4,
                    backgroundColor: node.badgeStyle.bg,
                    color: node.badgeStyle.text,
                    border: `1px solid ${node.badgeStyle.border}`
                  }}>
                    {node.badge}
                  </span>
                )}
              </div>

              <div style={{ fontSize: 14, fontWeight: 800, color: '#f8fafc', marginTop: 6 }}>
                {node.title}
              </div>
            </div>

            <div style={{ marginTop: 8 }}>
              {node.statusText && (
                <div style={{ fontSize: 11, color: '#cbd5e1', display: 'flex', alignItems: 'center', gap: 5, marginBottom: 2 }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: node.statusDot }} />
                  {node.statusText}
                </div>
              )}
              <div
                style={{
                  fontSize: 10,
                  color: node.isGatekeeper ? '#d8b4fe' : '#64748b',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis'
                }}
                title={node.desc}
              >
                {node.desc}
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </motion.section>
  );
}

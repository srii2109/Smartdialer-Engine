import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Play, AlertTriangle, CheckCircle2, Cpu, Zap, ShieldAlert } from 'lucide-react';

function getTimestamp() {
  return new Date().toLocaleTimeString();
}

export default function TestingLab({ onRunScenario, onInjectFailure }) {
  const [lastAction, setLastAction] = useState(null);
  const [runningAction, setRunningAction] = useState(null);

  const handleScenario = async (scId, label) => {
    setRunningAction(scId);
    try {
      await onRunScenario(scId);
      setLastAction({
        type: 'scenario',
        title: `Pacing Scenario ${scId} Configured`,
        desc: `Updated answer probabilities & statistical talk times (${label}).`,
        isSuccess: true,
        timestamp: getTimestamp()
      });
    } catch {
      setLastAction({
        type: 'scenario',
        title: `Failed to configure scenario ${scId}`,
        desc: 'Check backend connectivity.',
        isSuccess: false,
        timestamp: getTimestamp()
      });
    } finally {
      setRunningAction(null);
    }
  };

  const handleFailure = async (typeId, title) => {
    setRunningAction(typeId);
    try {
      await onInjectFailure(typeId);
      setLastAction({
        type: 'failure',
        title: `${title} Triggered`,
        desc: 'Simulated edge-case failure. System responded and verified invariants.',
        isSuccess: true,
        timestamp: getTimestamp()
      });
    } catch {
      setLastAction({
        type: 'failure',
        title: `Failed to execute ${title}`,
        desc: 'Check backend connectivity.',
        isSuccess: false,
        timestamp: getTimestamp()
      });
    } finally {
      setRunningAction(null);
    }
  };

  const scenarios = [
    {
      id: 'A',
      title: 'Scenario A: Low Answer Rate',
      metric: '20% Answer | 120s Avg Talk Time',
      badgeColor: '#60a5fa',
      desc: 'Predictive dialer compensates by aggressively placing calls ahead of agent availability.'
    },
    {
      id: 'B',
      title: 'Scenario B: Moderate Answer Rate',
      metric: '50% Answer | 90s Avg Talk Time',
      badgeColor: '#34d399',
      desc: 'Balanced pacing algorithm maintaining tight compliance under 3% abandonment.'
    },
    {
      id: 'C',
      title: 'Scenario C: High Answer Rate',
      metric: '70% Answer | 180s Avg Talk Time',
      badgeColor: '#f59e0b',
      desc: 'High pickup frequency; safety controller throttles calls to prevent queue overflows.'
    },
    {
      id: 'D',
      title: 'Scenario D: Dynamic Chaos Mode',
      metric: 'Provider B Active | Random Jitter & Dropouts',
      badgeColor: '#c084fc',
      desc: 'Telecom latency spikes, carrier timeouts, and out-of-order webhook deliveries.'
    }
  ];

  const failureTests = [
    {
      id: 'worker_crash',
      title: 'Worker Crash Simulation',
      tag: 'Orphaned Call Sweeper',
      badgeColor: '#ef4444',
      icon: Zap,
      desc: 'Kills a simulated worker midway through call dispatch. Reconciler sweeper discovers the hung call and releases reserved borrower & agent.'
    },
    {
      id: 'provider_outage',
      title: 'Provider Outage Toggle',
      tag: 'Circuit Breaker Fallback',
      badgeColor: '#f59e0b',
      icon: ShieldAlert,
      desc: 'Simulates 503 carrier outages. Safety controller detects degraded provider health and halts new dispatch batches.'
    },
    {
      id: 'duplicate_event',
      title: 'Duplicate Webhook Delivery',
      tag: 'Idempotency Protection',
      badgeColor: '#818cf8',
      icon: CheckCircle2,
      desc: 'Sends multiple identical webhook payloads. Verified against MySQL unique event index to guarantee single execution.'
    },
    {
      id: 'out_of_order',
      title: 'Out-of-Order Webhook Delivery',
      tag: 'Monotonic State Precedence',
      badgeColor: '#ec4899',
      icon: AlertTriangle,
      desc: 'Delivers COMPLETED webhook before ANSWERED. Call state machine rejects stale earlier states using strict ordinal ranks.'
    }
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      
      {/* Top Banner with live result feedback */}
      {lastAction && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          style={{
            background: lastAction.isSuccess ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.12)',
            border: `1px solid ${lastAction.isSuccess ? 'rgba(16, 185, 129, 0.35)' : 'rgba(239, 68, 68, 0.35)'}`,
            borderRadius: 12,
            padding: '14px 18px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}
        >
          <div>
            <div style={{
              fontSize: 13,
              fontWeight: 800,
              color: lastAction.isSuccess ? '#34d399' : '#f87171',
              display: 'flex',
              alignItems: 'center',
              gap: 8
            }}>
              <CheckCircle2 size={16} />
              {lastAction.title}
            </div>
            <div style={{ fontSize: 12, color: '#cbd5e1', marginTop: 2 }}>
              {lastAction.desc}
            </div>
          </div>
          <span style={{ fontSize: 11, color: '#94a3b8' }}>
            {lastAction.timestamp}
          </span>
        </motion.div>
      )}

      {/* Grid: 2 Columns for Scenarios & Failure Tests */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 20 }}>
        
        {/* Section 1: Pacing Scenarios */}
        <div className="glass-panel" style={{
          borderRadius: 16,
          padding: 22,
          display: 'flex',
          flexDirection: 'column',
          gap: 16
        }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8, color: '#f8fafc' }}>
              <Cpu size={18} color="#818cf8" />
              Statistical Pacing Scenarios
            </h3>
            <p style={{ margin: '2px 0 0', fontSize: 12, color: '#64748b' }}>
              Simulates different borrower answer rates and talk duration distributions.
            </p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {scenarios.map((sc) => (
              <motion.div
                key={sc.id}
                whileHover={{ y: -2, transition: { duration: 0.15 } }}
                style={{
                  background: 'rgba(15, 23, 42, 0.7)',
                  border: '1px solid rgba(255, 255, 255, 0.06)',
                  borderRadius: 10,
                  padding: 14,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 12
                }}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 800, color: sc.badgeColor }}>
                      {sc.title}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#93c5fd', marginTop: 3 }}>
                    {sc.metric}
                  </div>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2, lineHeight: 1.4 }}>
                    {sc.desc}
                  </div>
                </div>

                <motion.button
                  whileHover={{ scale: 1.04 }}
                  whileTap={{ scale: 0.96 }}
                  onClick={() => handleScenario(sc.id, sc.metric)}
                  disabled={runningAction === sc.id}
                  style={{
                    background: 'linear-gradient(135deg, rgba(79, 70, 229, 0.25), rgba(99, 102, 241, 0.15))',
                    border: '1px solid rgba(99, 102, 241, 0.4)',
                    color: '#f8fafc',
                    padding: '8px 14px',
                    borderRadius: 8,
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    whiteSpace: 'nowrap',
                    boxShadow: '0 2px 8px rgba(79, 70, 229, 0.25)'
                  }}
                >
                  <Play size={13} fill="#818cf8" color="#818cf8" />
                  Activate
                </motion.button>
              </motion.div>
            ))}
          </div>
        </div>

        {/* Section 2: Failure Injection Playground */}
        <div className="glass-panel" style={{
          borderRadius: 16,
          padding: 22,
          display: 'flex',
          flexDirection: 'column',
          gap: 16
        }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8, color: '#f8fafc' }}>
              <AlertTriangle size={18} color="#ef4444" />
              Failure Injection &amp; Fault Tolerance
            </h3>
            <p style={{ margin: '2px 0 0', fontSize: 12, color: '#64748b' }}>
              Inject production failure modes to verify automated recovery &amp; safety invariants.
            </p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {failureTests.map((ft) => {
              const Icon = ft.icon;

              return (
                <motion.div
                  key={ft.id}
                  whileHover={{ y: -2, transition: { duration: 0.15 } }}
                  style={{
                    background: 'rgba(15, 23, 42, 0.7)',
                    border: '1px solid rgba(255, 255, 255, 0.06)',
                    borderRadius: 10,
                    padding: 14,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 12
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 800, color: '#f8fafc' }}>
                        {ft.title}
                      </span>
                      <span style={{
                        fontSize: 10,
                        fontWeight: 700,
                        color: ft.badgeColor,
                        background: 'rgba(255, 255, 255, 0.06)',
                        padding: '2px 6px',
                        borderRadius: 4
                      }}>
                        {ft.tag}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 3, lineHeight: 1.4 }}>
                      {ft.desc}
                    </div>
                  </div>

                  <motion.button
                    whileHover={{ scale: 1.04 }}
                    whileTap={{ scale: 0.96 }}
                    onClick={() => handleFailure(ft.id, ft.title)}
                    disabled={runningAction === ft.id}
                    style={{
                      background: 'rgba(239, 68, 68, 0.12)',
                      border: '1px solid rgba(239, 68, 68, 0.35)',
                      color: '#fca5a5',
                      padding: '8px 14px',
                      borderRadius: 8,
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      whiteSpace: 'nowrap',
                      boxShadow: '0 2px 8px rgba(239, 68, 68, 0.2)'
                    }}
                  >
                    <Icon size={14} />
                    Test Now
                  </motion.button>
                </motion.div>
              );
            })}
          </div>
        </div>

      </div>

    </div>
  );
}

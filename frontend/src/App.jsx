import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { RefreshCw } from 'lucide-react';

import * as api from './services/api';
import { normalizeStatus } from './services/normalizer';

import { ErrorBoundary } from './components/ErrorBoundary';
import ToastNotice from './components/ToastNotice';
import Header from './components/Header';
import NavigationTabs from './components/NavigationTabs';
import KpiStats from './components/KpiStats';
import PipelineDiagram from './components/PipelineDiagram';
import AgentRoster from './components/AgentRoster';
import CallMonitor from './components/CallMonitor';
import SafetyComplianceView from './components/SafetyComplianceView';
import TestingLab from './components/TestingLab';
import SafetyAuditLog from './components/SafetyAuditLog';

export default function App() {
  const [status, setStatus] = useState(null);
  const [agents, setAgents] = useState([]);
  const [calls, setCalls] = useState([]);
  const [safetyLogs, setSafetyLogs] = useState([]);
  const [activeTab, setActiveTab] = useState('overview');
  const [actionNotice, setActionNotice] = useState(null);

  const showNotice = (msg, isError = false) => {
    setActionNotice({ msg, isError });
    setTimeout(() => setActionNotice(null), 2500);
  };

  // Sync data and WebSocket stream
  useEffect(() => {
    let isMounted = true;
    let socket = null;
    let reconnectTimeout = null;

    const loadData = async () => {
      try {
        const [sRes, cRes, aRes, lRes] = await Promise.all([
          api.getStatus(),
          api.getCalls(),
          api.getAgents(),
          api.getSafetyLogs()
        ]);
        if (isMounted) {
          setStatus(normalizeStatus(sRes));
          setCalls(cRes || []);
          setAgents(aRes || []);
          setSafetyLogs(lRes || []);
        }
      } catch (e) {
        console.warn('API fetch warning:', e);
      }
    };

    loadData();

    const connectWs = () => {
      if (!isMounted) return;
      try {
        socket = new WebSocket(api.WS_BASE);

        socket.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'SNAPSHOT' && isMounted) {
              if (data.status) setStatus(normalizeStatus(data.status));
              if (data.calls) setCalls(data.calls);
              if (data.agents) setAgents(data.agents);
            }
          } catch (err) {
            console.error('WS parse error', err);
          }
        };

        socket.onerror = () => {
          // Handled by onclose
        };

        socket.onclose = () => {
          if (isMounted) {
            reconnectTimeout = setTimeout(connectWs, 3000);
          }
        };
      } catch (e) {
        console.warn('WS conn error', e);
      }
    };

    connectWs();

    const pollInterval = setInterval(() => {
      if (isMounted) {
        loadData();
      }
    }, 2500);

    return () => {
      isMounted = false;
      clearInterval(pollInterval);
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (socket) {
        socket.onclose = null;
        socket.onerror = null;
        if (socket.readyState === WebSocket.OPEN) {
          socket.close();
        } else if (socket.readyState === WebSocket.CONNECTING) {
          socket.onopen = () => socket.close();
        }
      }
    };
  }, []);

  const refreshAll = async () => {
    try {
      const [sRes, cRes, aRes, lRes] = await Promise.all([
        api.getStatus(),
        api.getCalls(),
        api.getAgents(),
        api.getSafetyLogs()
      ]);
      setStatus(normalizeStatus(sRes));
      setCalls(cRes || []);
      setAgents(aRes || []);
      setSafetyLogs(lRes || []);
    } catch (e) {
      console.warn('Refresh error:', e);
    }
  };

  const handleSetMode = async (mode) => {
    try {
      await api.updateMode(mode);
      showNotice(`Switched Dialing Mode to ${mode}`);
      refreshAll();
    } catch {
      showNotice('Failed to update mode', true);
    }
  };

  const handleSetProvider = async (providerId) => {
    try {
      await api.updateProvider(providerId);
      showNotice(`Active Telecom Provider switched to ${providerId}`);
      refreshAll();
    } catch {
      showNotice('Failed to update provider', true);
    }
  };

  const handleToggleDialer = async (action) => {
    try {
      const willRun = action === 'start' || action === 'resume';
      setStatus((prev) => (prev ? { ...prev, isRunning: willRun } : prev));
      await api.controlDialer(action);
      showNotice(willRun ? 'Dialer engine resumed' : 'Dialer engine paused');
      refreshAll();
    } catch {
      showNotice(`Failed to ${action} dialer`, true);
      refreshAll();
    }
  };

  const handleRunScenario = async (scenario) => {
    try {
      const data = await api.runScenario(scenario);
      showNotice(`Scenario ${scenario} active: ${data.answer_rate || 'Custom'} answer rate, ${data.avg_talk_time || '10s'} avg duration`);
      refreshAll();
    } catch {
      showNotice('Failed to set scenario', true);
    }
  };

  const handleInjectFailure = async (failureType) => {
    try {
      const data = await api.injectFailure(failureType);
      showNotice(`Failure Injected: ${data.status}`);
      refreshAll();
    } catch {
      showNotice('Failed to inject failure scenario', true);
    }
  };

  const handleDropAgents = async (count = 20) => {
    try {
      const data = await api.dropAgents(count);
      showNotice(`Simulated sudden dropout of ${data.count} agents`);
      refreshAll();
    } catch {
      showNotice('Failed to drop agents', true);
    }
  };

  const handleRestoreAgents = async () => {
    try {
      await api.restoreAgents();
      showNotice('All agents restored to AVAILABLE');
      refreshAll();
    } catch {
      showNotice('Failed to restore agents', true);
    }
  };

  if (!status) {
    return (
      <div style={{
        display: 'flex',
        height: '100vh',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#090d16',
        color: '#9ca3af'
      }}>
        <RefreshCw className="animate-spin" size={32} color="#818cf8" />
        <span style={{ marginLeft: 12, fontSize: 18 }}>
          Connecting to SmartDialer Core Engine...
        </span>
      </div>
    );
  }

  const counts = {
    activeCalls: status.activeCalls,
    availableAgents: status.availableAgents,
    totalAgents: status.totalAgents,
    safetyCount: status.safetyInterventionsCount
  };

  return (
    <ErrorBoundary>
      <div style={{
        minHeight: '100vh',
        padding: '16px 24px 32px',
        backgroundColor: '#090d16',
        color: '#f3f4f6',
        maxWidth: 1600,
        margin: '0 auto'
      }}>
        
        {/* Toast Notification banner */}
        <ToastNotice notice={actionNotice} />

        {/* Top Header & Dialing Engine Controls */}
        <Header
          status={status}
          onSetMode={handleSetMode}
          onSetProvider={handleSetProvider}
          onToggleDialer={handleToggleDialer}
        />

        {/* Executive KPI Stats Deck */}
        <KpiStats status={status} />

        {/* Clean Navigation Tab Bar */}
        <NavigationTabs
          activeTab={activeTab}
          onSelectTab={setActiveTab}
          counts={counts}
        />

        {/* Animated Tab Switch Content */}
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
          >
            {/* Tab 1: Overview & Pipeline */}
            {activeTab === 'overview' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                <PipelineDiagram status={status} />
                <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 20 }}>
                  <CallMonitor calls={calls} />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                    <SafetyAuditLog
                      logs={safetyLogs}
                      onNavigateToCompliance={() => setActiveTab('safety')}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Tab 2: Agent Workforce */}
            {activeTab === 'agents' && (
              <AgentRoster
                agents={agents}
                onDropAgents={handleDropAgents}
                onRestoreAgents={handleRestoreAgents}
              />
            )}

            {/* Tab 3: Safety & Compliance */}
            {activeTab === 'safety' && (
              <SafetyComplianceView
                status={status}
                logs={safetyLogs}
              />
            )}

            {/* Tab 4: Chaos & Testing Lab */}
            {activeTab === 'testing' && (
              <TestingLab
                onRunScenario={handleRunScenario}
                onInjectFailure={handleInjectFailure}
              />
            )}
          </motion.div>
        </AnimatePresence>

      </div>
    </ErrorBoundary>
  );
}

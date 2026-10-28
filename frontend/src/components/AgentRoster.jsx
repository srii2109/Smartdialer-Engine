import React, { useState } from 'react';
import {
  Users, Search, UserMinus, UserCheck, LayoutGrid, List,
  ChevronLeft, ChevronRight
} from 'lucide-react';

const STATE_CONFIG = {
  AVAILABLE: {
    label: 'Available',
    dot: '#10b981',
    bg: 'rgba(16, 185, 129, 0.1)',
    text: '#34d399',
    border: 'rgba(16, 185, 129, 0.25)'
  },
  RESERVED: {
    label: 'Reserved',
    dot: '#f59e0b',
    bg: 'rgba(245, 158, 11, 0.1)',
    text: '#fbbf24',
    border: 'rgba(245, 158, 11, 0.25)'
  },
  DIALING: {
    label: 'Dialing',
    dot: '#3b82f6',
    bg: 'rgba(59, 130, 246, 0.1)',
    text: '#93c5fd',
    border: 'rgba(59, 130, 246, 0.25)'
  },
  CONNECTED: {
    label: 'In Call',
    dot: '#a855f7',
    bg: 'rgba(168, 85, 247, 0.12)',
    text: '#c084fc',
    border: 'rgba(168, 85, 247, 0.3)'
  },
  WRAP_UP: {
    label: 'Wrap Up',
    dot: '#ec4899',
    bg: 'rgba(236, 72, 153, 0.1)',
    text: '#f472b6',
    border: 'rgba(236, 72, 153, 0.25)'
  },
  PAUSED: {
    label: 'Paused',
    dot: '#9ca3af',
    bg: 'rgba(156, 163, 175, 0.1)',
    text: '#d1d5db',
    border: 'rgba(156, 163, 175, 0.25)'
  },
  OFFLINE: {
    label: 'Offline',
    dot: '#ef4444',
    bg: 'rgba(239, 68, 68, 0.1)',
    text: '#f87171',
    border: 'rgba(239, 68, 68, 0.25)'
  }
};

function getAgentInitials(id, name) {
  if (name && name.startsWith('Agent ')) {
    return `A${name.replace('Agent ', '').padStart(2, '0')}`;
  }
  const match = id.match(/\d+/);
  return match ? `A${match[0].padStart(2, '0')}` : 'AG';
}

export default function AgentRoster({ agents, onDropAgents, onRestoreAgents }) {
  const [filterState, setFilterState] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState('table'); // 'table' or 'grid'
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 12;

  // Breakdown counts
  const availableCount = agents.filter((a) => a.state === 'AVAILABLE').length;
  const connectedCount = agents.filter((a) => a.state === 'CONNECTED').length;
  const dialingCount = agents.filter((a) => a.state === 'DIALING' || a.state === 'RESERVED').length;
  const offlineCount = agents.filter((a) => a.state === 'OFFLINE' || a.state === 'PAUSED').length;

  const filteredAgents = agents.filter((ag) => {
    const matchesFilter = filterState === 'ALL' ||
      (filterState === 'CONNECTED' ? ag.state === 'CONNECTED' :
       filterState === 'DIALING' ? (ag.state === 'DIALING' || ag.state === 'RESERVED') :
       filterState === 'OFFLINE' ? (ag.state === 'OFFLINE' || ag.state === 'PAUSED') :
       ag.state === filterState);

    const matchesSearch = !searchQuery ||
      ag.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (ag.name && ag.name.toLowerCase().includes(searchQuery.toLowerCase()));

    return matchesFilter && matchesSearch;
  });

  const totalPages = Math.max(1, Math.ceil(filteredAgents.length / pageSize));
  const pageAgents = filteredAgents.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const handleFilterChange = (val) => {
    setFilterState(val);
    setCurrentPage(1);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      
      {/* Top Stat Summary Cards */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: 12
      }}>
        <div className="glass-panel" style={{ padding: '14px 18px', borderRadius: 12 }}>
          <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 700, letterSpacing: '0.04em' }}>AVAILABLE FOR CALLS</div>
          <div style={{ fontSize: 24, fontWeight: 800, color: '#34d399', marginTop: 4 }}>
            {availableCount} <span style={{ fontSize: 13, color: '#64748b', fontWeight: 400 }}>agents</span>
          </div>
        </div>

        <div className="glass-panel" style={{ padding: '14px 18px', borderRadius: 12 }}>
          <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 700, letterSpacing: '0.04em' }}>CONNECTED (TALKING)</div>
          <div style={{ fontSize: 24, fontWeight: 800, color: '#c084fc', marginTop: 4 }}>
            {connectedCount} <span style={{ fontSize: 13, color: '#64748b', fontWeight: 400 }}>agents</span>
          </div>
        </div>

        <div className="glass-panel" style={{ padding: '14px 18px', borderRadius: 12 }}>
          <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 700, letterSpacing: '0.04em' }}>DIALING / RESERVED</div>
          <div style={{ fontSize: 24, fontWeight: 800, color: '#60a5fa', marginTop: 4 }}>
            {dialingCount} <span style={{ fontSize: 13, color: '#64748b', fontWeight: 400 }}>agents</span>
          </div>
        </div>

        <div className="glass-panel" style={{ padding: '14px 18px', borderRadius: 12 }}>
          <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 700, letterSpacing: '0.04em' }}>PAUSED / OFFLINE</div>
          <div style={{ fontSize: 24, fontWeight: 800, color: offlineCount > 0 ? '#f87171' : '#94a3b8', marginTop: 4 }}>
            {offlineCount} <span style={{ fontSize: 13, color: '#64748b', fontWeight: 400 }}>agents</span>
          </div>
        </div>
      </div>

      {/* Main Roster Panel */}
      <div className="glass-panel" style={{
        borderRadius: 16,
        padding: 22,
        display: 'flex',
        flexDirection: 'column',
        gap: 16
      }}>
        
        {/* Actions Bar */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8, color: '#f3f4f6' }}>
              <Users size={18} color="#60a5fa" />
              Agent Workforce Directory
              <span style={{ fontSize: 12, color: '#9ca3af', fontWeight: 500 }}>
                ({filteredAgents.length} matching)
              </span>
            </h3>
            <p style={{ margin: '2px 0 0', fontSize: 12, color: '#6b7280' }}>
              Optimistic concurrency locked in MySQL via version tracking.
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {/* View Switcher */}
            <div style={{ display: 'flex', background: '#0d1322', padding: 3, borderRadius: 8, border: '1px solid #1e293b' }}>
              <button
                onClick={() => setViewMode('table')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  background: viewMode === 'table' ? '#1e293b' : 'transparent',
                  color: viewMode === 'table' ? '#f3f4f6' : '#9ca3af',
                  border: 'none',
                  padding: '5px 10px',
                  borderRadius: 6,
                  fontSize: 12,
                  cursor: 'pointer',
                  fontWeight: 600
                }}
              >
                <List size={14} /> Table
              </button>
              <button
                onClick={() => setViewMode('grid')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  background: viewMode === 'grid' ? '#1e293b' : 'transparent',
                  color: viewMode === 'grid' ? '#f3f4f6' : '#9ca3af',
                  border: 'none',
                  padding: '5px 10px',
                  borderRadius: 6,
                  fontSize: 12,
                  cursor: 'pointer',
                  fontWeight: 600
                }}
              >
                <LayoutGrid size={14} /> Cards
              </button>
            </div>

            {/* Simulation Actions */}
            <button
              onClick={() => onDropAgents(20)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                background: 'rgba(239, 68, 68, 0.12)',
                color: '#f87171',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                padding: '6px 12px',
                borderRadius: 8,
                fontSize: 12,
                cursor: 'pointer',
                fontWeight: 600,
                transition: 'background 0.15s ease'
              }}
              title="Simulate 20 agents disconnecting"
            >
              <UserMinus size={14} /> Drop 20 Agents
            </button>
            <button
              onClick={onRestoreAgents}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                background: 'rgba(16, 185, 129, 0.12)',
                color: '#34d399',
                border: '1px solid rgba(16, 185, 129, 0.3)',
                padding: '6px 12px',
                borderRadius: 8,
                fontSize: 12,
                cursor: 'pointer',
                fontWeight: 600,
                transition: 'background 0.15s ease'
              }}
            >
              <UserCheck size={14} /> Restore All
            </button>
          </div>
        </div>

        {/* Filter Pills and Search */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {[
              { id: 'ALL', label: `All (${agents.length})` },
              { id: 'AVAILABLE', label: `Available (${availableCount})` },
              { id: 'CONNECTED', label: `In Call (${connectedCount})` },
              { id: 'DIALING', label: `Dialing (${dialingCount})` },
              { id: 'OFFLINE', label: `Offline (${offlineCount})` }
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => handleFilterChange(tab.id)}
                style={{
                  background: filterState === tab.id ? '#1e293b' : 'transparent',
                  color: filterState === tab.id ? '#f3f4f6' : '#9ca3af',
                  border: filterState === tab.id ? '1px solid #475569' : '1px solid #1f2937',
                  padding: '5px 12px',
                  borderRadius: 6,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div style={{ position: 'relative', width: 220 }}>
            <Search size={14} color="#6b7280" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }} />
            <input
              type="text"
              placeholder="Search by agent ID or name..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
              style={{
                background: '#0d1322',
                border: '1px solid #1f2937',
                color: '#f3f4f6',
                padding: '6px 10px 6px 30px',
                borderRadius: 6,
                fontSize: 12,
                outline: 'none',
                width: '100%',
                boxSizing: 'border-box'
              }}
            />
          </div>
        </div>

        {/* Content View: Table or Cards */}
        {filteredAgents.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 0', color: '#6b7280', fontSize: 13 }}>
            No agents found matching your current filter.
          </div>
        ) : viewMode === 'table' ? (
          /* Table View */
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #1f2937', color: '#9ca3af' }}>
                  <th style={{ padding: '10px 12px', fontWeight: 600 }}>AGENT</th>
                  <th style={{ padding: '10px 12px', fontWeight: 600 }}>STATUS</th>
                  <th style={{ padding: '10px 12px', fontWeight: 600 }}>WORKER DISPATCH</th>
                  <th style={{ padding: '10px 12px', fontWeight: 600 }}>CALLS COMPLETED</th>
                  <th style={{ padding: '10px 12px', fontWeight: 600 }}>TALK DURATION</th>
                  <th style={{ padding: '10px 12px', fontWeight: 600 }}>STATE VERSION</th>
                </tr>
              </thead>
              <tbody>
                {pageAgents.map((ag) => {
                  const cfg = STATE_CONFIG[ag.state] || STATE_CONFIG.AVAILABLE;
                  const initials = getAgentInitials(ag.id, ag.name);

                  return (
                    <tr
                      key={ag.id}
                      style={{
                        borderBottom: '1px solid #1e293b',
                        transition: 'background 0.15s ease'
                      }}
                    >
                      {/* Agent ID & Name */}
                      <td style={{ padding: '12px', display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{
                          width: 30,
                          height: 30,
                          borderRadius: '50%',
                          background: 'linear-gradient(135deg, #1e293b, #0f172a)',
                          border: '1px solid #334155',
                          color: '#93c5fd',
                          fontSize: 11,
                          fontWeight: 700,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0
                        }}>
                          {initials}
                        </div>
                        <div>
                          <div style={{ fontWeight: 700, color: '#f3f4f6' }}>{ag.name || ag.id}</div>
                          <div style={{ fontSize: 11, color: '#6b7280' }}>ID: {ag.id}</div>
                        </div>
                      </td>

                      {/* Status */}
                      <td style={{ padding: '12px' }}>
                        <span style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                          padding: '4px 10px',
                          borderRadius: 6,
                          background: cfg.bg,
                          border: `1px solid ${cfg.border}`,
                          color: cfg.text,
                          fontWeight: 700,
                          fontSize: 11
                        }}>
                          <span style={{
                            width: 6,
                            height: 6,
                            borderRadius: '50%',
                            backgroundColor: cfg.dot
                          }} />
                          {cfg.label}
                        </span>
                      </td>

                      {/* Worker Assignment */}
                      <td style={{ padding: '12px', color: ag.worker_id ? '#818cf8' : '#64748b' }}>
                        {ag.worker_id ? (
                          <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{ag.worker_id}</span>
                        ) : (
                          <span>— Ready / Idle</span>
                        )}
                      </td>

                      {/* Calls */}
                      <td style={{ padding: '12px', color: '#cbd5e1' }}>
                        <b>{ag.total_calls ?? 0}</b> calls
                      </td>

                      {/* Talk Time */}
                      <td style={{ padding: '12px', color: '#cbd5e1' }}>
                        <b>{Math.round(ag.total_talk_time_sec ?? 0)}</b> seconds
                      </td>

                      {/* Version Lock */}
                      <td style={{ padding: '12px' }}>
                        <span style={{
                          fontSize: 11,
                          color: '#94a3b8',
                          background: '#0d1322',
                          border: '1px solid #1e293b',
                          padding: '2px 8px',
                          borderRadius: 4
                        }}>
                          CAS v{ag.version ?? 1}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          /* Card View */
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
            gap: 14
          }}>
            {pageAgents.map((ag) => {
              const cfg = STATE_CONFIG[ag.state] || STATE_CONFIG.AVAILABLE;
              const initials = getAgentInitials(ag.id, ag.name);

              return (
                <div
                  key={ag.id}
                  style={{
                    background: '#0d1322',
                    border: '1px solid #1e293b',
                    borderRadius: 10,
                    padding: 14,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    gap: 12
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{
                        width: 34,
                        height: 34,
                        borderRadius: '50%',
                        background: 'linear-gradient(135deg, #1e293b, #0f172a)',
                        border: '1px solid #334155',
                        color: '#93c5fd',
                        fontSize: 12,
                        fontWeight: 700,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0
                      }}>
                        {initials}
                      </div>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#f3f4f6' }}>{ag.name || ag.id}</div>
                        <div style={{ fontSize: 11, color: '#6b7280' }}>{ag.id}</div>
                      </div>
                    </div>

                    <span style={{
                      fontSize: 10,
                      color: '#94a3b8',
                      background: '#1e293b',
                      padding: '2px 6px',
                      borderRadius: 4
                    }}>
                      v{ag.version ?? 1}
                    </span>
                  </div>

                  <div>
                    <span style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '3px 8px',
                      borderRadius: 6,
                      background: cfg.bg,
                      border: `1px solid ${cfg.border}`,
                      color: cfg.text,
                      fontWeight: 700,
                      fontSize: 11
                    }}>
                      <span style={{
                        width: 5,
                        height: 5,
                        borderRadius: '50%',
                        backgroundColor: cfg.dot
                      }} />
                      {cfg.label}
                    </span>
                  </div>

                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: 11,
                    color: '#9ca3af',
                    borderTop: '1px solid #1e293b',
                    paddingTop: 8
                  }}>
                    <span>Calls: <b style={{ color: '#f3f4f6' }}>{ag.total_calls ?? 0}</b></span>
                    <span>Talk: <b style={{ color: '#f3f4f6' }}>{Math.round(ag.total_talk_time_sec ?? 0)}s</b></span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Clean Pagination Footer */}
        {filteredAgents.length > pageSize && (
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderTop: '1px solid #1f2937',
            paddingTop: 12,
            fontSize: 12,
            color: '#9ca3af'
          }}>
            <div>
              Showing <b>{(currentPage - 1) * pageSize + 1}</b> to{' '}
              <b>{Math.min(currentPage * pageSize, filteredAgents.length)}</b> of{' '}
              <b>{filteredAgents.length}</b> agents
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                style={{
                  background: currentPage === 1 ? '#111827' : '#1e293b',
                  color: currentPage === 1 ? '#4b5563' : '#f3f4f6',
                  border: '1px solid #374151',
                  borderRadius: 6,
                  padding: '4px 8px',
                  cursor: currentPage === 1 ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center'
                }}
              >
                <ChevronLeft size={14} /> Prev
              </button>

              <span style={{ padding: '0 8px', fontWeight: 600, color: '#f3f4f6' }}>
                Page {currentPage} of {totalPages}
              </span>

              <button
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                style={{
                  background: currentPage === totalPages ? '#111827' : '#1e293b',
                  color: currentPage === totalPages ? '#4b5563' : '#f3f4f6',
                  border: '1px solid #374151',
                  borderRadius: 6,
                  padding: '4px 8px',
                  cursor: currentPage === totalPages ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center'
                }}
              >
                Next <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}

      </div>

    </div>
  );
}

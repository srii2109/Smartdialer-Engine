export const API_BASE = 'http://localhost:8000/api';
export const WS_BASE = 'ws://localhost:8000/api/ws';

export async function getStatus() {
  const res = await fetch(`${API_BASE}/status`);
  if (!res.ok) throw new Error('Failed to fetch status');
  return res.json();
}

export async function getCalls() {
  const res = await fetch(`${API_BASE}/calls`);
  if (!res.ok) throw new Error('Failed to fetch calls');
  return res.json();
}

export async function getAgents() {
  const res = await fetch(`${API_BASE}/agents`);
  if (!res.ok) throw new Error('Failed to fetch agents');
  return res.json();
}

export async function getSafetyLogs() {
  const res = await fetch(`${API_BASE}/safety/log`);
  if (!res.ok) throw new Error('Failed to fetch safety logs');
  return res.json();
}

export async function updateMode(mode) {
  const res = await fetch(`${API_BASE}/config/mode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode })
  });
  if (!res.ok) throw new Error('Failed to update mode');
  return res.json();
}

export async function updateProvider(provider_id) {
  const res = await fetch(`${API_BASE}/config/provider`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider_id })
  });
  if (!res.ok) throw new Error('Failed to update provider');
  return res.json();
}

export async function controlDialer(action) {
  const res = await fetch(`${API_BASE}/dialer/${action}`, { method: 'POST' });
  if (!res.ok) throw new Error(`Failed to ${action} dialer`);
  return res.json();
}

export async function runScenario(scenario) {
  const res = await fetch(`${API_BASE}/scenarios/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scenario })
  });
  if (!res.ok) throw new Error('Failed to set scenario');
  return res.json();
}

export async function injectFailure(failure_type) {
  const res = await fetch(`${API_BASE}/failures/inject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ failure_type })
  });
  if (!res.ok) throw new Error('Failed to inject failure');
  return res.json();
}

export async function dropAgents(count = 20) {
  const res = await fetch(`${API_BASE}/agents/drop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ count })
  });
  if (!res.ok) throw new Error('Failed to drop agents');
  return res.json();
}

export async function restoreAgents() {
  const res = await fetch(`${API_BASE}/agents/restore`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to restore agents');
  return res.json();
}

'use client';

// ─── Agent Studio: Run History Page ───────────────────────────────────────
// Table of past runs with status, cost, duration, and drill-down capability.

import React, { useState, useEffect } from 'react';
import {
    CheckCircle,
    XCircle,
    Clock,
    Loader2,
    DollarSign,
    ChevronDown,
    ChevronRight,
    RotateCcw,
    GitCompare,
    Eye,
    StopCircle,
} from 'lucide-react';

// ─── Status Components ────────────────────────────────────────────────────

function StatusIcon({ status }: { status: string }) {
    const config: Record<string, { icon: React.ComponentType<any>; color: string }> = {
        completed: { icon: CheckCircle, color: '#10B981' },
        failed: { icon: XCircle, color: '#EF4444' },
        running: { icon: Loader2, color: '#3B82F6' },
        cancelled: { icon: Clock, color: '#64748B' },
    };
    const c = config[status] ?? config.cancelled;
    const Icon = c.icon;
    return <Icon size={16} color={c.color} className={status === 'running' ? 'animate-spin' : ''} />;
}

// ─── Run History Page ─────────────────────────────────────────────────────

export default function RunsPage() {
    const [expandedRun, setExpandedRun] = useState<string | null>(null);
    const [runs, setRuns] = useState<any[]>([]);
    const [runDetails, setRunDetails] = useState<Record<string, any>>({});
    const [loading, setLoading] = useState(true);
    const [cancelConfirmId, setCancelConfirmId] = useState<string | null>(null);

    const fetchRuns = () => {
        fetch('http://localhost:4000/api/runs')
            .then(res => res.json())
            .then(data => {
                setRuns(data.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
                setLoading(false);
            })
            .catch(err => {
                console.error(err);
                setLoading(false);
            });
    };

    useEffect(() => {
        fetchRuns();
    }, []);

    const handleCancel = async (runId: string) => {
        setCancelConfirmId(null);
        try {
            const res = await fetch(`http://localhost:4000/api/runs/${runId}/cancel`, { method: 'POST' });
            if (res.ok) {
                fetchRuns();
            } else {
                console.error('Failed to cancel run', await res.text());
                alert('Failed to cancel run.');
            }
        } catch (err) {
            console.error(err);
        }
    };

    const toggleExpand = async (runId: string) => {
        if (expandedRun === runId) {
            setExpandedRun(null);
            return;
        }
        setExpandedRun(runId);
        if (!runDetails[runId]) {
            try {
                const res = await fetch(`http://localhost:4000/api/runs/${runId}`);
                if (res.ok) {
                    const data = await res.json();
                    setRunDetails(prev => ({ ...prev, [runId]: data }));
                }
            } catch (err) {
                console.error(err);
            }
        }
    };

    return (
        <div style={{
            minHeight: '100vh', background: '#0B0F1A', padding: '32px 40px',
            fontFamily: "'Inter', sans-serif",
        }}>
            <h1 style={{ color: '#F1F5F9', fontSize: 24, fontWeight: 700, marginBottom: 8 }}>
                Run History
            </h1>
            <p style={{ color: '#64748B', fontSize: 14, marginBottom: 32 }}>
                View past executions, drill into step details, and replay workflows
            </p>

            {/* ─── Runs Table ──────────────────────────────────────────── */}
            <div style={{
                background: '#1E293B', borderRadius: 12, border: '1px solid #334155',
                overflow: 'hidden',
            }}>
                {/* Header */}
                <div style={{
                    display: 'grid', gridTemplateColumns: '40px 200px 100px 100px 100px 100px 160px 120px',
                    padding: '12px 16px', background: '#0F172A', borderBottom: '1px solid #334155',
                    color: '#64748B', fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                }}>
                    <div></div>
                    <div>Workflow</div>
                    <div>Status</div>
                    <div>Cost</div>
                    <div>Duration</div>
                    <div>Steps</div>
                    <div>Started</div>
                    <div>Actions</div>
                </div>

                {/* Rows */}
                {loading && (
                    <div style={{ padding: '24px', color: '#94A3B8', textAlign: 'center', fontSize: 13 }}>
                        <Loader2 size={16} className="animate-spin" style={{ display: 'inline', marginRight: 8, verticalAlign: 'middle' }} />
                        Loading runs...
                    </div>
                )}
                {!loading && runs.length === 0 && (
                    <div style={{ padding: '24px', color: '#94A3B8', textAlign: 'center', fontSize: 13 }}>
                        No execution runs found. Start a workflow from the Editor!
                    </div>
                )}
                {runs.map((run) => (
                    <div key={run.id}>
                        {/* Run Row */}
                        <div
                            onClick={() => toggleExpand(run.id)}
                            style={{
                                display: 'grid',
                                gridTemplateColumns: '40px 200px 100px 100px 100px 100px 160px 120px',
                                padding: '14px 16px',
                                borderBottom: '1px solid #1E293B',
                                cursor: 'pointer',
                                transition: 'background 0.15s',
                                alignItems: 'center',
                            }}
                            onMouseEnter={(e) => (e.currentTarget.style.background = '#0F172A50')}
                            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                        >
                            <div>{expandedRun === run.id ? <ChevronDown size={14} color="#64748B" /> : <ChevronRight size={14} color="#64748B" />}</div>
                            <div style={{ color: '#F1F5F9', fontSize: 13, fontWeight: 500 }} title={run.workflowId}>Workflow {run.workflowId.substring(0, 8)}</div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <StatusIcon status={run.status} />
                                <span style={{ color: '#94A3B8', fontSize: 12, textTransform: 'capitalize' }}>{run.status}</span>
                            </div>
                            <div style={{ color: '#10B981', fontSize: 12 }}>${run.totalCostUsd?.toFixed(4) || '0.0000'}</div>
                            <div style={{ color: '#94A3B8', fontSize: 12 }}>-</div>
                            <div style={{ color: '#94A3B8', fontSize: 12 }}>{run.stepCount || 0} steps</div>
                            <div style={{ color: '#64748B', fontSize: 11 }}>{new Date(run.createdAt).toLocaleString()}</div>
                            <div style={{ display: 'flex', gap: 8 }}>
                                {(run.status === 'running' || run.status === 'pending' || run.status === 'queued') && (
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setCancelConfirmId(run.id);
                                        }}
                                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }} title="Cancel Run">
                                        <StopCircle size={14} color="#EF4444" />
                                    </button>
                                )}
                                <button onClick={(e) => e.stopPropagation()} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }} title="View">
                                    <Eye size={14} color="#64748B" />
                                </button>
                                <button onClick={(e) => e.stopPropagation()} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }} title="Replay">
                                    <RotateCcw size={14} color="#6366F1" />
                                </button>
                                <button onClick={(e) => e.stopPropagation()} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }} title="Compare">
                                    <GitCompare size={14} color="#F59E0B" />
                                </button>
                            </div>
                        </div>

                        {/* Expanded Steps */}
                        {expandedRun === run.id && (
                            <div style={{ background: '#0F172A', padding: '12px 16px 16px 56px', borderBottom: '1px solid #334155' }}>
                                <div style={{ color: '#94A3B8', fontSize: 11, fontWeight: 600, marginBottom: 8, textTransform: 'uppercase' }}>
                                    Step Timeline
                                </div>
                                {!runDetails[run.id] ? (
                                    <div style={{ color: '#64748B', fontSize: 12 }}>Loading details...</div>
                                ) : (runDetails[run.id]?.steps || []).length === 0 ? (
                                    <div style={{ color: '#64748B', fontSize: 12 }}>No steps recorded yet.</div>
                                ) : (
                                    (runDetails[run.id]?.steps || []).map((step: any, i: number) => (
                                        <div
                                            key={step.id || step.nodeId || i}
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                flexWrap: 'wrap',
                                                gap: 12,
                                                padding: '8px 12px',
                                                background: '#1E293B',
                                                borderRadius: 8,
                                                marginBottom: 6,
                                                borderLeft: `3px solid ${step.status === 'completed' ? '#10B981' : step.status === 'failed' ? '#EF4444' : '#3B82F6'}`,
                                            }}
                                        >
                                            <StatusIcon status={step.status} />
                                            <div style={{ flex: 1 }}>
                                                <div style={{ color: '#F1F5F9', fontSize: 12, fontWeight: 500 }}>{step.nodeId}</div>
                                                <div style={{ color: '#64748B', fontSize: 10 }}>{step.agentType}</div>
                                            </div>
                                            <div style={{ color: '#10B981', fontSize: 11 }}>${step.costUsd?.toFixed(4) || '0.000'}</div>
                                            <div style={{ color: '#94A3B8', fontSize: 11 }}>{step.latencyMs || 0}ms</div>
                                            <div style={{ color: '#64748B', fontSize: 10 }}>{step.tokensIn || 0}→{step.tokensOut || 0} tok</div>
                                            {step.error && (
                                                <div style={{ color: '#FCA5A5', fontSize: 10, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                    ⚠ {step.error}
                                                </div>
                                            )}
                                            {step.response && (
                                                <div style={{
                                                    flexBasis: '100%',
                                                    marginTop: 8,
                                                    padding: '8px 12px',
                                                    background: '#0F172A',
                                                    border: '1px solid #334155',
                                                    borderRadius: 6,
                                                    fontSize: 11,
                                                    color: '#A78BFA',
                                                    fontFamily: 'monospace',
                                                    overflowX: 'auto',
                                                    whiteSpace: 'pre-wrap',
                                                    wordBreak: 'break-word',
                                                }}>
                                                    {typeof step.response === 'object' ? JSON.stringify(step.response, null, 2) : String(step.response)}
                                                </div>
                                            )}
                                        </div>
                                    ))
                                )}
                            </div>
                        )}
                    </div>
                ))}
            </div>

            {/* ─── Cancel Confirmation Modal ─────────────────────────────── */}
            {cancelConfirmId && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                    background: 'rgba(15, 23, 42, 0.8)', backdropFilter: 'blur(4px)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50
                }}>
                    <div style={{
                        background: '#1E293B', border: '1px solid #334155', borderRadius: 12,
                        padding: 32, width: 400, boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)'
                    }}>
                        <h2 style={{ color: '#F1F5F9', fontSize: 18, fontWeight: 600, marginTop: 0, marginBottom: 12 }}>
                            Cancel Execution Run?
                        </h2>
                        <p style={{ color: '#94A3B8', fontSize: 14, marginBottom: 24, lineHeight: 1.5 }}>
                            Are you sure you want to cancel this workflow run? Any agents currently executing will be stopped immediately.
                        </p>
                        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
                            <button
                                onClick={() => setCancelConfirmId(null)}
                                style={{
                                    background: 'transparent', border: '1px solid #475569', color: '#F1F5F9',
                                    padding: '8px 16px', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 500
                                }}
                            >
                                Nevermind
                            </button>
                            <button
                                onClick={() => handleCancel(cancelConfirmId)}
                                style={{
                                    background: '#EF4444', border: 'none', color: '#fff',
                                    padding: '8px 16px', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600
                                }}
                            >
                                Yes, cancel run
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

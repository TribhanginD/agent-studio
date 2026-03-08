'use client';

// ─── Agent Studio: Custom Agent Node Components ──────────────────────────
// Rich React Flow node types for each agent type in the DAG editor.

import React, { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import {
    Brain,
    Cog,
    ShieldCheck,
    Database,
    Sparkles,
    Clock,
    DollarSign,
    AlertCircle,
    CheckCircle,
    Loader2,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────

export interface AgentNodeData {
    label: string;
    agentType: 'planner' | 'executor' | 'validator' | 'retrieval' | 'custom';
    prompt?: string;
    provider?: string;
    timeoutMs?: number;
    // Execution state (populated during runs)
    status?: 'idle' | 'running' | 'completed' | 'failed';
    costUsd?: number;
    latencyMs?: number;
    tokensIn?: number;
    tokensOut?: number;
    error?: string;
    [key: string]: unknown;
}

// ─── Shared Styles ────────────────────────────────────────────────────────

const agentConfig = {
    planner: { icon: Brain, color: '#8B5CF6', bg: '#8B5CF620', label: 'Planner' },
    executor: { icon: Cog, color: '#3B82F6', bg: '#3B82F620', label: 'Executor' },
    validator: { icon: ShieldCheck, color: '#10B981', bg: '#10B98120', label: 'Validator' },
    retrieval: { icon: Database, color: '#F59E0B', bg: '#F59E0B20', label: 'Retrieval' },
    custom: { icon: Sparkles, color: '#EC4899', bg: '#EC489920', label: 'Custom' },
};

function getStatusBorder(status?: string): string {
    switch (status) {
        case 'running': return '2px solid #3B82F6';
        case 'completed': return '2px solid #10B981';
        case 'failed': return '2px solid #EF4444';
        default: return '2px solid #334155';
    }
}

function StatusBadge({ status }: { status?: string }) {
    if (!status || status === 'idle') return null;
    const config = {
        running: { icon: Loader2, color: '#3B82F6', text: 'Running' },
        completed: { icon: CheckCircle, color: '#10B981', text: 'Done' },
        failed: { icon: AlertCircle, color: '#EF4444', text: 'Failed' },
    }[status];
    if (!config) return null;
    const Icon = config.icon;
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: config.color, fontSize: 11 }}>
            <Icon size={12} className={status === 'running' ? 'animate-spin' : ''} />
            {config.text}
        </div>
    );
}

// ─── Agent Node Component ─────────────────────────────────────────────────

function AgentNodeComponent({ data, selected }: NodeProps) {
    const nodeData = data as AgentNodeData;
    const config = agentConfig[nodeData.agentType] || agentConfig.custom;
    const Icon = config.icon;

    return (
        <div
            style={{
                background: '#0F172A',
                border: selected ? '2px solid #6366F1' : getStatusBorder(nodeData.status),
                borderRadius: 12,
                padding: '12px 16px',
                minWidth: 200,
                boxShadow: selected
                    ? '0 0 0 2px rgba(99, 102, 241, 0.3), 0 8px 32px rgba(0, 0, 0, 0.4)'
                    : '0 4px 24px rgba(0, 0, 0, 0.3)',
                fontFamily: "'Inter', sans-serif",
                transition: 'all 0.2s ease',
            }}
        >
            {/* Input Handle */}
            <Handle
                type="target"
                position={Position.Top}
                style={{
                    background: config.color,
                    width: 10,
                    height: 10,
                    border: '2px solid #0F172A',
                    top: -5,
                }}
            />

            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div
                        style={{
                            background: config.bg,
                            borderRadius: 8,
                            padding: 6,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}
                    >
                        <Icon size={16} color={config.color} />
                    </div>
                    <div>
                        <div style={{ color: '#F1F5F9', fontWeight: 600, fontSize: 13 }}>{nodeData.label}</div>
                        <div style={{ color: '#64748B', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                            {config.label}
                        </div>
                    </div>
                </div>
                <StatusBadge status={nodeData.status} />
            </div>

            {/* Provider Badge */}
            {nodeData.provider && (
                <div
                    style={{
                        background: '#1E293B',
                        borderRadius: 6,
                        padding: '4px 8px',
                        fontSize: 11,
                        color: '#94A3B8',
                        marginBottom: 6,
                        display: 'inline-block',
                    }}
                >
                    🤖 {nodeData.provider}
                </div>
            )}

            {/* Prompt Preview */}
            {nodeData.prompt && (
                <div
                    style={{
                        background: '#1E293B',
                        borderRadius: 6,
                        padding: '6px 8px',
                        fontSize: 11,
                        color: '#94A3B8',
                        marginBottom: 8,
                        maxHeight: 40,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        lineHeight: '1.4',
                    }}
                >
                    {nodeData.prompt.slice(0, 80)}{nodeData.prompt.length > 80 ? '…' : ''}
                </div>
            )}

            {/* Execution Metrics */}
            {(nodeData.costUsd !== undefined || nodeData.latencyMs !== undefined) && (
                <div
                    style={{
                        display: 'flex',
                        gap: 12,
                        borderTop: '1px solid #1E293B',
                        paddingTop: 6,
                        marginTop: 4,
                    }}
                >
                    {nodeData.costUsd !== undefined && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, color: '#10B981' }}>
                            <DollarSign size={10} />
                            {nodeData.costUsd.toFixed(4)}
                        </div>
                    )}
                    {nodeData.latencyMs !== undefined && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, color: '#60A5FA' }}>
                            <Clock size={10} />
                            {nodeData.latencyMs}ms
                        </div>
                    )}
                    {nodeData.tokensIn !== undefined && (
                        <div style={{ fontSize: 10, color: '#94A3B8' }}>
                            {nodeData.tokensIn}→{nodeData.tokensOut} tok
                        </div>
                    )}
                </div>
            )}

            {/* Error Display */}
            {nodeData.error && (
                <div
                    style={{
                        background: '#EF444420',
                        borderRadius: 6,
                        padding: '4px 8px',
                        fontSize: 10,
                        color: '#FCA5A5',
                        marginTop: 6,
                    }}
                >
                    ⚠ {nodeData.error.slice(0, 60)}
                </div>
            )}

            {/* Tools are now dynamically inferred during routing */}

            {/* Output Handle */}
            <Handle
                type="source"
                position={Position.Bottom}
                style={{
                    background: config.color,
                    width: 10,
                    height: 10,
                    border: '2px solid #0F172A',
                    bottom: -5,
                }}
            />
        </div>
    );
}

export const PlannerNode = memo(AgentNodeComponent);
export const ExecutorNode = memo(AgentNodeComponent);
export const ValidatorNode = memo(AgentNodeComponent);
export const RetrievalNode = memo(AgentNodeComponent);
export const CustomNode = memo(AgentNodeComponent);

export const nodeTypes = {
    planner: PlannerNode,
    executor: ExecutorNode,
    validator: ValidatorNode,
    retrieval: RetrievalNode,
    custom: CustomNode,
};

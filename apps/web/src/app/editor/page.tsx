'use client';

// ─── Agent Studio: Workflow Editor Page ───────────────────────────────────
// React Flow v12 canvas for visual DAG composition with custom agent nodes.

import React, { useCallback, useState, useRef } from 'react';
import {
    ReactFlow,
    Background,
    Controls,
    MiniMap,
    Panel,
    addEdge,
    useNodesState,
    useEdgesState,
    type Node,
    type Edge,
    type OnConnect,
    type OnNodesChange,
    type OnEdgesChange,
    BackgroundVariant,
    MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
    Plus,
    Save,
    Play,
    Upload,
    Trash2,
    Brain,
    Cog,
    ShieldCheck,
    Database,
    Sparkles,
    RotateCcw,
    CheckCircle,
    AlertTriangle,
} from 'lucide-react';
import { nodeTypes, type AgentNodeData } from '../../components/nodes/AgentNodes';
import { useProviderSettings } from '../../components/ProviderContext';

// ─── Default Workflow ─────────────────────────────────────────────────────

const defaultNodes: Node[] = [
    {
        id: 'planner-1',
        type: 'planner',
        position: { x: 300, y: 50 },
        data: {
            label: 'Task Planner',
            agentType: 'planner',
            prompt: 'Decompose the user request into discrete sub-tasks...',
            model: 'gpt-4o',
        } satisfies AgentNodeData,
    },
    {
        id: 'executor-1',
        type: 'executor',
        position: { x: 100, y: 250 },
        data: {
            label: 'Web Research',
            agentType: 'executor',
            prompt: 'Execute the assigned sub-task using available tools...',
            model: 'gpt-4o-mini',
            tools: ['web-search', 'http-request'],
        } satisfies AgentNodeData,
    },
    {
        id: 'executor-2',
        type: 'executor',
        position: { x: 500, y: 250 },
        data: {
            label: 'Data Analysis',
            agentType: 'executor',
            prompt: 'Analyze and transform the collected data...',
            model: 'gemini-2.5-flash',
            tools: ['json-transform'],
        } satisfies AgentNodeData,
    },
    {
        id: 'validator-1',
        type: 'validator',
        position: { x: 300, y: 450 },
        data: {
            label: 'Quality Gate',
            agentType: 'validator',
            prompt: 'Validate and synthesize the outputs from all executor agents...',
            model: 'claude-4-haiku',
        } satisfies AgentNodeData,
    },
];

const defaultEdges: Edge[] = [
    {
        id: 'e-planner-exec1',
        source: 'planner-1',
        target: 'executor-1',
        animated: true,
        style: { stroke: '#6366F1', strokeWidth: 2 },
        markerEnd: { type: MarkerType.ArrowClosed, color: '#6366F1' },
    },
    {
        id: 'e-planner-exec2',
        source: 'planner-1',
        target: 'executor-2',
        animated: true,
        style: { stroke: '#6366F1', strokeWidth: 2 },
        markerEnd: { type: MarkerType.ArrowClosed, color: '#6366F1' },
    },
    {
        id: 'e-exec1-validator',
        source: 'executor-1',
        target: 'validator-1',
        style: { stroke: '#6366F1', strokeWidth: 2 },
        markerEnd: { type: MarkerType.ArrowClosed, color: '#6366F1' },
    },
    {
        id: 'e-exec2-validator',
        source: 'executor-2',
        target: 'validator-1',
        style: { stroke: '#6366F1', strokeWidth: 2 },
        markerEnd: { type: MarkerType.ArrowClosed, color: '#6366F1' },
    },
];

// ─── Agent Type Palette ───────────────────────────────────────────────────

const agentPalette = [
    { type: 'planner', label: 'Planner', icon: Brain, color: '#8B5CF6' },
    { type: 'executor', label: 'Executor', icon: Cog, color: '#3B82F6' },
    { type: 'validator', label: 'Validator', icon: ShieldCheck, color: '#10B981' },
    { type: 'retrieval', label: 'Retrieval', icon: Database, color: '#F59E0B' },
    { type: 'custom', label: 'Custom', icon: Sparkles, color: '#EC4899' },
];

// ─── Editor Component ─────────────────────────────────────────────────────

export default function WorkflowEditorPage() {
    const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
    const [validationErrors, setValidationErrors] = useState<string[]>([]);
    const [isSaving, setIsSaving] = useState(false);
    const nodeCounter = useRef(5);
    const { globalProvider } = useProviderSettings();

    const selectedNode = nodes.find((n) => n.selected);

    const updateNodeData = useCallback((id: string, newData: Partial<AgentNodeData>) => {
        setNodes((nds) =>
            nds.map((node) => {
                if (node.id === id) {
                    return { ...node, data: { ...node.data, ...newData } as AgentNodeData };
                }
                return node;
            }),
        );
    }, [setNodes]);

    const onConnect: OnConnect = useCallback(
        (connection) => {
            setEdges((eds) =>
                addEdge(
                    {
                        ...connection,
                        animated: true,
                        style: { stroke: '#6366F1', strokeWidth: 2 },
                        markerEnd: { type: MarkerType.ArrowClosed, color: '#6366F1' },
                    },
                    eds,
                ),
            );
        },
        [setEdges],
    );

    const addNode = useCallback(
        (agentType: string) => {
            const id = `${agentType}-${nodeCounter.current++}`;
            const newNode: Node = {
                id,
                type: agentType,
                position: { x: 250 + Math.random() * 200, y: 150 + Math.random() * 200 },
                data: {
                    label: `New ${agentType.charAt(0).toUpperCase() + agentType.slice(1)}`,
                    agentType: agentType as AgentNodeData['agentType'],
                    prompt: '',
                } satisfies AgentNodeData,
            };
            setNodes((nds) => [...nds, newNode]);
        },
        [setNodes],
    );

    const validateGraph = useCallback(() => {
        const errors: string[] = [];

        // Check for orphan nodes (no connections)
        for (const node of nodes) {
            const hasInput = edges.some((e) => e.target === node.id);
            const hasOutput = edges.some((e) => e.source === node.id);
            if (!hasInput && !hasOutput) {
                errors.push(`Node "${(node.data as AgentNodeData).label}" is disconnected`);
            }
        }

        // Check for nodes without prompts
        for (const node of nodes) {
            const data = node.data as AgentNodeData;
            if (!data.prompt || data.prompt.trim() === '') {
                errors.push(`Node "${data.label}" has no prompt configured`);
            }
        }

        // Check for cycles (simple DFS)
        const adjacency = new Map<string, string[]>();
        for (const node of nodes) adjacency.set(node.id, []);
        for (const edge of edges) {
            adjacency.get(edge.source)?.push(edge.target);
        }

        const visited = new Set<string>();
        const recursionStack = new Set<string>();
        let hasCycle = false;

        function dfs(nodeId: string) {
            visited.add(nodeId);
            recursionStack.add(nodeId);
            for (const neighbor of adjacency.get(nodeId) ?? []) {
                if (!visited.has(neighbor)) {
                    dfs(neighbor);
                } else if (recursionStack.has(neighbor)) {
                    hasCycle = true;
                }
            }
            recursionStack.delete(nodeId);
        }

        for (const node of nodes) {
            if (!visited.has(node.id)) dfs(node.id);
        }
        if (hasCycle) errors.push('Graph contains a cycle — workflows must be acyclic (DAG)');

        setValidationErrors(errors);
        return errors.length === 0;
    }, [nodes, edges]);

    const handleSave = useCallback(async () => {
        setIsSaving(true);
        const isValid = validateGraph();
        if (!isValid) {
            setIsSaving(false);
            return null;
        }

        const workflow = {
            name: 'Custom Workflow',
            description: 'Workflow generated from editor',
            version: 1,
            nodes: nodes.map((n) => ({
                id: n.id,
                type: n.type,
                name: (n.data as AgentNodeData).label || n.id,
                prompt: (n.data as AgentNodeData).prompt || '',
                providerPreference: globalProvider,
                position: n.position,
            })),
            edges: edges.map((e) => ({
                id: e.id,
                source: e.source,
                target: e.target,
            })),
            entryNodeId: nodes.find(n => n.type === 'planner')?.id || nodes[0]?.id || 'unknown',
        };

        try {
            const res = await fetch('http://localhost:4000/api/workflows', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(workflow),
            });
            if (res.ok) {
                const data = await res.json();
                console.log('Workflow saved:', data);
                return data.id as string;
            } else {
                console.error('Failed to save workflow', await res.text());
                return null;
            }
        } catch (e) {
            console.error('Error saving workflow', e);
            return null;
        } finally {
            setIsSaving(false);
        }
    }, [nodes, edges, validateGraph, globalProvider]);

    const handleRun = useCallback(async () => {
        const workflowId = await handleSave();
        if (!workflowId) return;

        try {
            const res = await fetch('http://localhost:4000/api/runs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    workflowId: workflowId,
                    input: 'Execute the defined workflow from the Editor.',
                    maxCostUsd: 10.0
                }),
            });
            if (res.ok) {
                alert('Run started successfully! Check the Run History page.');
            } else {
                alert('Failed to start run.');
                console.error('Run failed:', await res.text());
            }
        } catch (e) {
            console.error('Error starting run', e);
            alert('Error starting run.');
        }
    }, [handleSave]);

    const handleClear = useCallback(() => {
        setNodes([]);
        setEdges([]);
        setValidationErrors([]);
    }, [setNodes, setEdges]);

    const handleDeleteNode = useCallback(() => {
        if (!selectedNode) return;
        setNodes((nds) => nds.filter((n) => n.id !== selectedNode.id));
        setEdges((eds) => eds.filter((e) => e.source !== selectedNode.id && e.target !== selectedNode.id));
    }, [selectedNode, setNodes, setEdges]);

    return (
        <div style={{ width: '100%', height: '100vh', background: '#0B0F1A' }}>
            <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                nodeTypes={nodeTypes}
                fitView
                minZoom={0.3}
                maxZoom={2}
                defaultEdgeOptions={{
                    animated: true,
                    style: { stroke: '#6366F1', strokeWidth: 2 },
                }}
                style={{ background: '#0B0F1A' }}
            >
                <Background
                    variant={BackgroundVariant.Dots}
                    gap={20}
                    size={1}
                    color="#1E293B"
                />
                <Controls
                    style={{
                        background: '#1E293B',
                        borderRadius: 8,
                        border: '1px solid #334155',
                    }}
                />
                <MiniMap
                    nodeColor={(node) => {
                        const colors: Record<string, string> = {
                            planner: '#8B5CF6',
                            executor: '#3B82F6',
                            validator: '#10B981',
                            retrieval: '#F59E0B',
                            custom: '#EC4899',
                        };
                        return colors[node.type ?? ''] ?? '#64748B';
                    }}
                    style={{
                        background: '#1E293B',
                        borderRadius: 8,
                        border: '1px solid #334155',
                    }}
                    maskColor="#0B0F1A80"
                />

                {/* ─── Top Toolbar ─────────────────────────────────────────── */}
                <Panel position="top-center">
                    <div
                        style={{
                            display: 'flex',
                            gap: 8,
                            background: '#1E293B',
                            borderRadius: 12,
                            padding: '8px 12px',
                            border: '1px solid #334155',
                            boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
                        }}
                    >
                        {agentPalette.map((agent) => {
                            const Icon = agent.icon;
                            return (
                                <button
                                    key={agent.type}
                                    onClick={() => addNode(agent.type)}
                                    title={`Add ${agent.label}`}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 6,
                                        background: '#0F172A',
                                        border: '1px solid #334155',
                                        borderRadius: 8,
                                        padding: '6px 12px',
                                        color: agent.color,
                                        cursor: 'pointer',
                                        fontSize: 12,
                                        fontWeight: 500,
                                        transition: 'all 0.15s ease',
                                    }}
                                >
                                    <Icon size={14} />
                                    {agent.label}
                                </button>
                            );
                        })}

                        <div style={{ width: 1, background: '#334155', margin: '0 4px' }} />

                        <button
                            onClick={validateGraph}
                            title="Validate DAG"
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 6,
                                background: '#0F172A',
                                border: '1px solid #334155',
                                borderRadius: 8,
                                padding: '6px 12px',
                                color: '#10B981',
                                cursor: 'pointer',
                                fontSize: 12,
                            }}
                        >
                            <CheckCircle size={14} />
                            Validate
                        </button>

                        <button
                            onClick={handleSave}
                            disabled={isSaving}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 6,
                                background: '#0F172A',
                                border: '1px solid #334155',
                                borderRadius: 8,
                                padding: '6px 16px',
                                color: '#fff',
                                cursor: 'pointer',
                                fontSize: 12,
                                fontWeight: 600,
                                opacity: isSaving ? 0.7 : 1,
                            }}
                        >
                            <Save size={14} />
                            {isSaving ? 'Saving…' : 'Save'}
                        </button>

                        <button
                            onClick={handleRun}
                            disabled={isSaving}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 6,
                                background: '#6366F1',
                                border: 'none',
                                borderRadius: 8,
                                padding: '6px 16px',
                                color: '#fff',
                                cursor: 'pointer',
                                fontSize: 12,
                                fontWeight: 600,
                                opacity: isSaving ? 0.7 : 1,
                            }}
                        >
                            <Play size={14} />
                            Run Workflow
                        </button>

                        <button
                            onClick={handleClear}
                            title="Clear canvas"
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 6,
                                background: '#0F172A',
                                border: '1px solid #334155',
                                borderRadius: 8,
                                padding: '6px 12px',
                                color: '#EF4444',
                                cursor: 'pointer',
                                fontSize: 12,
                            }}
                        >
                            <Trash2 size={14} />
                        </button>
                    </div>
                </Panel>

                {/* ─── Node Settings Panel ─────────────────────────────────── */}
                {selectedNode && (
                    <Panel position="top-right" style={{ width: 320, background: '#1E293B', borderRadius: 12, border: '1px solid #334155', display: 'flex', flexDirection: 'column', height: 'calc(100vh - 40px)', margin: '20px' }}>
                        <div style={{ padding: '16px', borderBottom: '1px solid #334155', fontWeight: 600, color: '#F1F5F9', display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Cog size={16} color="#94A3B8" />
                            Node Settings
                        </div>
                        <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: 16, overflowY: 'auto' }}>
                            <div>
                                <label style={{ display: 'block', fontSize: 12, color: '#94A3B8', marginBottom: 6 }}>Node ID</label>
                                <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#64748B', background: '#0F172A', padding: '6px 8px', borderRadius: 4, border: '1px solid #334155' }}>
                                    {selectedNode.id}
                                </div>
                            </div>
                            <div>
                                <label style={{ display: 'block', fontSize: 12, color: '#94A3B8', marginBottom: 6, fontWeight: 500 }}>Label</label>
                                <input
                                    type="text"
                                    value={(selectedNode.data as AgentNodeData).label}
                                    onChange={(e) => updateNodeData(selectedNode.id, { label: e.target.value })}
                                    style={{ width: '100%', background: '#0F172A', border: '1px solid #334155', borderRadius: 6, padding: '8px 12px', color: '#F1F5F9', fontSize: 13, outline: 'none' }}
                                />
                            </div>
                            <div>
                                <label style={{ display: 'block', fontSize: 12, color: '#94A3B8', marginBottom: 6, fontWeight: 500 }}>Prompt / Goal</label>
                                <textarea
                                    value={(selectedNode.data as AgentNodeData).prompt || ''}
                                    onChange={(e) => updateNodeData(selectedNode.id, { prompt: e.target.value })}
                                    rows={8}
                                    style={{ width: '100%', background: '#0F172A', border: '1px solid #334155', borderRadius: 6, padding: '8px 12px', color: '#F1F5F9', fontSize: 13, resize: 'vertical', outline: 'none' }}
                                    placeholder="Enter system prompt for this agent..."
                                />
                            </div>
                            <button
                                onClick={handleDeleteNode}
                                style={{
                                    marginTop: 16,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: 6,
                                    background: '#EF444420',
                                    border: '1px solid #EF444450',
                                    borderRadius: 6,
                                    padding: '8px',
                                    color: '#FCA5A5',
                                    cursor: 'pointer',
                                    fontSize: 13,
                                    fontWeight: 500,
                                    transition: 'background 0.15s ease'
                                }}
                                onMouseEnter={(e) => (e.currentTarget.style.background = '#EF444440')}
                                onMouseLeave={(e) => (e.currentTarget.style.background = '#EF444420')}
                            >
                                <Trash2 size={14} />
                                Delete Node
                            </button>
                        </div>
                    </Panel>
                )}

                {/* ─── Validation Errors ───────────────────────────────────── */}
                {validationErrors.length > 0 && (
                    <Panel position="bottom-center">
                        <div
                            style={{
                                background: '#EF444420',
                                border: '1px solid #EF4444',
                                borderRadius: 12,
                                padding: '12px 16px',
                                maxWidth: 500,
                            }}
                        >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, color: '#FCA5A5', fontSize: 13, fontWeight: 600 }}>
                                <AlertTriangle size={14} />
                                Validation Errors ({validationErrors.length})
                            </div>
                            {validationErrors.map((err, i) => (
                                <div key={i} style={{ color: '#FCA5A5', fontSize: 11, marginBottom: 2 }}>
                                    • {err}
                                </div>
                            ))}
                        </div>
                    </Panel>
                )}
            </ReactFlow>
        </div>
    );
}

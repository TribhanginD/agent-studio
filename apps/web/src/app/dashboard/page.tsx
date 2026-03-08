'use client';

// ─── Agent Studio: Dashboard Page ─────────────────────────────────────────
// Cost & performance charts using Recharts.

import React from 'react';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
    PieChart, Pie, Cell, ResponsiveContainer,
    AreaChart, Area,
    LineChart, Line,
} from 'recharts';
import { DollarSign, Clock, Zap, Activity, TrendingUp, Cpu } from 'lucide-react';

// ─── Mock Data ────────────────────────────────────────────────────────────

const costByModel = [
    { model: 'GPT-4o', cost: 2.45, calls: 128 },
    { model: 'GPT-4o Mini', cost: 0.32, calls: 456 },
    { model: 'Claude 4 Sonnet', cost: 1.87, calls: 95 },
    { model: 'Claude 4 Haiku', cost: 0.18, calls: 312 },
    { model: 'Gemini 2.5 Pro', cost: 0.95, calls: 67 },
    { model: 'Gemini 2.5 Flash', cost: 0.08, calls: 523 },
];

const dailyCost = Array.from({ length: 14 }, (_, i) => ({
    date: `Mar ${i + 1}`,
    cost: Math.random() * 2 + 0.5,
    budget: 5.0,
}));

const pieData = [
    { name: 'OpenAI', value: 2.77, color: '#10B981' },
    { name: 'Anthropic', value: 2.05, color: '#6366F1' },
    { name: 'Google', value: 1.03, color: '#F59E0B' },
];

const latencyPerAgent = [
    { agent: 'Planner', p50: 1200, p95: 3500 },
    { agent: 'Executor', p50: 2100, p95: 5200 },
    { agent: 'Validator', p50: 800, p95: 2100 },
    { agent: 'Retrieval', p50: 450, p95: 1100 },
];

const toolSuccess = Array.from({ length: 7 }, (_, i) => ({
    day: `Day ${i + 1}`,
    success: Math.floor(Math.random() * 50) + 80,
    failure: Math.floor(Math.random() * 5),
}));

// ─── Stat Card ────────────────────────────────────────────────────────────

function StatCard({ title, value, subtitle, icon: Icon, color }: {
    title: string; value: string; subtitle: string;
    icon: React.ComponentType<{ size: number; color: string }>;
    color: string;
}) {
    return (
        <div style={{
            background: '#1E293B', borderRadius: 12, padding: '20px 24px',
            border: '1px solid #334155', flex: 1, minWidth: 180,
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                    <div style={{ color: '#94A3B8', fontSize: 12, marginBottom: 4 }}>{title}</div>
                    <div style={{ color: '#F1F5F9', fontSize: 28, fontWeight: 700 }}>{value}</div>
                    <div style={{ color: '#64748B', fontSize: 11, marginTop: 4 }}>{subtitle}</div>
                </div>
                <div style={{ background: `${color}20`, borderRadius: 8, padding: 8 }}>
                    <Icon size={20} color={color} />
                </div>
            </div>
        </div>
    );
}

// ─── Dashboard ────────────────────────────────────────────────────────────

export default function DashboardPage() {
    return (
        <div style={{
            minHeight: '100vh', background: '#0B0F1A', padding: '32px 40px',
            fontFamily: "'Inter', sans-serif",
        }}>
            <h1 style={{ color: '#F1F5F9', fontSize: 24, fontWeight: 700, marginBottom: 8 }}>
                Dashboard
            </h1>
            <p style={{ color: '#64748B', fontSize: 14, marginBottom: 32 }}>
                Real-time cost, performance, and reliability metrics
            </p>

            {/* ─── Stats Row ───────────────────────────────────────────── */}
            <div style={{ display: 'flex', gap: 16, marginBottom: 32, flexWrap: 'wrap' }}>
                <StatCard title="Total Cost (24h)" value="$5.85" subtitle="↓ 12% vs yesterday" icon={DollarSign} color="#10B981" />
                <StatCard title="Active Runs" value="3" subtitle="2 queued" icon={Activity} color="#3B82F6" />
                <StatCard title="Avg Latency" value="1.8s" subtitle="p50 across all agents" icon={Clock} color="#F59E0B" />
                <StatCard title="Tool Success" value="97.2%" subtitle="Last 1,000 calls" icon={Zap} color="#8B5CF6" />
                <StatCard title="Total Tokens" value="2.1M" subtitle="↑ 8% vs yesterday" icon={TrendingUp} color="#EC4899" />
            </div>

            {/* ─── Charts Grid ─────────────────────────────────────────── */}
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16, marginBottom: 24 }}>
                {/* Daily Cost Trend */}
                <div style={{ background: '#1E293B', borderRadius: 12, padding: 24, border: '1px solid #334155' }}>
                    <h3 style={{ color: '#F1F5F9', fontSize: 14, fontWeight: 600, marginBottom: 16 }}>
                        Daily Cost vs Budget
                    </h3>
                    <ResponsiveContainer width="100%" height={250}>
                        <AreaChart data={dailyCost}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                            <XAxis dataKey="date" stroke="#64748B" fontSize={11} />
                            <YAxis stroke="#64748B" fontSize={11} tickFormatter={(v) => `$${v}`} />
                            <Tooltip
                                contentStyle={{ background: '#0F172A', border: '1px solid #334155', borderRadius: 8 }}
                                labelStyle={{ color: '#F1F5F9' }}
                            />
                            <Area type="monotone" dataKey="cost" strokeWidth={2} stroke="#6366F1" fill="#6366F120" />
                            <Line type="monotone" dataKey="budget" stroke="#EF4444" strokeDasharray="5 5" dot={false} />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>

                {/* Cost by Provider Pie */}
                <div style={{ background: '#1E293B', borderRadius: 12, padding: 24, border: '1px solid #334155' }}>
                    <h3 style={{ color: '#F1F5F9', fontSize: 14, fontWeight: 600, marginBottom: 16 }}>
                        Cost by Provider
                    </h3>
                    <ResponsiveContainer width="100%" height={250}>
                        <PieChart>
                            <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value" label={({ name, value }) => `${name}: $${value.toFixed(2)}`}>
                                {pieData.map((entry, i) => (
                                    <Cell key={i} fill={entry.color} />
                                ))}
                            </Pie>
                            <Tooltip contentStyle={{ background: '#0F172A', border: '1px solid #334155', borderRadius: 8 }} />
                        </PieChart>
                    </ResponsiveContainer>
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                {/* Cost by Model */}
                <div style={{ background: '#1E293B', borderRadius: 12, padding: 24, border: '1px solid #334155' }}>
                    <h3 style={{ color: '#F1F5F9', fontSize: 14, fontWeight: 600, marginBottom: 16 }}>
                        Cost by Model
                    </h3>
                    <ResponsiveContainer width="100%" height={250}>
                        <BarChart data={costByModel} layout="vertical">
                            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                            <XAxis type="number" stroke="#64748B" fontSize={11} tickFormatter={(v) => `$${v}`} />
                            <YAxis dataKey="model" type="category" stroke="#64748B" fontSize={11} width={110} />
                            <Tooltip contentStyle={{ background: '#0F172A', border: '1px solid #334155', borderRadius: 8 }} />
                            <Bar dataKey="cost" fill="#6366F1" radius={[0, 4, 4, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                </div>

                {/* Latency by Agent Type */}
                <div style={{ background: '#1E293B', borderRadius: 12, padding: 24, border: '1px solid #334155' }}>
                    <h3 style={{ color: '#F1F5F9', fontSize: 14, fontWeight: 600, marginBottom: 16 }}>
                        Latency by Agent (ms)
                    </h3>
                    <ResponsiveContainer width="100%" height={250}>
                        <BarChart data={latencyPerAgent}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                            <XAxis dataKey="agent" stroke="#64748B" fontSize={11} />
                            <YAxis stroke="#64748B" fontSize={11} />
                            <Tooltip contentStyle={{ background: '#0F172A', border: '1px solid #334155', borderRadius: 8 }} />
                            <Legend />
                            <Bar dataKey="p50" fill="#3B82F6" radius={[4, 4, 0, 0]} name="P50" />
                            <Bar dataKey="p95" fill="#F59E0B" radius={[4, 4, 0, 0]} name="P95" />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </div>
        </div>
    );
}

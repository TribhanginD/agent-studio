'use client';

// ─── Agent Studio: Sidebar Navigation ─────────────────────────────────────

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
    LayoutDashboard,
    GitBranch,
    History,
    Settings,
    Boxes,
    Zap,
} from 'lucide-react';
import { useProviderSettings } from './ProviderContext';

const navItems = [
    { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { href: '/editor', label: 'Workflow Editor', icon: GitBranch },
    { href: '/runs', label: 'Run History', icon: History },
];

export function Sidebar() {
    const pathname = usePathname();
    const { globalProvider, setGlobalProvider } = useProviderSettings();

    return (
        <nav
            style={{
                width: 240,
                height: '100vh',
                background: '#0F172A',
                borderRight: '1px solid #1E293B',
                display: 'flex',
                flexDirection: 'column',
                padding: '24px 16px',
                position: 'fixed',
                left: 0,
                top: 0,
                fontFamily: "'Inter', sans-serif",
            }}
        >
            {/* ─── Logo ──────────────────────────────────────────────── */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 40 }}>
                <div
                    style={{
                        background: 'linear-gradient(135deg, #6366F1, #8B5CF6)',
                        borderRadius: 10,
                        padding: 8,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}
                >
                    <Boxes size={20} color="#fff" />
                </div>
                <div>
                    <div style={{ color: '#F1F5F9', fontSize: 16, fontWeight: 700, letterSpacing: '-0.02em' }}>
                        Agent Studio
                    </div>
                    <div style={{ color: '#64748B', fontSize: 10, letterSpacing: '0.05em' }}>
                        ORCHESTRATION PLATFORM
                    </div>
                </div>
            </div>

            {/* ─── Nav Items ─────────────────────────────────────────── */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {navItems.map((item) => {
                    const Icon = item.icon;
                    const isActive = pathname === item.href;

                    return (
                        <Link
                            key={item.href}
                            href={item.href}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 12,
                                padding: '10px 12px',
                                borderRadius: 8,
                                color: isActive ? '#F1F5F9' : '#94A3B8',
                                background: isActive ? '#6366F120' : 'transparent',
                                textDecoration: 'none',
                                fontSize: 13,
                                fontWeight: isActive ? 600 : 400,
                                transition: 'all 0.15s ease',
                            }}
                        >
                            <Icon size={18} color={isActive ? '#6366F1' : '#64748B'} />
                            {item.label}
                            {isActive && (
                                <div style={{
                                    marginLeft: 'auto',
                                    width: 3,
                                    height: 16,
                                    borderRadius: 2,
                                    background: '#6366F1',
                                }} />
                            )}
                        </Link>
                    );
                })}
            </div>

            {/* ─── Bottom Section ────────────────────────────────────── */}
            <div style={{ marginTop: 'auto' }}>
                <div style={{ marginBottom: 16 }}>
                    <label style={{ display: 'block', fontSize: 12, color: '#94A3B8', marginBottom: 6, paddingLeft: 12, fontWeight: 500 }}>Global AI Provider</label>
                    <select
                        value={globalProvider}
                        onChange={(e) => setGlobalProvider(e.target.value)}
                        style={{ width: '100%', background: '#1E293B', border: '1px solid #334155', borderRadius: 8, padding: '10px 12px', color: '#F1F5F9', fontSize: 13, outline: 'none' }}
                    >
                        <option value="openai">OpenAI</option>
                        <option value="anthropic">Anthropic</option>
                        <option value="google">Google</option>
                        <option value="groq">Groq</option>
                        <option value="local">Local</option>
                    </select>
                </div>

                <div
                    style={{
                        background: '#1E293B',
                        borderRadius: 10,
                        padding: '12px 14px',
                        marginBottom: 16,
                    }}
                >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <Zap size={14} color="#F59E0B" />
                        <span style={{ color: '#F1F5F9', fontSize: 12, fontWeight: 600 }}>Cost Budget</span>
                    </div>
                    <div style={{ background: '#0F172A', borderRadius: 4, height: 6, overflow: 'hidden', marginBottom: 4 }}>
                        <div style={{ background: 'linear-gradient(90deg, #10B981, #6366F1)', height: '100%', width: '42%', borderRadius: 4 }} />
                    </div>
                    <div style={{ color: '#64748B', fontSize: 10 }}>$5.85 / $50.00 this month</div>
                </div>

                <Link
                    href="/settings"
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        padding: '10px 12px',
                        borderRadius: 8,
                        color: '#64748B',
                        textDecoration: 'none',
                        fontSize: 13,
                    }}
                >
                    <Settings size={18} />
                    Settings
                </Link>
            </div>
        </nav>
    );
}

'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';

type ProviderConfig = {
    globalProvider: string;
    setGlobalProvider: (p: string) => void;
};

const ProviderContext = createContext<ProviderConfig | undefined>(undefined);

export function ProviderSettingsProvider({ children }: { children: React.ReactNode }) {
    const [globalProvider, setGlobalProvider] = useState('openai');
    const [isMounted, setIsMounted] = useState(false);

    useEffect(() => {
        setIsMounted(true);
        const stored = localStorage.getItem('agent-studio-global-provider');
        if (stored) setGlobalProvider(stored);
    }, []);

    const handleSetProvider = (p: string) => {
        setGlobalProvider(p);
        localStorage.setItem('agent-studio-global-provider', p);
    };

    if (!isMounted) {
        return <>{children}</>;
    }

    return (
        <ProviderContext.Provider value={{ globalProvider, setGlobalProvider: handleSetProvider }}>
            {children}
        </ProviderContext.Provider>
    );
}

export function useProviderSettings() {
    const context = useContext(ProviderContext);
    if (!context) {
        // Fallback or throw based on preference. Next.js might render things early on server before mounting.
        return { globalProvider: 'openai', setGlobalProvider: () => { } };
    }
    return context;
}

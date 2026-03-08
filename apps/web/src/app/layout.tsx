import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Sidebar } from "../components/Sidebar";
import { ProviderSettingsProvider } from "../components/ProviderContext";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Agent Studio — Multi-Agent Orchestration Platform",
  description: "Guardrailed, cost-aware multi-agent orchestration for production AI workflows",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className} suppressHydrationWarning style={{ margin: 0, display: 'flex' }}>
        <ProviderSettingsProvider>
          <Sidebar />
          <main style={{ flex: 1, marginLeft: 240 }}>
            {children}
          </main>
        </ProviderSettingsProvider>
      </body>
    </html>
  );
}

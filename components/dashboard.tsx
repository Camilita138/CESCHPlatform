"use client";

import { useCallback, useState } from "react";
import { Sidebar } from "@/components/sidebar";
import { ToolsHub } from "@/components/tools-hub";
import { ProcessingStatus } from "@/components/processing-status";
import { ResultsGrid } from "@/components/results-grid";
import { HistoryPanel } from "@/components/history-panel";
import { SettingsPanel } from "@/components/settings-panel";
import { LiquidacionCompleta } from "@/components/liquidacion-completa";

type ActiveView =
  | "herramientas"
  | "procesando"
  | "resultados"
  | "historial"
  | "configuracion";

type ToolStartPayload = {
  toolId: "liquidacion-completa" | string;
  [key: string]: unknown;
};

export function Dashboard() {
  const [activeView, setActiveView] = useState<ActiveView>("herramientas");
  const [processingData, setProcessingData] = useState<ToolStartPayload | null>(null);
  const [results, setResults] = useState<any>(null);

  const handleToolStart = useCallback((data: ToolStartPayload) => {
    setResults(null);
    setProcessingData(data ?? { toolId: "" });
    setActiveView("procesando");
  }, []);

  const handleProcessingComplete = useCallback((data: any) => {
    setResults(data ?? {});
    setActiveView("resultados");
  }, []);

  const renderMainContent = () => {
    switch (activeView) {
      case "herramientas":
        return <ToolsHub onToolStart={handleToolStart} />;
      case "procesando":
        if (processingData?.toolId === "liquidacion-completa") {
          return <LiquidacionCompleta onComplete={handleProcessingComplete} />;
        }
        return (
          <ProcessingStatus data={processingData} onComplete={handleProcessingComplete} />
        );
      case "resultados":
        return <ResultsGrid data={results} />;
      case "historial":
        return <HistoryPanel />;
      case "configuracion":
        return <SettingsPanel />;
      default:
        return <ToolsHub onToolStart={handleToolStart} />;
    }
  };

  return (
    <div className="flex h-screen bg-background">
      {/* 👇 Pasamos un wrapper para que el tipo encaje perfecto */}
      <Sidebar activeView={activeView} onViewChange={(v) => setActiveView(v)} />
      <main className="flex-1 overflow-auto">
        <div className="p-6">{renderMainContent()}</div>
      </main>
    </div>
  );
}

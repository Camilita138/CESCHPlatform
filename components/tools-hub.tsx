// components/tools-hub.tsx
"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  FileImage,
  ScanSearch,
  Plus,
  ArrowRight,
  CheckCircle,
  Table as TableIcon,
} from "lucide-react";

interface ToolsHubProps {
  onToolStart: (data: { toolId: string; [key: string]: unknown }) => void;
}

type Tool = {
  id: "pdf-images" | "liquidacion-completa" | "proforma";
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  category: string;
  status: "available";
  features: string[];
};

const tools: Tool[] = [
  {
    id: "proforma",
    title: "Lector de Proformas",
    description:
      "Sube una proforma (PDF/imagen/Excel), extráela como tabla editable y prepara el payload para la liquidación.",
    icon: TableIcon,
    category: "Documentos",
    status: "available",
    features: [
      "Soporte PDF/Imagen/Excel",
      "Normalización de columnas",
      "Edición previa a liquidación",
    ],
  },
  {
    id: "pdf-images",
    title: "Extractor de Imágenes PDF",
    description:
      "Extrae todas las imágenes de documentos PDF y las organiza automáticamente.",
    icon: FileImage,
    category: "Documentos",
    status: "available",
    features: [
      "Extracción automática",
      "Organización en Drive",
      "Creación de hojas",
    ],
  },
  {
    id: "liquidacion-completa",
    title: "Liquidación Completa",
    description:
      "Extrae imágenes de PDF y clasifica arancelariamente usando IA. Genera la liquidación en Google Sheets.",
    icon: ScanSearch,
    category: "Clasificación Arancelaria",
    status: "available",
    features: [
      "Extracción de imágenes",
      "Clasificación con IA",
      "Códigos arancelarios",
      "Hojas automáticas",
    ],
  },
];

function StatusBadge() {
  return (
    <Badge variant="default" className="gap-1">
      <CheckCircle className="h-3 w-3" />
      Disponible
    </Badge>
  );
}

function AddCard() {
  return (
    <Card className="h-full border-dashed">
      <CardHeader className="items-center text-center">
        <div className="rounded-full border-dashed border p-3">
          <Plus className="h-6 w-6" />
        </div>
        <CardTitle>Agregar herramienta</CardTitle>
        <CardDescription>
          Espacio reservado para futuras integraciones
        </CardDescription>
      </CardHeader>
      <CardContent className="flex justify-center pb-6">
        <Badge variant="outline">Próximamente</Badge>
      </CardContent>
    </Card>
  );
}

export function ToolsHub({ onToolStart }: ToolsHubProps) {
  const [selectedTool, setSelectedTool] = useState<Tool["id"] | null>(null);

  const handleToolSelect = (toolId: Tool["id"]) => {
    const tool = tools.find((t) => t.id === toolId);
    if (!tool) return;

    onToolStart({
      toolId,
      toolName: tool.title,
      startTime: new Date().toISOString(),
    });
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="text-center space-y-2">
        <h1 className="text-3xl font-bold text-balance">
          Centro de Herramientas Digitales
        </h1>
        <p className="text-muted-foreground text-pretty">
          Selecciona una herramienta para automatizar tus tareas y optimizar tu
          flujo de trabajo
        </p>
      </div>

      {/* 🧱 GRID PRINCIPAL DE HERRAMIENTAS */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {tools.map((tool) => {
          const Icon = tool.icon;
          const isSelected = selectedTool === tool.id;

          // 🚫 Herramientas bloqueadas
          const disabledTools = ["proforma", "pdf-images"];
          const isDisabled = disabledTools.includes(tool.id);

          return (
            <Card
              key={tool.id}
              className={`relative transition-all ${
                isDisabled
                  ? "opacity-50 cursor-not-allowed pointer-events-none"
                  : "cursor-pointer hover:shadow-lg"
              } ${isSelected ? "ring-2 ring-accent" : ""}`}
              onClick={() => !isDisabled && setSelectedTool(tool.id)}
            >
              {/* Overlay si está bloqueada */}
              {isDisabled && (
                <div className="absolute inset-0 bg-background/70 backdrop-blur-[1px] flex items-center justify-center z-10 rounded-md">
                  <span className="text-sm font-medium text-muted-foreground">
                    🔒 No disponible temporalmente
                  </span>
                </div>
              )}

              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-accent/10 rounded-lg">
                      <Icon className="h-6 w-6 text-accent" />
                    </div>
                    <div>
                      <CardTitle className="text-lg">{tool.title}</CardTitle>
                      <Badge variant="outline" className="text-xs mt-1">
                        {tool.category}
                      </Badge>
                    </div>
                  </div>
                  <StatusBadge />
                </div>
                <CardDescription className="text-sm">
                  {tool.description}
                </CardDescription>
              </CardHeader>

              <CardContent>
                <div className="space-y-4">
                  <div>
                    <h4 className="text-sm font-medium mb-2">Características:</h4>
                    <ul className="text-xs text-muted-foreground space-y-1">
                      {tool.features.map((feature, index) => (
                        <li key={index} className="flex items-center gap-2">
                          <div className="w-1 h-1 bg-accent rounded-full" />
                          {feature}
                        </li>
                      ))}
                    </ul>
                  </div>

                  {isSelected && !isDisabled && (
                    <Button
                      onClick={() => handleToolSelect(tool.id)}
                      className="w-full gap-2"
                    >
                      Iniciar Herramienta
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}

        {/* Placeholder con “+” */}
        <AddCard />
      </div>

      {/* 🧩 Métricas inferiores */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-8">
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold text-accent">{tools.length}</div>
            <div className="text-sm text-muted-foreground">
              Herramientas Disponibles
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold text-accent">24/7</div>
            <div className="text-sm text-muted-foreground">Disponibilidad</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold text-accent">∞</div>
            <div className="text-sm text-muted-foreground">Escalabilidad</div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default ToolsHub;

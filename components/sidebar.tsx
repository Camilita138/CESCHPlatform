"use client";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Wrench,
  Activity,
  FolderOpen,
  History,
  Settings,
  FileImage,
  FileSpreadsheet,
  Database,
  Zap,
} from "lucide-react";

/** Exporta el tipo para reutilizarlo en Dashboard */
export type ActiveView =
  | "herramientas"
  | "procesando"
  | "resultados"
  | "historial"
  | "configuracion";

type SidebarProps = {
  activeView: ActiveView;
  onViewChange: (view: ActiveView) => void;
};

const navigation: { id: ActiveView; label: string; icon: any }[] = [
  { id: "herramientas", label: "Herramientas", icon: Wrench },
  { id: "procesando", label: "Procesando", icon: Activity },
  { id: "resultados", label: "Resultados", icon: FolderOpen },
  { id: "historial", label: "Historial", icon: History },
  { id: "configuracion", label: "Configuración", icon: Settings },
];

export function Sidebar({ activeView, onViewChange }: SidebarProps) {
  return (
    <aside className="w-64 bg-sidebar border-r border-sidebar-border">
      <div className="p-6">
        {/* Header */}
        <div className="mb-8 flex items-center gap-2">
          <Zap className="h-8 w-8 text-accent" />
          <div>
            <h1 className="text-xl font-semibold text-sidebar-foreground">
              Centro Digital
            </h1>
            <p className="text-sm text-muted-foreground">
              Herramientas de Automatización
            </p>
          </div>
        </div>

        {/* Navegación principal */}
        <nav className="space-y-2">
          {navigation.map((item) => {
            const Icon = item.icon;
            const active = activeView === item.id;
            return (
              <Button
                key={item.id}
                aria-current={active ? "page" : undefined}
                variant={active ? "default" : "ghost"}
                className={cn(
                  "w-full justify-start gap-3",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground hover:bg-sidebar-accent/50"
                )}
                onClick={() => onViewChange(item.id)}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Button>
            );
          })}
        </nav>

        {/* Acceso rápido (opcional) */}
        <div className="mt-8 border-t border-sidebar-border pt-6">
          <h3 className="mb-3 text-sm font-medium text-sidebar-foreground">
            Acceso Rápido
          </h3>
          <div className="space-y-1">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start gap-2 text-xs"
            >
              <FileImage className="h-3 w-3" />
              Extraer Imágenes
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start gap-2 text-xs"
            >
              <FileSpreadsheet className="h-3 w-3" />
              Crear Hojas
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start gap-2 text-xs"
            >
              <Database className="h-3 w-3" />
              Sincronizar Drive
            </Button>
          </div>
        </div>
      </div>
    </aside>
  );
}

export default Sidebar;

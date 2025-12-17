"use client"

import type React from "react"

import { useState, useCallback } from "react"
import { useDropzone } from "react-dropzone"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Upload, FileText, AlertCircle, CheckCircle, Clock, FileImage, Brain, Sheet, ExternalLink, ArrowLeft } from "lucide-react";

interface LiquidacionCompletaProps {
  onComplete?: (results: any) => void;
  onBack?: () => void;
}


interface ProcessingStep {
  id: string
  label: string
  icon: any
  status: "pending" | "processing" | "completed" | "error"
}

interface ClassificationResult {
  imageUrl: string
  imageName: string
  hsCode: string
  commercialName: string
  confidence: number
  reason: string
}

export function LiquidacionCompleta({ onComplete, onBack }: LiquidacionCompletaProps) {
  const [file, setFile] = useState<File | null>(null)
  const [documentName, setDocumentName] = useState("")
  const [folderUrl, setFolderUrl] = useState("")
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState("")
  const [progress, setProgress] = useState(0)
  const [currentStep, setCurrentStep] = useState(0)

  // Mantengo compatibilidad por si tu backend todavía devuelve sheetUrl (flujo viejo)
  const [results, setResults] = useState<{
    totalImages: number
    sheetUrl: string
    driveFolder: string
    classifications: ClassificationResult[]
  } | null>(null)

  // Para PREP solo mostramos 3 pasos (Drive/Sheets ocurren luego al “Publicar”)
  const processingSteps: ProcessingStep[] = [
    { id: "upload",  label: "Subiendo PDF",        icon: Upload,   status: "pending" },
    { id: "extract", label: "Extrayendo Imágenes", icon: FileImage, status: "pending" },
    { id: "classify",label: "Clasificando con IA", icon: Brain,     status: "pending" },
  ]

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const pdfFile = acceptedFiles.find((file) => file.type === "application/pdf")
    if (pdfFile) {
      setFile(pdfFile)
      setError("")
    } else {
      setError("Por favor sube solo archivos PDF")
    }
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "application/pdf": [".pdf"] },
    multiple: false,
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!file || !documentName || !folderUrl) {
      setError("Por favor completa todos los campos y selecciona un archivo PDF")
      return
    }

    setIsProcessing(true)
    setError("")
    setProgress(0)
    setCurrentStep(0)

    try {
      const formData = new FormData()
      formData.append("pdf_file", file)
      formData.append("doc_name", documentName)
      formData.append("folder_url", folderUrl)

      // Simular progreso mientras se procesa
      const progressInterval = setInterval(() => {
        setProgress((prev) => {
          const newProgress = prev + Math.random() * 12
          const stepIndex = Math.min(
            Math.floor((newProgress / 100) * processingSteps.length),
            processingSteps.length - 1
          )
          if (stepIndex !== currentStep) setCurrentStep(stepIndex)
          return Math.min(newProgress, 95)
        })
      }, 900)

      const response = await fetch("/api/liquidacion", { method: "POST", body: formData })
      clearInterval(progressInterval)

      const result = await response.json()
      if (!response.ok) throw new Error(result?.error || `Error del servidor: ${response.status}`)

      setProgress(100)
      setCurrentStep(processingSteps.length - 1)

      // NUEVO: flujo PREP → trae { documentName, folderUrl, images[] }
      if (result?.images && Array.isArray(result.images)) {
        setIsProcessing(false)
        // manda al ResultsGrid (pantalla de revisión) vía prop
        onComplete?.(result)
        return
      }

      // COMPAT: si llega el flujo viejo (con sheetUrl), mostramos el panel de resultados
      if (result?.sheetUrl) {
        setResults(result)
      } else {
        // Si no es ninguno, al menos entregamos al caller
        onComplete?.(result)
      }
    } catch (err) {
      setError(`Error al procesar: ${err instanceof Error ? err.message : "Error desconocido"}`)
    } finally {
      setIsProcessing(false)
    }
  }

  const resetForm = () => {
    setFile(null)
    setDocumentName("")
    setFolderUrl("")
    setIsProcessing(false)
    setError("")
    setProgress(0)
    setCurrentStep(0)
    setResults(null)
  }

  // ==== Vista de resultados (solo para compat con flujo viejo) ====
  if (results) {
    return (
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-2">
            <h1 className="text-3xl font-bold text-balance">Liquidación Completa</h1>
            <p className="text-muted-foreground text-pretty">
              Extrae imágenes de PDF y las clasifica arancelariamente usando inteligencia artificial
            </p>
          </div>

          {onBack && (
            <Button
              type="button"
              variant="outline"
              className="shrink-0 gap-2"
              onClick={onBack}
            >
              <ArrowLeft className="h-4 w-4" />
              Volver
            </Button>
          )}
        </div>


        {/* Resumen */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-accent">{results.totalImages}</div>
              <div className="text-sm text-muted-foreground">Imágenes Procesadas</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-accent">
                {results.classifications.filter((c) => c.hsCode).length}
              </div>
              <div className="text-sm text-muted-foreground">Clasificaciones Exitosas</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-accent">
                {(
                  (results.classifications.reduce((acc, c) => acc + c.confidence, 0) / results.classifications.length) *
                  100
                ).toFixed(0)}
                %
              </div>
              <div className="text-sm text-muted-foreground">Confianza Promedio</div>
            </CardContent>
          </Card>
        </div>

        {/* Enlaces */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <Sheet className="h-8 w-8 text-green-600" />
                <div className="flex-1">
                  <h3 className="font-medium">Google Sheet Creado</h3>
                  <p className="text-sm text-muted-foreground">Hoja con clasificaciones arancelarias</p>
                </div>
                <Button variant="outline" size="sm" asChild>
                  <a href={results.sheetUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </Button>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <Upload className="h-8 w-8 text-blue-600" />
                <div className="flex-1">
                  <h3 className="font-medium">Carpeta de Drive</h3>
                  <p className="text-sm text-muted-foreground">Imágenes organizadas</p>
                </div>
                <Button variant="outline" size="sm" asChild>
                  <a href={results.driveFolder} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Tabla de Resultados */}
        <Card>
          <CardHeader>
            <CardTitle>Clasificaciones Arancelarias</CardTitle>
            <CardDescription>Resultados de la clasificación automática con IA</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b">
                    <th className="text-left p-2">Vista Previa</th>
                    <th className="text-left p-2">Imagen</th>
                    <th className="text-left p-2">Partida Arancelaria</th>
                    <th className="text-left p-2">Nombre Comercial</th>
                    <th className="text-left p-2">Confianza</th>
                    <th className="text-left p-2">Justificación</th>
                  </tr>
                </thead>
                <tbody>
                  {results.classifications.map((item, index) => (
                    <tr key={index} className="border-b hover:bg-muted/50">
                      <td className="p-2">
                        <div className="w-16 h-16 bg-muted rounded flex items-center justify-center overflow-hidden">
                          <img
                            src={item.imageUrl || "/placeholder.svg"}
                            alt={item.imageName}
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              const target = e.target as HTMLImageElement
                              target.style.display = "none"
                              const parent = target.parentElement!
                              parent.innerHTML =
                                '<div class="flex items-center justify-center w-full h-full"><svg class="h-6 w-6 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path></svg></div>'
                            }}
                          />
                        </div>
                      </td>
                      <td className="p-2 font-mono text-sm">{item.imageName}</td>
                      <td className="p-2">
                        {item.hsCode ? (
                          <Badge variant="default">{item.hsCode}</Badge>
                        ) : (
                          <Badge variant="secondary">Sin clasificar</Badge>
                        )}
                      </td>
                      <td className="p-2">{item.commercialName || "-"}</td>
                      <td className="p-2">
                        <div className="flex items-center gap-2">
                          <div className="w-16 bg-muted rounded-full h-2">
                            <div
                              className="bg-accent h-2 rounded-full"
                              style={{ width: `${item.confidence * 100}%` }}
                            />
                          </div>
                          <span className="text-sm">{(item.confidence * 100).toFixed(0)}%</span>
                        </div>
                      </td>
                      <td className="p-2 text-sm text-muted-foreground max-w-xs truncate">{item.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-center">
          <Button onClick={resetForm} variant="outline">
            Procesar Otro Documento
          </Button>
        </div>
      </div>
    )
  }

  // ==== Vista de formulario / progreso (PREP) ====
  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="text-center space-y-2">
        <h1 className="text-3xl font-bold text-balance">Liquidación Completa</h1>
        <p className="text-muted-foreground text-pretty">
          Extrae imágenes de PDF y las clasifica arancelariamente usando inteligencia artificial
        </p>
      </div>

      {isProcessing ? (
        <Card>
          <CardHeader>
            <CardTitle>Procesando Documento</CardTitle>
            <CardDescription>
              Extrayendo imágenes y clasificando con IA. Esto puede tomar varios minutos.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Progreso General</span>
                <span>{Math.round(progress)}%</span>
              </div>
              <Progress value={progress} className="h-2" />
            </div>

            <div className="space-y-4">
              {processingSteps.map((step, index) => {
                const Icon = step.icon
                const isCompleted = index < currentStep
                const isCurrent = index === currentStep
                const isPending = index > currentStep

                return (
                  <div key={step.id} className="flex items-center gap-3">
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center ${
                        isCompleted
                          ? "bg-green-100 text-green-600"
                          : isCurrent
                            ? "bg-accent text-accent-foreground"
                            : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {isCompleted ? (
                        <CheckCircle className="h-4 w-4" />
                      ) : isCurrent ? (
                        <Icon className="h-4 w-4 animate-pulse" />
                      ) : (
                        <Clock className="h-4 w-4" />
                      )}
                    </div>
                    <span className={`flex-1 ${isCurrent ? "font-medium" : ""}`}>{step.label}</span>
                    <Badge variant={isCompleted ? "default" : isCurrent ? "secondary" : "outline"}>
                      {isCompleted ? "Completado" : isCurrent ? "En Progreso" : "Pendiente"}
                    </Badge>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Subir Documento PDF</CardTitle>
            <CardDescription>Selecciona un PDF para extraer imágenes y clasificarlas arancelariamente</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Área de carga */}
              <div
                {...getRootProps()}
                className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
                  isDragActive ? "border-accent bg-accent/5" : "border-border hover:border-accent/50"
                }`}
              >
                <input {...getInputProps()} />
                <div className="space-y-4">
                  <div className="mx-auto w-12 h-12 bg-accent/10 rounded-full flex items-center justify-center">
                    {file ? <FileText className="h-6 w-6 text-accent" /> : <Upload className="h-6 w-6 text-accent" />}
                  </div>
                  {file ? (
                    <div>
                      <p className="font-medium">{file.name}</p>
                      <p className="text-sm text-muted-foreground">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                    </div>
                  ) : (
                    <div>
                      <p className="font-medium">{isDragActive ? "Suelta tu PDF aquí" : "Arrastra tu PDF aquí"}</p>
                      <p className="text-sm text-muted-foreground">o haz clic para buscar archivos</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Configuración */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="documentName">Nombre del Documento</Label>
                  <Input
                    id="documentName"
                    placeholder="Nombre para la hoja de Google Sheets"
                    value={documentName}
                    onChange={(e) => setDocumentName(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="folderUrl">URL de Carpeta Google Drive</Label>
                  <Input
                    id="folderUrl"
                    placeholder="https://drive.google.com/drive/folders/..."
                    value={folderUrl}
                    onChange={(e) => setFolderUrl(e.target.value)}
                    required
                  />
                </div>
              </div>

              {error && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <Button type="submit" className="w-full" disabled={!file || !documentName || !folderUrl || isProcessing}>
                {isProcessing ? "Procesando..." : "Generar Liquidación Completa"}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

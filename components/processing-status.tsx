"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"
import { CheckCircle, Clock, Upload, FileImage, Sheet } from "lucide-react"

interface ProcessingStatusProps {
  data: any
  onComplete: (results: any) => void
}

const processingSteps = [
  { id: "upload", label: "Uploading PDF", icon: Upload },
  { id: "extract", label: "Extracting Images", icon: FileImage },
  { id: "drive", label: "Uploading to Drive", icon: Upload },
  { id: "sheets", label: "Creating Google Sheet", icon: Sheet },
]

export function ProcessingStatus({ data, onComplete }: ProcessingStatusProps) {
  const [currentStep, setCurrentStep] = useState(0)
  const [progress, setProgress] = useState(0)
  const [extractedImages, setExtractedImages] = useState(0)

  useEffect(() => {
    const timer = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) {
          clearInterval(timer)
          // Simulate completion with mock results
          setTimeout(() => {
            onComplete({
              documentName: data.documentName,
              totalImages: 12,
              sheetUrl: "https://docs.google.com/spreadsheets/d/example",
              driveFolder: data.folderUrl,
              images: Array.from({ length: 12 }, (_, i) => ({
                id: i + 1,
                name: `image_${String(i + 1).padStart(3, "0")}.png`,
                url: `/placeholder.svg?height=200&width=200&query=extracted image ${i + 1}`,
                size: Math.floor(Math.random() * 500) + 100,
              })),
            })
          }, 1000)
          return 100
        }

        const newProgress = prev + Math.random() * 15
        const stepIndex = Math.floor(newProgress / 25)

        if (stepIndex !== currentStep && stepIndex < processingSteps.length) {
          setCurrentStep(stepIndex)
        }

        if (stepIndex === 1) {
          setExtractedImages(Math.floor(((newProgress - 25) / 25) * 12))
        }

        return Math.min(newProgress, 100)
      })
    }, 800)

    return () => clearInterval(timer)
  }, [currentStep, data, onComplete])

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="text-center space-y-2">
        <h1 className="text-3xl font-bold">Processing Document</h1>
        <p className="text-muted-foreground">Extracting images from "{data.documentName}"</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Processing Status</CardTitle>
          <CardDescription>
            Your PDF is being processed. This may take a few minutes depending on the file size.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>Overall Progress</span>
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
                    {isCompleted ? "Complete" : isCurrent ? "In Progress" : "Pending"}
                  </Badge>
                </div>
              )
            })}
          </div>

          {currentStep >= 1 && (
            <div className="bg-muted/50 rounded-lg p-4">
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium">Images Extracted</span>
                <Badge variant="outline">{extractedImages} images</Badge>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

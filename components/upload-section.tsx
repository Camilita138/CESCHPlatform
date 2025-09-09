"use client"

import type React from "react"

import { useState, useCallback } from "react"
import { useDropzone } from "react-dropzone"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Upload, FileText, AlertCircle } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"

interface UploadSectionProps {
  onUploadComplete: (data: any) => void
}

export function UploadSection({ onUploadComplete }: UploadSectionProps) {
  const [file, setFile] = useState<File | null>(null)
  const [documentName, setDocumentName] = useState("")
  const [folderUrl, setFolderUrl] = useState("")
  const [isUploading, setIsUploading] = useState(false)
  const [error, setError] = useState("")

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const pdfFile = acceptedFiles.find((file) => file.type === "application/pdf")
    if (pdfFile) {
      setFile(pdfFile)
      setError("")
    } else {
      setError("Please upload a PDF file only")
    }
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "application/pdf": [".pdf"],
    },
    multiple: false,
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!file || !documentName || !folderUrl) {
      setError("Please fill in all fields and select a PDF file")
      return
    }

    setIsUploading(true)
    setError("")

    try {
      // Simulate API call - replace with actual implementation
      await new Promise((resolve) => setTimeout(resolve, 2000))

      onUploadComplete({
        file,
        documentName,
        folderUrl,
        uploadTime: new Date().toISOString(),
      })
    } catch (err) {
      setError("Failed to upload file. Please try again.")
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="text-center space-y-2">
        <h1 className="text-3xl font-bold text-balance">PDF Image Extraction</h1>
        <p className="text-muted-foreground text-pretty">
          Upload your PDF to extract images and automatically organize them in Google Drive and Sheets
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Upload PDF Document</CardTitle>
          <CardDescription>Select a PDF file to extract images from and configure the output settings</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* File Upload Area */}
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
                    <p className="font-medium">{isDragActive ? "Drop your PDF here" : "Drag & drop your PDF here"}</p>
                    <p className="text-sm text-muted-foreground">or click to browse files</p>
                  </div>
                )}
              </div>
            </div>

            {/* Document Configuration */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="documentName">Document Name</Label>
                <Input
                  id="documentName"
                  placeholder="Enter document name for Google Sheets"
                  value={documentName}
                  onChange={(e) => setDocumentName(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="folderUrl">Google Drive Folder URL</Label>
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

            <Button type="submit" className="w-full" disabled={!file || !documentName || !folderUrl || isUploading}>
              {isUploading ? "Processing..." : "Start Processing"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ExternalLink, FileText, Calendar } from "lucide-react"

const mockHistory = [
  {
    id: 1,
    documentName: "Invoice_2024_Q1",
    processedAt: "2024-01-15T10:30:00Z",
    imageCount: 8,
    status: "completed",
    sheetUrl: "https://docs.google.com/spreadsheets/d/example1",
  },
  {
    id: 2,
    documentName: "Product_Catalog_2024",
    processedAt: "2024-01-14T15:45:00Z",
    imageCount: 24,
    status: "completed",
    sheetUrl: "https://docs.google.com/spreadsheets/d/example2",
  },
  {
    id: 3,
    documentName: "Technical_Manual_v2",
    processedAt: "2024-01-13T09:15:00Z",
    imageCount: 16,
    status: "completed",
    sheetUrl: "https://docs.google.com/spreadsheets/d/example3",
  },
]

export function HistoryPanel() {
  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Processing History</h1>
        <p className="text-muted-foreground">View all your previously processed documents and their results</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent Documents</CardTitle>
          <CardDescription>Your document processing history and generated Google Sheets</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {mockHistory.map((item) => (
              <div key={item.id} className="flex items-center justify-between p-4 border rounded-lg">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-accent/10 rounded-lg flex items-center justify-center">
                    <FileText className="h-5 w-5 text-accent" />
                  </div>
                  <div>
                    <h3 className="font-medium">{item.documentName}</h3>
                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {new Date(item.processedAt).toLocaleDateString()}
                      </div>
                      <span>{item.imageCount} images extracted</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{item.status}</Badge>
                  <Button size="sm" variant="outline" asChild>
                    <a href={item.sheetUrl} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

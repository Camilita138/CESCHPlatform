"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Separator } from "@/components/ui/separator"
import { Badge } from "@/components/ui/badge"
import { Settings, Key, Webhook } from "lucide-react"

export function SettingsPanel() {
  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Settings</h1>
        <p className="text-muted-foreground">Configure your PDF processing preferences and integrations</p>
      </div>

      {/* Google API Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="h-5 w-5" />
            Google API Configuration
          </CardTitle>
          <CardDescription>Manage your Google Drive and Sheets API credentials</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">Google API Status</p>
              <p className="text-sm text-muted-foreground">Connected and authenticated</p>
            </div>
            <Badge variant="secondary">Connected</Badge>
          </div>
          <Separator />
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="defaultFolder">Default Drive Folder ID</Label>
              <Input
                id="defaultFolder"
                placeholder="1qq-fmDrV_i2YqkfHwiQcYoxPSe4u4SrW"
                defaultValue="1qq-fmDrV_i2YqkfHwiQcYoxPSe4u4SrW"
              />
            </div>
            <Button variant="outline">Reconnect Google Account</Button>
          </div>
        </CardContent>
      </Card>

      {/* Processing Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Processing Preferences
          </CardTitle>
          <CardDescription>Customize how PDFs are processed and images are extracted</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">High Quality Extraction</p>
                <p className="text-sm text-muted-foreground">Use higher resolution for image extraction</p>
              </div>
              <Switch defaultChecked />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Auto-organize by Date</p>
                <p className="text-sm text-muted-foreground">Create date-based folders in Drive</p>
              </div>
              <Switch />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Generate Thumbnails</p>
                <p className="text-sm text-muted-foreground">Create thumbnail versions of extracted images</p>
              </div>
              <Switch defaultChecked />
            </div>
          </div>
          <Separator />
          <div className="space-y-2">
            <Label htmlFor="imageQuality">Image Quality (1-5)</Label>
            <Input id="imageQuality" type="number" min="1" max="5" defaultValue="3" className="w-24" />
          </div>
        </CardContent>
      </Card>

      {/* Webhook Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Webhook className="h-5 w-5" />
            Webhook Configuration
          </CardTitle>
          <CardDescription>Set up notifications for completed processing jobs</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">Enable Webhooks</p>
              <p className="text-sm text-muted-foreground">Send notifications when processing completes</p>
            </div>
            <Switch />
          </div>
          <div className="space-y-2">
            <Label htmlFor="webhookUrl">Webhook URL</Label>
            <Input id="webhookUrl" placeholder="https://your-app.com/webhook" disabled />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button>Save Settings</Button>
      </div>
    </div>
  )
}

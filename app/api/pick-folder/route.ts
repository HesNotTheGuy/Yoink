import { NextResponse } from "next/server";
import { spawn } from "child_process";

export async function GET() {
  // Open Windows FolderBrowserDialog via PowerShell
  const script = [
    "Add-Type -AssemblyName System.Windows.Forms",
    "$d = New-Object System.Windows.Forms.FolderBrowserDialog",
    "$d.ShowNewFolderButton = $true",
    "$d.Description = 'Select output folder'",
    "if ($d.ShowDialog() -eq 'OK') { Write-Output $d.SelectedPath }",
  ].join("; ");

  return new Promise<Response>((resolve) => {
    const ps = spawn("powershell", ["-NoProfile", "-Command", script], {
      windowsHide: true, // hide the console window, dialog still shows
    });

    let out = "";
    ps.stdout.on("data", (d: Buffer) => (out += d.toString()));
    ps.on("close", () => {
      const path = out.trim();
      resolve(NextResponse.json({ path: path || null }));
    });
    ps.on("error", () =>
      resolve(NextResponse.json({ error: "Failed to open folder picker" }, { status: 500 }))
    );
  });
}

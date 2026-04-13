Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "cmd.exe /c ""SET PATH=C:\Program Files\nodejs;%PATH% && cd /d """ & CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName) & """ && npm run dev""", 0, False

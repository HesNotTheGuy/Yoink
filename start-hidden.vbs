Set fso = CreateObject("Scripting.FileSystemObject")
Set wsh = CreateObject("WScript.Shell")
Dim dir : dir = fso.GetParentFolderName(WScript.ScriptFullName)
Dim port : port = wsh.Environment("Process")("PORT")
Dim cmd : cmd = "cmd.exe /c """ & "cd /d """ & dir & """ && "
If port <> "" Then
    cmd = cmd & "SET PORT=" & port & " && "
End If
cmd = cmd & "call start.cmd"""
wsh.Run cmd, 0, False

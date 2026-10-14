; Tauri NSIS hook: when the app is uninstalled, also remove its "launch at login" entry
; so Windows doesn't keep trying to start a program that no longer exists.
!macro NSIS_HOOK_PREUNINSTALL
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Windows Island"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "windows-island"
!macroend

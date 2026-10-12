@echo off
where ssh.exe >nul 2>&1
if errorlevel 1 (
    echo OpenSSH Client is required on this laptop.
    pause
    exit /b 1
)
echo AIRI host: 192.168.1.5
echo Use the existing SSH key registered on the host.
echo After authentication, open http://127.0.0.1:5173 in your browser.
echo Keep this window open. Press Ctrl+C to disconnect.
echo Local ports 5173 and 18765 must be available on this laptop.
ssh.exe -N -T -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -L 127.0.0.1:5173:127.0.0.1:5173 -L 127.0.0.1:18765:127.0.0.1:18765 administrator@192.168.1.5
pause

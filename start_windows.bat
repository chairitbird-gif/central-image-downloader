@echo off
chcp 65001 >nul
echo Central Image Downloader - Web
echo.

:: ตรวจ Python
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] ไม่พบ Python  ดาวน์โหลดที่ https://www.python.org/downloads/
    pause
    exit /b 1
)

:: ติดตั้ง dependencies ถ้ายังไม่มี
python -c "import flask, requests, PIL" >nul 2>&1
if errorlevel 1 (
    echo กำลังติดตั้ง dependencies...
    pip install flask requests Pillow --quiet
)

echo เปิดเว็บที่ http://localhost:5000
start http://localhost:5000
python app.py
pause

#!/bin/bash
# ดับเบิ้ลคลิกไฟล์นี้บน Mac เพื่อเปิดเว็บได้เลย
# ครั้งแรก: chmod +x start_mac.command

cd "$(dirname "$0")"

# ตรวจ Python
if ! command -v python3 &>/dev/null; then
    osascript -e 'display alert "ไม่พบ Python3" message "ดาวน์โหลดที่ https://www.python.org/downloads/" as critical'
    exit 1
fi

# ติดตั้ง dependencies ถ้ายังไม่มี
python3 -c "import flask, requests, PIL" 2>/dev/null || {
    echo "กำลังติดตั้ง dependencies..."
    python3 -m pip install flask requests Pillow --quiet
}

echo "เปิดเว็บที่ http://localhost:5000"
open http://localhost:5000
python3 app.py

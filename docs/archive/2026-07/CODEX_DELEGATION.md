# วิธีให้ Claude (Fable) delegate งานให้ Codex ได้จริง

## ปัญหาที่เจอ
Claude Code รันในโหมด auto มี classifier ความปลอดภัยชื่อ **[Create Unsafe Agents]**
ที่บล็อกคำสั่ง `codex exec --full-auto` (agent loop ปิด per-action approval)
ถ้าคำสั่งจากผู้ใช้ "กว้างไป" (เช่นแค่ "ให้ codex ทำ") — คำยืนยันในแชทเฉยๆ ไม่ปลดล็อก

## ทางเลือก (เลือกอย่างใดอย่างหนึ่ง)

### ทาง A — เพิ่ม Bash permission rule (ปลดล็อกถาวร ให้ Claude รัน codex เองได้)
แก้ไฟล์ `D:\Bird\Claude Code\.claude\settings.json` เพิ่ม:
```json
{
  "permissions": {
    "allow": [
      "Bash(codex exec:*)"
    ]
  }
}
```
(ถ้ามี key `permissions.allow` อยู่แล้ว ให้เติม `"Bash(codex exec:*)"` เข้าไปใน array)
หลังจากนี้บอก Claude ว่า **"รัน codex แบบ full-auto"** ได้เลย จะไม่โดนบล็อก

### ทาง B — รัน Codex เองในเทอร์มินัล (ไม่ผ่าน Claude เลย ไม่มี classifier)
1. เปิด PowerShell ที่โฟลเดอร์ `D:\Bird\Claude Code`
2. วางไฟล์งาน (task spec) ไว้ เช่น `codex_task.txt`
3. รัน:
```powershell
Get-Content -Raw -Encoding utf8 codex_task.txt | codex exec --skip-git-repo-check --full-auto -
```
Codex จะแก้ไฟล์เอง ตามที่เขียนใน task

### ทาง C — data-file handoff (ให้ Codex ไปอ่านไฟล์เอง)
เขียน task ลงไฟล์ แล้วสั่ง Codex สั้นๆ:
```powershell
codex exec --skip-git-repo-check --full-auto "อ่าน D:\Bird\Claude Code\centralimage_web\<task-file>.md แล้วทำตามทุกข้อ"
```
เหมาะเมื่ออยากให้ Claude เตรียม task ละเอียดไว้ในไฟล์ แล้วคุณเอาไปป้อน Codex เอง

## หมายเหตุ
- Codex ใช้โควตาแยกจาก Claude (Fable) → delegate งานเขียนโค้ดยาวๆ ให้ Codex ประหยัด token ฝั่ง Fable
- Fable ยังเป็นคนคุมงาน/รีวิว/ตัดสินใจ — Codex ทำ execution
- ถ้างานเล็ก/ไม่คุ้ม Fable ทำเองเร็วกว่า

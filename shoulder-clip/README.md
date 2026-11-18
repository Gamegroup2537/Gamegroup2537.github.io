# shoulder-clip

คลิปอธิบายความรู้แนวตั้ง 32 วินาที "อยากไหล่กลม ทรงสวย ต้องฝึกท่าไหน?" สไตล์พิกเซลอาร์ต 3D
ภาพ ข้อความ และเสียงทั้งหมดสร้างจากโค้ด ไม่มีไฟล์วิดีโอหรือเสียงจากภายนอก

ผลลัพธ์: `out/shoulder-clip.mp4` (1080×1920, 30 fps, H.264 + AAC, วนลูปได้)

## สร้างคลิปใหม่

ต้องมี Node.js, ffmpeg และ Playwright พร้อม Chromium

```bash
npm install
npm run build            # เรนเดอร์ 960 เฟรม + เสียง แล้วรวมเป็น out/shoulder-clip.mp4
npm run preview -- 0 180 369   # ดูเฟรมที่ต้องการเป็น PNG ใน build/preview/
```

เปิด `index.html?play` ผ่านเว็บเซิร์ฟเวอร์ใดก็ได้เพื่อดูแอนิเมชันสดในเบราว์เซอร์

## โครงสร้าง

| ไฟล์ | หน้าที่ |
|---|---|
| `src/timeline.js` | แหล่งความจริงเดียว: ท่าทาง การทำงานของกล้ามเนื้อ กล้อง คำบรรยาย ป้ายชี้ |
| `src/scene.js` | หุ่น 3D โครงกระดูก และเดลทอยด์ 3 มัด (Three.js เรนเดอร์ที่ 270×480) |
| `src/hud.js` | แผงข้อความภาษาไทยแบบพิกเซล แถบกล้ามเนื้อ มาตรวัดมุมแขน |
| `src/main.js` | รวมเลเยอร์ + ordered dithering |
| `tools/render.mjs` | เรนเดอร์ทีละเฟรมแบบ deterministic ด้วย Playwright |
| `tools/audio.mjs` | สังเคราะห์เพลง chiptune และเสียงเอฟเฟกต์เป็น WAV |
| `tools/build.sh` | รวมเฟรมกับเสียงเป็น MP4 ด้วย ffmpeg |

## ปรับแต่ง

- ข้อความบนจอ: `CAPTIONS` และ `LABELS` ใน `src/timeline.js`
- ลายน้ำชื่อช่อง: ตั้งค่า `WATERMARK` ใน `src/timeline.js`
- สีของแต่ละมัดกล้ามเนื้อ: `HEADS` ใน `src/timeline.js`

ฟอนต์ Chakra Petch (SIL Open Font License) ติดตั้งผ่าน `@fontsource/chakra-petch`

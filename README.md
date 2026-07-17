# AI Kids Animation Studio

Ứng dụng hỗ trợ trích xuất, lập kế hoạch phân cảnh (shot list), tạo prompt vẽ hình (keyframes) và sinh prompt chuyển động (motion prompts) từ kịch bản truyện cho trẻ em bằng AI (Gemini và Veo).

## Cấu Trúc Dự Án

Dự án gồm 2 phần chính:
1. **Backend (Python / FastAPI)**:
   - Cổng mặc định: `http://127.0.0.1:8000`
   - Nhiệm vụ: Xử lý phân tích kịch bản bằng mô hình Gemini qua API chính thức (hỗ trợ phân phối rate-limit và xoay vòng API key).
2. **Frontend (Next.js / React / TypeScript)**:
   - Cổng mặc định: `http://localhost:3001`
   - Nhiệm vụ: Giao diện tương tác, trực quan hóa tiến trình pipeline, chỉnh sửa JSON kết quả trực tiếp, và điều phối các API sinh ảnh/video.

---

## Yêu Cầu Hệ Thống

Để chạy ứng dụng, máy tính của bạn cần cài đặt sẵn:
- **Node.js** (Phiên bản 18 trở lên)
- **Python** (Phiên bản 3.10 trở lên, đã cấu hình biến môi trường `PATH`)

---

## Cách Chạy Nhanh (Khuyên dùng cho Windows)

Ở thư mục gốc của dự án, nhấp đúp chuột vào file:
`run_app.bat`

File script này sẽ tự động:
1. Kiểm tra môi trường Node.js và Python.
2. Cài đặt các thư viện Python cần thiết (`fastapi`, `uvicorn`, `pydantic`, `httpx`, `python-multipart`).
3. Cài đặt các package Node.js (`npm install`).
4. Khởi chạy song song cả FastAPI Backend và Next.js Frontend trong hai cửa sổ terminal riêng biệt.

---

## Cách Chạy Thủ Công

Nếu không dùng file `.bat` hoặc chạy trên hệ điều hành khác (macOS/Linux), bạn có thể chạy bằng các lệnh sau:

### 1. Chạy Backend
Mở một terminal mới và gõ:
```bash
cd backend
pip install -r requirements.txt
python -m uvicorn main:app --reload --port 8000
```
API Backend sẽ chạy tại: `http://127.0.0.1:8000` (Tài liệu API Swagger có sẵn tại `http://127.0.0.1:8000/docs`).

### 2. Chạy Frontend
Mở một terminal khác và gõ:
```bash
cd frontend
npm install
npm run dev
```
Truy cập giao diện Web tại: `http://localhost:3001`.

---

## Lưu Ý Về Các Cổng Dịch Vụ và API

1. **Khóa API Gemini**:
   - Ứng dụng **không yêu cầu** bạn cài đặt file `.env` ở Backend.
   - Bạn có thể nhập trực tiếp một hoặc nhiều Gemini API key từ giao diện Frontend (cấu hình trong thẻ **Cấu hình Gemini AI**). Hệ thống sẽ tự động gửi key kèm theo request để gọi API.

2. **Dịch Vụ Tạo Ảnh & Video (Cổng 5000)**:
   - Frontend được lập trình để kết nối với dịch vụ sinh ảnh/video cục bộ chạy tại cổng `http://127.0.0.1:5000` (`/api/generate` và `/api/generate_video`).
   - **Cơ chế Fallback (Ngoại tuyến)**: Nếu dịch vụ tại cổng 5000 chưa chạy hoặc gặp lỗi, hệ thống sẽ **tự động kích hoạt cơ chế giả lập (mock)**. Bạn vẫn có thể trải nghiệm toàn bộ luồng tạo dự án, lưu trữ IndexedDB và xuất file ZIP bình thường mà không lo ứng dụng bị treo.

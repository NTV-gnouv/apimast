# Masothue API Proxy

API wrapper cho masothue.com, dùng HTML public của họ để tra cứu và trả JSON gọn.

Ứng dụng này chạy bằng Node.js thuần, nhưng phần tra cứu masothue.com có thể cần Chrome/Chromium trên server nếu HTML của họ chặn request thường.

Trang test giao diện nằm ở `/`, còn tài liệu API riêng nằm ở `/api-guide`.

## Cài đặt

```bash
npm install
```

## Chạy

```bash
npm start
```

Mặc định bind trên `0.0.0.0` và truy cập qua `http://localhost:3000` trên máy cục bộ, hoặc qua IP/domain của máy chủ khi deploy.

### Chạy với biến môi trường

Bạn có thể dùng file `.env` (tham khảo `.env.example`) hoặc export biến môi trường trước khi chạy. Ví dụ:

```bash
# bind trên mọi interface và port 3000
HOST=0.0.0.0 PORT=3000 npm start

# hoặc khi deploy trên shared host cho domain masothue.tuanseo.com
HOST=0.0.0.0 PORT=3000 ALLOWED_ORIGIN=https://masothue.tuanseo.com npm start
```

Khi upload vào thư mục gốc của domain `masothue.tuanseo.com`, app sẽ tự phục vụ giao diện từ `/` và API từ `/api/*`.

Bạn có thể mở trang hướng dẫn API tại:

```text
/api-guide
```

Nếu host của bạn có mục web application riêng, chỉ cần trỏ startup command tới `npm start` và đảm bảo Node 18+.

## Ubuntu VPS setup

Trên Ubuntu, cách nhanh nhất là chạy script setup kèm theo repo. Script này sẽ:

- cài Node.js 18 LTS nếu máy chưa có hoặc đang dùng bản quá cũ
- cài Chromium nếu distro hỗ trợ gói đó
- chạy `npm install`

Chạy bằng quyền `sudo`:

```bash
sudo bash scripts/setup-ubuntu.sh
```

Sau khi cài xong, khởi động app:

```bash
npm start
```

Nếu bạn muốn chạy ở port khác, set `PORT` trước khi start:

```bash
PORT=80 npm start
```

Nếu VPS không có `google-chrome` tại `/usr/bin/google-chrome`, hãy cài `chromium` hoặc trỏ một trong các biến sau tới binary trình duyệt:

- `CHROME_PATH`
- `CHROMIUM_PATH`
- `PUPPETEER_EXECUTABLE_PATH`
- `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`

Ví dụ:

```bash
CHROME_PATH=/usr/bin/chromium npm start
```

### Windows Server 2016 VPS

Nếu VPS chạy Windows Server 2016, cài Chrome hoặc Chromium bản desktop rồi trỏ `CHROME_PATH` tới file `.exe` tương ứng. Các đường dẫn thường gặp là:

- `C:\Program Files\Google\Chrome\Application\chrome.exe`
- `C:\Program Files (x86)\Google\Chrome\Application\chrome.exe`
- `C:\Program Files\Chromium\Application\chrome.exe`
- `C:\Program Files\Microsoft\Edge\Application\msedge.exe`

Ví dụ chạy trên Windows PowerShell:

```powershell
$env:CHROME_PATH = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
npm start
```

Lưu ý: Docker trên Windows Server 2016 thường dùng Windows containers, nên Chromium headless không phải lựa chọn ổn định nhất ở đây. Nếu bạn cần container hóa, cách dễ chịu hơn là chạy app trong Linux container hoặc Linux VPS. Trên Windows Server 2016, phương án thực tế nhất là cài browser trực tiếp trên máy chủ và chạy Node app bình thường.

## Endpoint

### `GET /api`

Trả về JSON tổng quan về API, danh sách endpoint và đường dẫn tài liệu.

```bash
curl 'http://localhost:3000/api'
```

### `GET /api/lookup`

Tham số:

- `q` hoặc `query`: chuỗi cần tra cứu
- `type`: một trong các giá trị lấy từ form của masothue.com
  - `auto`
  - `enterpriseTax`
  - `personalTax`
  - `identity`
  - `enterpriseName`
  - `legalName`

Ví dụ:

```bash
curl 'http://localhost:3000/api/lookup?q=1102168726&type=auto'
```

### `GET /api/company/:taxCode`

Tra cứu nhanh theo mã số thuế.

```bash
curl 'http://localhost:3000/api/company/1102168726'
```

### `GET /api/debug-lookup`

Trả về thông tin debug chi tiết khi cần chẩn đoán lỗi trên VPS.

```bash
curl 'http://localhost:3000/api/debug-lookup?q=1102168726&type=enterpriseTax'
```

## Trường trả về

Chỉ trả các trường bạn cần:

- `ten`
- `ma_so_thue`
- `nguoi_dai_dien`
- `tinh_trang`
- `quan_ly_boi`
- `dia_chi`

## Ghi chú

- Masothue.com hiện là HTML-rendered site, không phải JSON API công khai ổn định.
- Khi deploy trên VPS, nếu chưa cài browser thì endpoint tra cứu sẽ trả lỗi rõ ràng thay vì crash với đường dẫn mặc định.
- Nếu không tìm thấy kết quả, API trả HTTP 404 với `code: NOT_FOUND` và `reason` rõ ràng.
- Nếu tìm thấy kết quả đủ mạnh, API trả HTTP 200 với `code: OK`.
- Logic ở đây ưu tiên chọn kết quả khớp nhất từ trang search, rồi mới đọc trang chi tiết.
- Nếu họ đổi HTML hoặc chặn request tự động, parser cần cập nhật lại.
- Request tra cứu có timeout mặc định 15 giây. Bạn có thể đổi bằng `REQUEST_TIMEOUT_MS`.
# Masothue API Proxy

API wrapper cho masothue.com, dùng HTML public của họ để tra cứu và trả JSON gọn.

Ứng dụng này chạy bằng Node.js thuần, không cần Puppeteer, Playwright, Chrome, hay Chromium trên server.

## Cài đặt

```bash
npm install
```

## Chạy

```bash
npm start
```

Mặc định chạy ở `http://localhost:3000`.

### Chạy với biến môi trường

Bạn có thể dùng file `.env` (tham khảo `.env.example`) hoặc export biến môi trường trước khi chạy. Ví dụ:

```bash
# bind trên mọi interface và port 3000
HOST=0.0.0.0 PORT=3000 npm start

# hoặc khi deploy trên shared host cho domain masothue.tuanseo.com
HOST=0.0.0.0 PORT=3000 ALLOWED_ORIGIN=https://masothue.tuanseo.com npm start
```

Khi upload vào thư mục gốc của domain `masothue.tuanseo.com`, app sẽ tự phục vụ giao diện từ `/` và API từ `/api/*`.

Nếu host của bạn có mục web application riêng, chỉ cần trỏ startup command tới `npm start` và đảm bảo Node 18+.

## Endpoint

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
- Logic ở đây ưu tiên chọn kết quả khớp nhất từ trang search, rồi mới đọc trang chi tiết.
- Nếu họ đổi HTML hoặc chặn request tự động, parser cần cập nhật lại.
- Request tra cứu có timeout mặc định 15 giây. Bạn có thể đổi bằng `REQUEST_TIMEOUT_MS`.
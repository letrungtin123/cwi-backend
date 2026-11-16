# RabbitMQ

Hàng đợi cho worker gửi email báo cáo. Chạy riêng bằng Docker Compose, chỉ nghe trên 127.0.0.1.

```bash
cp .env.example .env          # đặt RABBITMQ_DEFAULT_PASS ngẫu nhiên
docker compose --env-file .env -p cwi-rabbitmq-production up -d
```

Giao diện quản trị (cổng 15672) chỉ mở qua SSH tunnel. Không dùng `down --volumes` khi vận hành bình thường.

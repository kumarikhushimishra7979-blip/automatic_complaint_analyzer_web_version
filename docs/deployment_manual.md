# Deployment Manual — Automatic Customer Complaint Analysis System

This guide is intended for system administrators deploying the application on an organizational Linux server.

## 1. Server Prerequisites
- Ubuntu 22.04 LTS / 24.04 LTS (or equivalent Linux distribution)
- Non-root sudo-enabled administration user
- Minimum 2 vCPU, 4 GB RAM, 20 GB disk space

## 2. Required Software
- Node.js v22 LTS and npm
- Nginx (reverse proxy and TLS termination)
- Certbot (for Let's Encrypt HTTPS certificates, if public/internal CA not used)

## 3. Node.js Installation
```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v
```

## 4. Application Directory & Source Placement
```bash
sudo mkdir -p /opt/complaint-analysis
sudo chown $USER:$USER /opt/complaint-analysis
# Extract the clean source archive into /opt/complaint-analysis
cd /opt/complaint-analysis
npm ci
```

## 5. Environment-Variable Configuration
Create `/opt/complaint-analysis/.env` from `.env.example` (never commit `.env` to version control):
```env
NODE_ENV=production
PORT=3000
JWT_SECRET="REPLACE_WITH_64_CHAR_RANDOM_HEX_SECRET"
ACCESS_TOKEN_EXPIRE_MINUTES=480
DATABASE_PATH="/var/lib/complaint-analysis/complaints.db"
UPLOAD_DIR="/var/lib/complaint-analysis/uploads"
MAX_UPLOAD_SIZE_MB=25
MODEL_PATH="/opt/complaint-analysis/server/ml/models/trained_model.json"
CONFIDENCE_THRESHOLD=0.40
MIN_CLUSTER_SIZE=2
CORS_ORIGINS="https://complaints.your-organization.org"
VITE_API_BASE_URL="/api"
```
Generate a secure `JWT_SECRET` using:
```bash
openssl rand -hex 32
```

## 6. ML Model Artifact Placement
Ensure the trained model artifact is placed at `MODEL_PATH` (`/opt/complaint-analysis/server/ml/models/trained_model.json`). If regenerating from the baseline training script:
```bash
npx tsx server/ml/train_initial_model.ts
```

## 7. Frontend Production Build
Build the static Vite React bundle into `dist/`:
```bash
npm run build
```

## 8. File Storage & Database Permissions
Create dedicated persistent storage directories outside the repository directory:
```bash
sudo mkdir -p /var/lib/complaint-analysis/uploads
sudo chown -R www-data:www-data /var/lib/complaint-analysis
sudo chmod 750 /var/lib/complaint-analysis /var/lib/complaint-analysis/uploads
```
Database tables and migrations run automatically on server startup via `schema_migrations`.

## 9. Systemd Service Configuration
Create `/etc/systemd/system/complaint-analysis.service`:
```ini
[Unit]
Description=Automatic Customer Complaint Analysis System
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/complaint-analysis
EnvironmentFile=/opt/complaint-analysis/.env
ExecStart=/usr/bin/npx tsx server.ts
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```
Enable and start the service:
```bash
sudo systemctl daemon-reload
sudo systemctl enable complaint-analysis
sudo systemctl start complaint-analysis
sudo systemctl status complaint-analysis
```

## 10. Nginx Configuration
Create `/etc/nginx/sites-available/complaint-analysis`:
```nginx
server {
    listen 80;
    server_name complaints.your-organization.org;
    client_max_body_size 30M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```
Enable site and test Nginx:
```bash
sudo ln -s /etc/nginx/sites-available/complaint-analysis /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

## 11. HTTPS Configuration
```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d complaints.your-organization.org
```

## 12. Firewall Configuration
```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

## 13. Backup & Recovery
Back up `/var/lib/complaint-analysis/complaints.db` (using `sqlite3 ... ".backup ..."`) and `/var/lib/complaint-analysis/uploads` daily to encrypted organizational backup storage.

## 14. Application Logging & Troubleshooting
Inspect service logs safely (complaint contents are never logged):
```bash
sudo journalctl -u complaint-analysis -n 100 --no-pager
```
Verify API health locally:
```bash
curl -f http://127.0.0.1:3000/api/health
```

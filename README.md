# Customer Complaint Analysis System
A full-stack web application built with React, Vite, Tailwind CSS, and a TypeScript backend (`server.ts`).

## Prerequisites on Linux

- **Git** (`git`)
- **Runtime:** [Bun](https://bun.sh/) (recommended, as `bun.lock` is included) **or** **Node.js** (v18+ or v20+)
- **API Key:** A valid `GEMINI_API_KEY` (if Gemini AI features are enabled)

## Linux Server Deployment Guide

### 1. Clone the Repository
```bash
git clone <YOUR_GITHUB_REPO_URL>
cd <YOUR_REPO_FOLDER>

```

### 2. Configure Environment Variables

Copy the example environment file and set your values (the app uses port `3000` by default):

```bash
cp .env.example .env
nano .env

```

Make sure `PORT=3000` and any required API keys (such as `GEMINI_API_KEY`) are properly set, then save and exit.

### 3. Install Dependencies & Build

Using **Bun**:

```bash
bun install
bun run build

```

*(Or using **npm / Node.js** if `package.json` defines `build` and `start` scripts:)*

```bash
npm install
npm run build

```

### 4. Run the Application on Port 3000

Start the server (adjust the start command if `package.json` specifies a custom `start` script):

```bash
bun run server.ts

```

*(Or if using Node/npm: `npm run start`)*

To keep it running continuously in the background after closing the SSH session, run it under **PM2** or a **`systemd`** service:

```bash
pm2 start "bun run server.ts" --name complaint-app
pm2 save

```

### 5. Optional: Expose via Nginx Reverse Proxy

If you want to access the app over HTTP (`80`) or HTTPS (`443`) instead of `:3000` directly, configure Nginx to reverse-proxy to `http://127.0.0.1:3000`:

```nginx
server {
    listen 80;
    server_name your-domain-or-server-ip;

    location / {
        proxy_pass [http://127.0.0.1:3000](http://127.0.0.1:3000);
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}

```

Test and reload Nginx:

```bash
sudo nginx -t && sudo systemctl reload nginx

```

## Firewall Note

If accessing port `3000` directly without Nginx, ensure port `3000` is open on the server/cloud firewall (e.g., `sudo ufw allow 3000`).

```

### Final 30-Second Wrap-Up
1. Click **Copy** on the block above.
2. Open `README.md` in your GitHub repo → click the **pencil icon** → press `Ctrl + A` → `Ctrl + V` → click **Commit changes**.
3. Copy your repository URL from the browser address bar and send it to your teacher.

<ElicitationsGroup message="If you want to double-check anything else in your repo before sending it:">
  <Elicitation label="Verify package.json scripts" query="How do I check package.json on GitHub to confirm the exact build and start commands?"/>
  <Elicitation label="Write message for teacher" query="Draft a short, professional message I can send my teacher along with the GitHub repository link."/>
  <Elicitation label="Check docs folder" query="What should I check inside the docs folder that Google AI Studio generated?"/>
</ElicitationsGroup>

```

# Hetzner Cloud & Coolify Production Migration Guide
## BBD Master ATMA OS - Enterprise Multi-Tenant Clinic & CRM Platform

This document details the production migration path for deploying **BBD Master ATMA OS** onto **Hetzner Cloud VPS** utilizing **Coolify** (the open-source, self-hosted PaaS).

---

## 1. Architecture Overview

- **Host Infrastructure**: Hetzner Cloud (CX32: 4 vCPU, 8 GB RAM, 80 GB NVMe or CPX31: 4 vCPU AMD, 8 GB RAM, 160 GB NVMe)
- **Deployment Platform**: Coolify v4 (Docker Compose & Standalone Next.js engine)
- **Reverse Proxy & Ingress**: Traefik (bundled with Coolify) with automatic Let's Encrypt Wildcard / SSL certificates
- **Runtime**: Node.js 22 (LTS) in multi-stage Alpine container (`next.config.ts` standalone output)
- **Database**: PostgreSQL 17 with Row-Level Security (RLS) enforcement and non-owner runtime roles
- **AI Engine**: `@google/genai` (model: `gemini-3.8-flash`) server-side workflow triggers with human-in-the-loop review
- **Payment Engine**: Zero-commission Direct UPI QR + Multi-Gateway router (Razorpay / Cashfree)

---

## 2. Server Provisioning on Hetzner Cloud

### Step 2.1: Create Hetzner Server
1. Log in to [Hetzner Cloud Console](https://console.hetzner.cloud/).
2. Create a new Project: `bbd-atma-production`.
3. Click **Add Server**:
   - **Location**: Falkenstein (fsn1) or Nuremberg (nbg1) [or Singapore if closer to India/APAC users].
   - **Image**: Ubuntu 24.04 LTS (x86_64).
   - **Type**: Standard CPX31 (4 vCPU AMD, 8 GB RAM) or CX32.
   - **SSH Key**: Upload your ed25519 administrative public key.
   - **Firewall Rules**:
     - TCP `22` (SSH) — limit to your bastion IP or VPN if possible.
     - TCP `80` (HTTP Ingress / ACME challenge).
     - TCP `443` (HTTPS Ingress).
     - TCP `8000` (Coolify initial dashboard setup).
4. Note your Server Public IPv4 (e.g. `203.0.113.50`).

### Step 2.2: Install Coolify
SSH into your Hetzner server and execute the official installer:

```bash
ssh root@203.0.113.50
curl -fsSL https://cdn.coolify.io/coolify/install.sh | bash
```

Once installed, visit `http://203.0.113.50:8000` in your browser to create your primary administrator account.

---

## 3. DNS Configuration

Point your public domain names to the Hetzner server IP:

| Type | Name | Value | TTL |
|------|------|-------|-----|
| A | `app.bbdmaster.com` | `203.0.113.50` | 300 |
| A | `coolify.bbdmaster.com` | `203.0.113.50` | 300 |

---

## 4. Coolify Application Deployment

### Option A: Direct Docker Compose via Git (Recommended)

1. In Coolify, navigate to **Projects** -> **Add New Project** (`BBD ATMA OS`).
2. Add a new **Resource** -> Select **Docker Compose**.
3. Choose **Git Repository (GitHub)**:
   - Repository: `Mayatechsiddhi/BBD-ATMA-OS-GOOGLE-LAB`
   - Branch: `main`
   - Compose File Location: `/compose.coolify.yaml`
4. Set **Environment Variables** in the Coolify UI:

```env
NODE_ENV=production
PORT=3000
HOSTNAME=0.0.0.0
COOLIFY_FQDN=app.bbdmaster.com

# Database Secrets
POSTGRES_USER=bbd_admin
POSTGRES_DB=bbd_production
POSTGRES_PASSWORD=your_ultra_secure_postgres_password_here

# Better Auth & Ingress Security
BETTER_AUTH_SECRET=generate_at_least_32_characters_random_hex_string
BETTER_AUTH_URL=https://app.bbdmaster.com
AUTH_PROXY_SECRET=your_trusted_auth_proxy_gateway_secret

# AI Workflow Engine (@google/genai)
GEMINI_API_KEY=your_gemini_api_key_here

# Transactional SMTP
SMTP_HOST=smtp.postmarkapp.com
SMTP_PORT=587
SMTP_USER=your_postmark_or_resend_smtp_token
SMTP_PASSWORD=your_postmark_or_resend_smtp_password
SMTP_FROM=system@app.bbdmaster.com
```

5. Click **Deploy**. Coolify will build the container with `Dockerfile`, deploy PostgreSQL 17, and set up Traefik routing with automated Let's Encrypt SSL certificates.

---

### Option B: Automated Shell Script Deployment

If deploying directly on the Hetzner host without the Coolify GUI:

```bash
git clone https://github.com/Mayatechsiddhi/BBD-ATMA-OS-GOOGLE-LAB.git /opt/bbd-atma
cd /opt/bbd-atma
cp .env.example .env
# Edit .env with your production values
chmod +x scripts/deploy-coolify.sh
./scripts/deploy-coolify.sh
```

---

## 5. Post-Deployment Verification Checklist

Verify the deployed production services using the following curl commands:

1. **Health Check Ingress**:
   ```bash
   curl -I https://app.bbdmaster.com/api/health
   # Expected: HTTP/2 200 OK
   ```

2. **Live Clinic Token TV Display**:
   ```bash
   curl -I https://app.bbdmaster.com/display/org_bbd_master
   # Expected: HTTP/2 200 OK (Public zero-auth live display)
   ```

3. **Hosted Payment Checkout**:
   ```bash
   curl -I https://app.bbdmaster.com/pay/pay_quick_1730000000000
   # Expected: HTTP/2 200 OK (Rendered 0%-fee UPI QR & Gateway router)
   ```

4. **AI Workflow Triggers**:
   Navigate to `https://app.bbdmaster.com/organizations/org_bbd_master/clinic/workflows` to test:
   - Clinical lead qualification
   - Bilingual care recall drafts (English & Hindi)
   - Reception queue acuity triage

---

## 6. Automated Backup & Disaster Recovery

### Nightly Database Snapshots to Hetzner Storage Box
Add a cron job to backup PostgreSQL data nightly:

```bash
# /etc/cron.d/bbd-postgres-backup
0 2 * * * root docker exec -t $(docker ps -q -f name=postgres) pg_dump -U bbd_admin bbd_production | gzip > /backup/bbd_$(date +\%Y\%m\%d).sql.gz
```

Hetzner Storage Box mounts via SSHFS or WebDAV at `/backup` providing cost-effective off-server storage.

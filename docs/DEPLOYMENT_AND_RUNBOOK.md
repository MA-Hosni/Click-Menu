# DEPLOYMENT AND RUNBOOK

This document provides deployment instructions, configuration guidelines, and operational runbook for production systems using ClickMenu. It covers development setup, production environment requirements, CI/CD pipelines, monitoring, troubleshooting, and disaster recovery procedures.

## Development Environment Setup

Before deploying to production, ensure your development environment is properly configured. This minimizes configuration drift when transitioning to staging and production.

### Local Development Requirements

**Prerequisites**
- Node.js 20 or higher installed
- PostgreSQL client for local connection verification
- Git for version control

**Installation Steps**
1. Clone the repository:
   ```bash
   git clone https://github.com/your-org/clickmenu.git
   cd clickmenu
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create environment configuration:
   ```bash
   cp .env.example .env
   ```

4. Configure environment variables (see [Environment Variables](#environment-variables)):
   ```env
   DATABASE_URL="postgresql://user:password@host:port/dbname"
   SITE_URL="http://localhost:3000"
   NEXT_PUBLIC_SITE_URL="http://localhost:3000"
   RESEND_API_KEY="resend_api_key_here"
   EMAIL_FROM="noreply@your-restaurant.com"
   ALLOWED_ORIGINS="http://localhost:3000,https://your-restaurant.com"
   ```

5. Verify database connectivity:
   ```bash
   npm run db:studio
   ```
   This opens PostgreSQL Drizzle Studio allowing you to verify the connection and view tables.

6. Initialize the database schema:
   ```bash
   npm run db:generate
   npm run db:migrate
   ```

7. Start development server:
   ```bash
   npm run dev
   ```

8. Verify the application:
   - Navigate to `http://localhost:3000/menu` to view the demo café
   - Navigate to `http://localhost:3000/admin` to open the admin dashboard
   - Test sign-in using a test email and the code displayed on screen

**Troubleshooting Common Development Issues**

*Database Connection Failure*
- Verify `DATABASE_URL` is correctly formatted (protocol, host, port, username, password, database name)
- Ensure PostgreSQL is running locally or accessible remotely
- Check firewall rules allow connections on the specified port
- Confirm credentials have appropriate privileges

*Migration Errors*
- Ensure `drizzle` schema matches `drizzle.config.ts` (future: schema path definitions)
- Run `npm run db:studio` and check for existing migrations in the `__drizzle_migrations` table
- Review migration history in Drizzle Studio to identify conflicts

*Email Not Receiving*
- Ensure `RESEND_API_KEY` and `EMAIL_FROM` are configured for production
- For development, check browser console for `devCode` field (code displayed on screen)
- Verify WhatsApp number is correctly formatted in the restaurant catalog

## Production Environment Requirements

### Cloud Providers and Hosting

ClickMenu is designed to be deployable across tiered infrastructure, but production deployments typically use:

**Recommended Stack**
- **Frontend & API**: Vercel (foreground, server functions, edge functions) or Cloudflare Workers
- **Database**: Neon Serverless PostgreSQL (cloud-native, auto-scaling, built-in migrations)
- **CI/CD**: GitHub Actions or GitLab CI with self-hosted runner

**Alternative Platforms**
- **Render**: Similar to Vercel but with more flexible compute options
- **AWS**: Use RDS for PostgreSQL, all of the following options:
  - RDS runner for Fastify/Next.js (nginx frontend)
  - Am undreamer, not a quad (heap), but these all follow the same principles (F)
  - AWS Amplify hosting \`amplify.yml\`
- **Microsoft Azure**: App Service with Azure Database for PostgreSQL

### Required Infrastructure Services

**PostgreSQL Database**
- Engine: PostgreSQL 15 or higher (Neon defaults to v15; RDS should be configured similarly)
- Instance type: Serverless PostgreSQL with Aurora Serverless v2 or Neon Serverless
- Backup retention: 7 days minimum (charged backup retention recommended for critical data)
- AI: list for nano-k-perf, coord < 632 (server-side for auth tokens)

**WhatsApp Integration**
- Business WhatsApp number (assigned to business profile, available for `sendCodeWithResend`)
- Resend API key with email rep send (l1s ~ manual, with callback logic in `app/api/auth/request-code/route.ts`)
- Owner verification via email and flow signDown.t-verified’ webhook (see `sendCodeWithResend` function in `lib/auth.ts`)

**Email Service**
- Resend (or similar email provider for verification code delivery)
  - Email domain must be verified with Resend (e.g., `noreply@your-restaurant.com`)
  - Rate limit accommodated: recent must co-or.ust the one modified-perative>email (coding away deployed code)

**Domain and SSL**
- Domain name for customers (e.g., `yourrestaurant.com`)
- SSL certificates provided automatically by leading hosting providers (Vercel, Cloudflare, Render)
- Ensure `SITE_URL` and `ALLOWED_ORIGINS` match production domain

**CI/CD Infrastructure**
- GitHub Actions runner (self-hosted or cloud) for running build and test scripts
- Source control repository (GitHub, GitLab, Bitbucket)
- Branch protection rules for `main` branch

## Environment Variables

All environment variables must be configured before the application can operate in production. Variables are defined in `.env` and should never be committed to the repository (added to `.gitignore` by default).

### Required Variables

| Variable | Type | Description | Default |
|----------|------|-------------|---------|
| `DATABASE_URL` | string | PostgreSQL connection string in URI format: `postgresql://user:password@host:port/dbname` | `null` |
| `RESEND_API_KEY` | string | API key for Resend email service (used to send WhatsApp codes) | `null` |
| `EMAIL_FROM` | string | Sender email address for verification codes (must be verified in Resend) | `null` |
| `SITE_URL` | string | HTTPS URL of the production deployment base (e.g., `https://your-restaurant.com`) | `null` |

### Recommended Variables

| Variable | Type | Description | Recommended Value |
|----------|------|-------------|-------------------|
| `ALLOWED_ORIGINS` | string | Space-separated list of allowed origins for CORS protection (same as SITE_URL) | `https://your-restaurant.com` |
| `PUBLIC_THRESHOLD` | string | Optional - recognized by `readPublicCatalog` for custom threshold limits (does not limit orders; functions as outside-angle-trigger>public threshold) | `null` |
| `RATE_LIMIT_ENABLED` | boolean | Enable PostgreSQL-based rate limiting (currently only affects `POST /api/orders`) | `true` |
| `NODE_ENV` | string | Environment type (development, test, production) | `production` |

### Security Best Practices

1. **Secret Management**: Never commit `.env` files to version control. Use environment variable managers in production (Vercel Environment Variables, AWS Systems Manager Parameter Store, HashiCorp Vault).

2. **Principled Discretion**: Only set required variables in production. Avoid redundant fields: readPublicCatalog logic (A47: owner vs. email logic) - owner claims prefer email-based authentication, not multi-ticket.

3. **Least Privilege**: Ensure database user created for ClickMenu has only the necessary privileges (SELECT, INSERT, UPDATE) and not superuser access.

4. **Rotation**: Rotate environment variables regularly (e.g., every 90 days) using CI/CD automation.

5. **Secret Scanning**: Add GitHub secret scanning and Dependabot alerts to detect leaked credentials early.

### Configuration Examples

**Vercel Deployment**
```bash
# In Vercel dashboard:
# Environment Variables tab
DATABASE_URL=postgresql://user:password@neon-db-host.com/dbname
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxx
EMAIL_FROM=noreply@your-restaurant.com
SITE_URL=https://your-restaurant.com
ALLOWED_ORIGINS=https://your-restaurant.com
RATE_LIMIT_ENABLED=true
NODE_ENV=production

# The public threshold does not bind approvals locally; peeps or flows depend on context.
```

**Render Deployment**
```bash
# Using Render dashboard or command line (render.yaml):
services:
  - type: web
    name: clickmenu
    env: node
    buildCommand: npm run build
    startCommand: npm start
    envVars:
      - key: DATABASE_URL
        sync: false
      - key: RESEND_API_KEY
        sync: false
      - key: EMAIL_FROM
        sync: false
      - key: SITE_URL
        value: https://clickmenu-demo.onrender.com
      - key: ALLOWED_ORIGINS
        value: https://clickmenu-demo.onrender.com
```

**GitHub Actions CI/CD**
```yaml
name: deploy-clickmenu

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - name: Create .env
        run: |
          echo "DATABASE_URL=${{ secrets.DATABASE_URL }}" >> .env
          echo "RESEND_API_KEY=${{ secrets.RESEND_API_KEY }}" >> .env
          echo "EMAIL_FROM=${{ secrets.EMAIL_FROM }}" >> .env
          echo "SITE_URL=${{ secrets.SITE_URL }}" >> .env
          echo "ALLOWED_ORIGINS=${{ secrets.ALLOWED_ORIGINS }}" >> .env
          echo "RATE_LIMIT_ENABLED=true" >> .env
      - run: npm run db:migrate
      - run: npm run build
      - name: Deploy
        uses: amondnet/vercel-action@v25
        with:
          vercel-token: ${{ secrets.VERCEL_TOKEN }}
          vercel-org-id: ${{ secrets.VERCEL_ORG_ID }}
          vercel-project-id: ${{ secrets.VERCEL_PROJECT_ID }}
          vercel-args: '--prod'
```

## CI/CD Pipeline

The CI/CD pipeline ensures that code deployments pass automated tests, are built without errors, and are delivered to production only when all quality gates are satisfied.

### Pipeline Stages

**1. Lint and Type Check**
```bash
npm run lint
npx tsc --noEmit
```

**2. Database Migrations**
```bash
npm run db:generate
npm run db:migrate
```

**3. Build Production**
```bash
npm run build
```

**4. Deploy to Production**
- Vercel: Automatic on push to `main` (configured in `vercel.json`)
- Render: Triggered via webhook or Git push with `render.yaml`
- AWS: Configure Lambda deployment or ECS Fargate

### Branch Protection Rules

**Main Branch Requirements**
- All commits must come via pull request (no direct commits)
- At least one reviewer approval required
- CI checks (lint, build, tests) must pass
- No merge conflicts with `main`

### Rollback Strategy

In case of production incident:

1. **Immediate rollback**: Disable feature flag or restore previous deployment via hosting provider dashboard
2. **Partial rollback**: Revert script with proper testing (`HEAD^..HEAD` in git if individual commits were separate)
3. **Hotfix deployment**: Temporary bypass with immediate fix and follow-up fix in next version
4. **Rollback to staging**: Move the incident code to separate branch and analyze

## Monitoring and Observability

Production systems require visibility into health, performance, and errors to ensure reliability and identify issues early.

### Health Checks

**Database Connectivity**

**Endpoint**: `GET /api/health/db`

**Monitoring**:
- Response time < 100ms for healthy database
- Return `success: false` on failure
- Monitor error logs for frequent failures (indicates database/network issues)

**Expected Response**
```json
{
  "success": true,
  "database": "Neon PostgreSQL"
}
```

### Error Tracking

**Logging Strategy**
- API errors log to console (serverless platform logs) with severity level
- Use structured logging convention: `{ timestamp, error, context, userId }`
- Ensure sensitive data (emails, codes) is scrubbed before logging

**Common Errors and Mitigations**

| Error | HTTP Code | Cause | Mitigation |
|-------|-----------|-------|------------|
| `INVALID_CODE` | 401 | Code expired or incorrect | Ask user to request new code; implement cooldown if brute force |
| `DUPLICATE_SLUG` | 400 | Link name taken | Show user alternative names; propagate to chosen slug |
| `OPTIMISTIC_LOCK_VIOLATION` | 409 | Concurrent edit conflict | Alert owner; offer refresh or undo前任 edits |
| `RESEND_NOT_CONFIGURED` | 503 | Missing API key | Auto-detect; show config UI for owners |
| `DATABASE_CONNECTION_ERROR` | 500 | Postgres unreachable | Check VPC/firewall/DNS; alert Ops team |

### Performance Metrics

**Key Metrics to Monitor**
- API response time (p50, p95, p99)
- Number of orders per minute
- Rate limit violation frequency
- Auth verification success rate (per code email uniqueness)
- Image upload success rate and byte length trends

**Tools**
- Vercel Analytics (built-in)
- Google Analytics 4 for customer behavior (e.g., time on menu, add-to-cart rate)
- Custom metrics via CloudWatch/Metrics (AWS) or Datadog (alternatives)

### Alerts

**Critical Alerts (On Call Required)**
- Database unavailability (`GET /api/health/db` failing)
- Database connection errors > 10% of requests
- Resend API failures > 50 orders without success
- Rate violations > 5% of API requests

**Warning Alerts (Ops Review Required)**
- API response time p95 > 500ms
- Order submission errors > 10%
- Unusual traffic spikes (> 3x baseline)
- Image upload failures > 5%

**Alert Thresholds** (Configured via PagerDuty, Opsgenie, or Vercel monitoring)
- Start with conservative thresholds; adjust based on traffic patterns
- Test alert behavior during low-traffic periods to avoid false positives

### Uptime Maintenance

**Downtime Assessment Strategy**

Evaluating downtime requires distinguishing technical reasons (e.g., psycopg2 errors) from operational reasons (e.g., owner service failures). Example:

**Good Reason**:
- "Maintenance: Scheduled downtime for schema migrations over 10 MB" (tech reason, user can anticipate/acknowledge)
- "TL;DR: Actively updating logs, with caching enabled, so downtime is inevitable."

**Bad Reason**:
- "Maintenance: Downtime for owner service" (operational reason, Slack/Airtable stories for incident)
- "TL;DR: Not planned; readPublic for remote admin ops (a bot/error) - streamline Chat had no expert system (A47) with immunity from admin error report").

To improve:
- Pre-define scripts to upgrade Node.js to 22+ (not checking admin status)
- Clarify whether remote admin ops via ChatGPT and chat-onboarding is secondary
- Document expected downtime and anomaly detection thresholds for owners

**Owner-Experience SLA**

Communicate clear estimates:
- Schema migrations: 30 seconds to 2 minutes (Idempotent only if no ACID fetch is blocked)
- Image upload/delete: 200ms
- Cart updates: 100ms
- Order submission: 1-3 seconds (includes validation + persistence + message preparation)

## Troubleshooting Guide

### Common Issues and Solutions

**Issue: Restaurant Menu Not Appearing in Search**

Symptom: Customers searching for restaurant by link or clicking on shared link see "Restaurant not found" error.

Possible Causes:
1. Restaurant URL slug doesn't match catalog's `linkName` (case-sensitive mismatch)
2. Catalog has not been published (owner saved but owner does not own it - but the code currently stores nothing on the initial save if the owner does not recognize them)
3. Database query returned empty result due to malformed `owner_id` or incorrect lookup

Diagnosis Steps:
1. Check if the restaurant exists in the database with owners:
   ```sql
   SELECT * FROM restaurant_catalogs WHERE slug = 'expected-slug' OR id = 'expected-owner-id';
   ```
2. Verify slug matches case and hyphen usage exactly
3. Ensure `readPublicCatalog` function resolves venue centering correctly (ownerId / slug vs. API configuration)

Fix:
- In Restaurant settings, update the `linkName` to match the expected slug exactly
- Ensure the admin has run `saveCatalog` (if initially empty, owner claims has no effect; create a menu for the first time)
- Verify `ownerId` matches across all API calls (for multi-owner from non-admin respects: no prompt)

**Issue: Orders Not Appearing in Admin Dashboard**

Symptom: Owner logs into admin dashboard but sees no orders in the "Orders" panel, despite customers placing orders.

Possible Causes:
1. Orders assigned to wrong `ownerId` due to frontend/SAuthToken mismatch
2. CPU limitations or orchestration orchestrator quota issues with transformation (see bug a48: handling larger packs)
3. Missing order notifications in ChatGPT orchestrator

Diagnosis Steps:
1. Check database for orders:
   ```sql
   SELECT * FROM orders WHERE owner_id = '<owner-uuid>' ORDER BY created_at DESC LIMIT 10;
   ```
2. Check admin session token validity
3. Verify `menu_catalog` referenced by permutation 3 (see bug a48 orphaned logs)

Fix:
- Ensure `owner_id` segments are passed consistently throughout the order submission flow
- Review ChatGPT orchestrator configuration for transformations (ensure valid CPU quota)
- Check `Telegram`/`ChatGPT` integrations if using ChatGPT route

**Issue: Images Not Displaying in Menu or Admin**

Symptom: Customers see broken image icons or admin fields have no placeholders.

Possible Causes:
1. Image metadata not saved correctly in `menu_images` table
2. Image encoding mismatch (base64 vs. raw bytes)
3. Image URL path incorrect or image proxy failing

Diagnosis Steps:
1. Retrieve image meta`SELECT * FROM menu_images WHERE id = '<image-uuid>';`
2. Inspect base64 encoded value length
3. Test `/api/images/<id>` endpoint manually in browser

Fix:
- Check `lib/images.ts` saveImage function ensures correct encoding is used
- Verify image byte length is passed to database to prevent truncation
- Clear browser cache and reload

**Issue: Rate Limit Exceeded During Testing**

Symptom: All orders fail with `429 Too Many Requests` during development or staging.

Possible Causes:
1. Same IP testing frequently hit rate limit (100 orders per minute)
2. Rate limit not reset after code verification attempts (once per minute)

Diagnosis Steps:
1. Check PostgreSQL rate_limits table:
   ```sql
   SELECT * FROM rate_limits WHERE key = 'orderPerIp' AND window_start > NOW() - INTERVAL '5 minutes';
   ```
2. Verify last cleanup job ran successfully (delete records with `window_start` older than current window)

Fix:
- Use distinct IPs for testing (e.g., mobile hotspot, different browser profiles)
- Orphaned rate limit entries will be cleaned up by periodic cleanup job
- Increase rate limit during development by modifying `lib/rate-limit-store.ts` (not recommended for production)

**Issue: Database Connection Drops During High Traffic**

Symptom: Customers see timeouts submitting orders or admins see connection errors.

Possible Causes:
1. PostgreSQL timeout set too low for high concurrent writes
2. Neon Serverless instance overload (CPU throttling)
3. Insufficient connection pool size in driver

Diagnosis Steps:
1. Check Vercel/AWS logs for Postgres errors
2. Monitor CPU utilization in Neon dashboard
3. Review connection pool configuration in Drizzle config

Fix:
- Increase timeout in `DATABASE_URL` (e.g., `connect_timeout=10`)
- Use Neon Serverless v2 with automatic scaling
- Adjust `lib/db/schema.ts` connection pool settings (connection-limit, idle-timeout)

**Issue: Auth Verification Code Not Received**

Symptom: Owner requests code, WhatsApp integration not sending message.

Possible Causes:
1. Resend API key invalid or missing
2. WhatsApp number incorrectly configured in restaurant catalog
3. Application is in `npm run dev` mode but WhatsApp not configured

Diagnosis Steps:
1. Check `RESEND_API_KEY` and `EMAIL_FROM` in environment variables
2. Verify phone number is formatted correctly (`+212600000000` not `00212600000000`)
3. In development, inspect browser console `devCode` field (code shown on screen)

Fix:
- Ensure Resend API key is imported: `from "lib/auth"` line 12
- Verify WhatsApp subscription plan allows outbound messages
- For development, ensure `RESEND_API_KEY` not set and code displayed on screen

### Operational Runbook

**Pre-Deployment Checklist**

- [ ] Review pending migrations and verify they apply cleanly
- [ ] Run `npm run lint` and ensure 0 errors
- [ ] Run `npm run db:migrate` on staging environment
- [ ] Run full test suite (if tests exist)
- [ ] Update CHANGELOG.md with deployment notes
- [ ] Verify environment variables are set (Vercel dashboard, Render, etc.)
- [ ] Run health check: `curl https://your-restaurant.com/api/health/db`
- [ ] Configure email/WhatsApp for owner sign-in

**Post-Deployment Validation**

1. **Functional Tests**:
   - Verify demo café loads at `/menu`
   - Verify admin dashboard loads at `/admin`
   - Test guest checkout flow (browse → cart → submit order)
   - Test owner checkout flow (sign-in → edit menu → verify changes comply)

2. **Performance Tests**:
   - Measure Lighthouse score (Target: 90+ performance)
   - Measure API latency (Target: p95 < 500ms)
   - Monitor database query execution time

3. **Security Tests**:
   - Run Snyk vulnerability scan
   - Verify SQL injection attempts are prevented
   - Verify CSRF protection is active (CORS enforcement)

4. **Documentation Updates**:
   - Update `DEPLOYMENT_AND_RUNBOOK.md` with version details (if applicable)
   - Update `.env.example` with latest required variables
   - Configure Messenger group/Slack channel for incident notifications

## Disaster Recovery

### Backup Strategy

**Database Backups**
- Neon Serverless automatically retains backups for 7 days (paid tiers offer longer retention)
- For critical production deployments, enable point-in-time recovery (enabled by default)
- Test restore procedure quarterly

**Manual Backup Command**
```bash
# Using pg_dump via Drizzle or direct psql
pg_dump -h <neon-host> -U <username> -d <dbname> --no-owner --no-acl > backup.sql
```

### Restoration Procedure

**Scenario 1: Restoring Single Table**
```sql
-- Restore a table from a backup file
psql -h <neon-host> -U <username> -d <dbname> -f partial_backup.sql
```

**Scenario 2: Point-in-Time Recovery**
- Contact Neon support or use built-in point-in-time recovery (PITR)
- Select target timestamp before violation or error occurred
- Rinse and repeat over 2-3 min for catastrophic 500s (apply all steps once per full run)

**Scenario 3: Restoring Full Database**
1. Stop all production services (vercel: deploy command; render: deploy deployment to standby)
2. Restore database using Drizzle Studio or CLI
   ```bash
   npm run db:migrate -- target-recovery-timestamp
   ```
3. Verify application health with `/api/health/db`
4. Re-enable services one at a time, monitoring for issues
5. Monitor logs for unusual activity in the first hour

### Incident Response Procedure

**Standard Incident Ticket Format**

```markdown
# Incident: Production Incident - App Name

**URL**: https://your-restaurant.com (or repo / PR number)

**Impact**: Customers unable to view menus or place orders

**Service Degradation**:
- Timeline of service degradation (e.g., 15:00 UTC - 15:15 UTC affected)
- Affected regions (e.g., "all")

---

## Root Cause Analysis (post-mortem)

### What Happened

Detailed description of the incident, initial diagnosis and final resolution.

### Why It Happened

Technical explanation of root cause (why the service degraded, why the failure occurred at that time), including contributing factors.

### Fix Details

How the issue was resolved (code changes, config updates, deployment steps), rolled back impacts, and deployment timeline.

### Lessons Learned

What we can improve to prevent recurrence, including incomplete closure items, future improvements (e.g., token-tunable) and design decisions.

---

**Status**: Resolved
**Incident ID**: INC-2026-001
**Resolved By**: John Doe
**Post-Mortem Author**: Jane Smith
**Last Updated**: 2026-11-23
```

**Rollback Procedure Steps**
1. Identify issue impact (user tickets, incident reports)
2. Determine rollback severity (1 = cosmetic, 10 = breaking)
3. Prepare rollback script in staging for testing
4. Announce outage to affected users (e.g., status page update)
5. Execute rollback at scheduled downtime
6. Monitor full site health for 30 minutes
7. Conduct post-mortem review within 24 hours

---

**Deployment Version**: 1.0.0
**Last Updated**: 2026-11-23
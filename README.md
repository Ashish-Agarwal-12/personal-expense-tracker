# Debt-Free Tracker

A personal app to stop overspending and get out of debt. It tracks daily expenses, puts every EMI in one place, and **warns you before you spend money you don't have**.

Built with **Next.js 16 (App Router) + TypeScript + React 19**. Your data is stored in **MongoDB Atlas**, the app runs on **Vercel**, and it is protected by a password, so you can open it from your phone or any computer.

```
 git push ──► GitHub Actions ──► tests pass? ──► Vercel deploy ──► https://your-app.vercel.app
                                                  (PR → preview,          │
                                                   main → production)  MongoDB Atlas
```

---

## One-time setup (≈ 20 minutes, all free)

### 1. MongoDB Atlas — the database

1. Sign up at <https://www.mongodb.com/cloud/atlas/register> and create a **free M0 cluster** (region close to you, e.g. Mumbai).
2. **Database Access** → *Add New Database User* → username + strong password, role *Read and write to any database*.
3. **Network Access** → *Add IP Address* → `0.0.0.0/0`.
   Vercel Functions don't have fixed IP addresses, so this is required. The database is still protected by the user/password.
4. **Connect** → *Drivers* → copy the connection string (`mongodb+srv://<user>:<password>@cluster0.xxxxx.mongodb.net/`).

### 2. Vercel — the website

1. Sign up / log in at <https://vercel.com> with **GitHub** (the same Vercel account you use for v0).
2. **Add New… → Project** → import `personal-expense-tracker`. Framework preset: **Next.js** (also set in `vercel.json`).
3. Open **Environment Variables** and add:

   | Name | Value | Environments |
   |---|---|---|
   | `MONGODB_URI` | your Atlas connection string | Production, Preview |
   | `MONGODB_DB` | `personal-expense-tracker` | Production |
   | `MONGODB_DB` | `personal-expense-tracker-preview` | Preview — so test deployments never touch your real data |
   | `APP_PASSWORD` | the password **you** will log in with (8+ characters, not reused) | Production, Preview |
   | `SESSION_SECRET` | a long random string — generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` | Production, Preview |

4. Click **Deploy**. Your site will be at `https://<project-name>.vercel.app`.

> `vercel.json` turns off Vercel's own deploy-on-every-push, so that **GitHub Actions** decides what goes live (only code that passes the tests).

### 3. GitHub — connect CI/CD

Collect three values:

- **VERCEL_TOKEN** → <https://vercel.com/account/tokens> → *Create Token* (scope: your account).
- **VERCEL_ORG_ID** → Vercel → *Account Settings → General* → **Vercel ID** (if the project is under a team, use the team's *Team ID* instead).
- **VERCEL_PROJECT_ID** → your project → *Settings → General* → **Project ID**.

Then in the GitHub repo: **Settings → Secrets and variables → Actions**

| Tab | Name | Value |
|---|---|---|
| Secrets | `VERCEL_TOKEN` | the token |
| Secrets | `VERCEL_ORG_ID` | the Vercel / Team ID |
| Secrets | `VERCEL_PROJECT_ID` | the Project ID |
| Variables | `APP_URL` | `https://<project-name>.vercel.app` (used for the after-deploy health check) |

From now on:

- **Pull request** → tests run → if they pass, a **preview** deployment is made (link in the Actions run summary).
- **Push / merge to `main`** → tests run → if they pass, **production** is deployed and health-checked.
- A failing test **blocks** the deploy.

### Moving data from the old offline version

If you used the earlier browser-only version, open the new site **in the same browser** and log in. It will offer to upload that data to the database.

---

## Run it on your computer

```bash
npm install
npm run dev
```

Open <http://localhost:5173>. Settings come from `.env` (copy `.env.example`). Without `MONGODB_URI` it uses a **temporary in-memory database**; without `APP_PASSWORD` the password is `dev-password`.

```bash
npm test            # Vitest: API routes (throwaway MongoDB), budget maths, setup checks
npm run typecheck   # TypeScript
npm run build       # production build
```

---

## How your limit is calculated

```
Monthly spending limit = Salary − All EMIs − Fixed bills − Savings
Safe to spend today    = (What's left this month) ÷ (Days left in month)
```

## Warnings you'll get

| When | Warning |
|---|---|
| 70% / 90% / 100% of monthly limit used | Dashboard banner turns amber → red |
| Today's spending crosses today's safe limit | "Spend nothing more today" |
| Credit card spending crosses your cap | Red banner — credit card interest is ~36–42%/year |
| EMIs are more than 35% / 50% of salary | "Don't take any new loan" |
| An EMI due date has passed and isn't marked paid | Overdue alert |
| A category goes over its limit | Category warning |
| **Before** saving an expense that breaks any limit | A "Wait — think before you spend" pop-up with a **Don't buy it** button |

## Security

- Every piece of data needs a login; the session cookie is `HttpOnly`, `Secure` and `SameSite=Strict`, valid for 30 days.
- Changing `APP_PASSWORD` in Vercel (then redeploying) logs out every device.
- 10 wrong passwords from one IP blocks login for 15 minutes (tracked in MongoDB, so it holds across all serverless instances).
- All input is validated on the server before it reaches MongoDB.
- Strict Content Security Policy with a fresh nonce per request (`proxy.ts`), so only scripts Next.js rendered can run.
- If the server is misconfigured, the site says exactly which setting is wrong — without ever showing secret values.

## Project structure

```
app/
  page.tsx, layout.tsx      the page (hosts the React app)
  globals.css               styles (auto light / dark mode)
  api/**/route.ts           API routes: login, data, expenses, EMIs, categories, settings, import
components/
  TrackerApp.tsx            login / setup-problem / app shell, tabs
  views.tsx                 Dashboard, Expenses, EMIs, Budget & Settings screens
  forms.tsx                 expense, EMI and category forms
  tracker-context.tsx       your data + actions (instant updates, saved to the server)
  ui.tsx                    pop-ups, toasts, small shared pieces
lib/
  budget.ts                 all budget maths and warnings (pure, unit-tested)
  format.ts, types.ts       formatting helpers and shared data types
  client/api.ts             browser → API calls
  server/                   MongoDB connection, data access, validation, login, setup checks
proxy.ts                    per-request Content Security Policy
test/                       Vitest tests
.github/workflows/          CI/CD pipeline
vercel.json                 Vercel settings (deploys come from GitHub Actions)
```

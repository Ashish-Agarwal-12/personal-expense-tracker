# Debt-Free Tracker

A personal app to stop overspending and get out of debt. It tracks daily expenses, puts every EMI in one place, and **warns you before you spend money you don't have**.

Your data is stored in **MongoDB Atlas**, the website runs on **Render**, and it is protected by a password, so you can open it from your phone or any computer.

```
 git push ──► GitHub Actions ──► tests pass? ──► Render deploys ──► https://your-app.onrender.com
                                                                           │
                                                                     MongoDB Atlas
```

---

## One-time setup (≈ 20 minutes, all free)

### 1. MongoDB Atlas — the database

1. Sign up at <https://www.mongodb.com/cloud/atlas/register> and create a **free M0 cluster**. Pick a region close to you (e.g. Mumbai).
2. **Database Access** → *Add New Database User* → choose a username and a strong password. Role: *Read and write to any database*.
3. **Network Access** → *Add IP Address* → `0.0.0.0/0` (allow from anywhere).
   Render's free plan has no fixed IP address, so this is required. The database is still protected by the user/password from step 2.
4. **Database** → *Connect* → *Drivers* → copy the connection string. It looks like:
   ```
   mongodb+srv://<user>:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
   ```
   Replace `<password>` with the password from step 2.

### 2. Render — the website

1. Sign up at <https://render.com> with your GitHub account.
2. **New → Blueprint** → choose the `personal-expense-tracker` repo. Render reads `render.yaml` and asks for:
   - `MONGODB_URI` → the connection string from Atlas
   - `APP_PASSWORD` → the password **you** will use to log in to the tracker (8+ characters, don't reuse another password)
3. Click **Apply**. The first deploy takes a few minutes; you'll get a URL like `https://debt-free-tracker.onrender.com`.
4. Open the service → **Settings → Deploy Hook** → copy the URL. (Keep it secret — anyone with it can trigger a deploy.)

### 3. GitHub — connect CI/CD

In the GitHub repo: **Settings → Secrets and variables → Actions**

| Tab | Name | Value |
|---|---|---|
| Secrets | `RENDER_DEPLOY_HOOK_URL` | the Deploy Hook URL from Render |
| Variables | `APP_URL` | your Render URL, e.g. `https://debt-free-tracker.onrender.com` |

That's it. From now on:

- **Every push / pull request** → GitHub Actions runs the tests.
- **Push to `main` with passing tests** → Actions triggers a Render deploy and waits until the new version is healthy.
- A failing test **blocks** the deploy, so a broken version never goes live.

You can watch runs in the repo's **Actions** tab.

> **Free plan note:** Render's free service sleeps after 15 minutes of no use. The first visit after that takes ~30–60 seconds to wake up; after that it's fast.

### Moving data from the old offline version

If you used the earlier browser-only version, open the new website **in the same browser** and log in. It will offer to upload your saved data to the database.

---

## Run it on your computer

```bash
npm install
npm run dev
```

Open <http://localhost:5173>. Without a `.env` file it uses a **temporary in-memory database** (data is lost when you stop it) and the password `dev-password`.

To use your real Atlas database locally, copy `.env.example` to `.env` and fill it in.

```bash
npm test         # API tests (uses a throwaway MongoDB)
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

- Every page of data needs a login; the session cookie is `HttpOnly`, `Secure` and `SameSite=Strict`, valid for 30 days.
- Changing `APP_PASSWORD` on Render logs out every device.
- 10 wrong passwords from one IP blocks login for 15 minutes.
- All input is validated on the server before it reaches MongoDB.

## Project structure

```
public/                 the website (HTML, CSS, JS)
server/app.js           API routes
server/auth.js          password login + session cookie
server/validate.js      input validation
server/index.js         starts the server, connects to MongoDB
test/api.test.js        API tests
.github/workflows/      CI/CD pipeline
render.yaml             Render hosting config
```

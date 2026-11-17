# Debt-Free Tracker

A simple personal app to stop overspending and get out of debt. It tracks daily expenses, puts every EMI in one place, and **warns you before you spend money you don't have**.

No sign-up, no server, no internet needed. Your data stays only in your browser on your own device.

## Run it

You need [Node.js](https://nodejs.org) installed (no `npm install` needed — there are no dependencies).

```bash
npm start
```

Then open http://localhost:5173 in your browser.

> Tip: use the same browser every time — data is stored in that browser. Use **Budget & Settings → Download backup** regularly.

## First-time setup (5 minutes)

1. **Budget & Settings** → enter:
   - Monthly take-home salary
   - Fixed bills (rent, electricity, phone, internet…)
   - Amount to save each month (even ₹1,000 helps build an emergency fund)
   - Max credit card spend per month (set `0` if you want to stop using the card)
2. **EMIs & Loans** → add *every* EMI: personal loans, credit card EMIs, "No-cost EMI" phones, bike/car loans. Enter the EMI amount, due day, total months, and how many you've already paid.
3. Optionally set **category limits** (e.g. Eating out ₹2,000/month).

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

## Every month

- When you pay an EMI, tap **Mark paid** — the app counts down the months left and shows your **debt-free date**.
- Add expenses as they happen (the **+ Add expense** button is always at the top).

## Project structure

```
index.html      page layout
css/styles.css  styling (auto light / dark mode)
js/app.js       all logic: budget maths, warnings, EMIs, storage
serve.js        tiny local web server
```

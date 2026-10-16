# Lead CRM

Collects leads from Meta Lead Ads, WhatsApp, your website, and manual entry into one dashboard. Each lead gets an ID like `LD-YYMMDD-0001`, a status, an activity log, and live alerts (dashboard plus optional Telegram).

## What’s new
- Add a lead from the dashboard
- Export CSV
- Call / WhatsApp / Email links on a lead
- Clickable status tiles to filter
- Public `/health` check for hosting
- Dashboard files live in `public/` so the UI actually loads on deploy

## 1. Deploy on Render
1. Push this repo to GitHub.
2. [Render](https://dashboard.render.com) → **New** → **Blueprint** and select the repo (uses `render.yaml`), **or** **New Web Service** and connect the repo.
3. If you create the service manually:
   - Build: `npm install`
   - Start: `npm start`
   - Instance: Starter (needed for a persistent disk)
4. Add a **persistent disk**, mount `/var/data`, and set `DB_PATH=/var/data/crm.db`. Without a disk the SQLite file is wiped on every deploy.
5. Set environment variables from `.env.example`. Render sets `PORT` for you. Copy `ADMIN_PASSWORD` from Render after it generates one (or set your own).
6. Open the service URL. Browser login: any username, password = `ADMIN_PASSWORD`.

### Railway
New project from the GitHub repo, start command `npm start`, add the same env vars. Attach a volume and point `DB_PATH` at a file on that volume.

## 2. Meta (Lead Ads + WhatsApp)
1. [developers.facebook.com](https://developers.facebook.com) → Create App (Business). Copy App Secret into `META_APP_SECRET`.
2. Webhooks: callback URL `https://YOUR-URL/webhooks/meta`, verify token = `META_VERIFY_TOKEN`.
3. Subscribe the Page object to `leadgen` and the WhatsApp Business Account object to `messages`.
4. Generate a Page access token with `leads_retrieval`, `pages_manage_metadata`, `pages_show_list`, then put it in `META_PAGE_TOKEN`.
5. Test with Meta's Lead Ads Testing Tool and by messaging your WhatsApp API number.

## 3. Website form
```html
<form id="lead">
  <input name="name" required><input name="phone"><input name="email">
  <input name="company" style="display:none" tabindex="-1"> <!-- spam trap -->
  <textarea name="message"></textarea><button>Send</button>
</form>
<script>
document.getElementById('lead').onsubmit=async e=>{e.preventDefault();
 await fetch('https://YOUR-URL/api/leads/website',{method:'POST',headers:{'Content-Type':'application/json'},
 body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});e.target.reset();alert('Thanks!')}
</script>
```
Set `WEBSITE_ORIGIN` to your site origin (for example `https://yoursite.com`) so the browser allows the POST.

## 4. Phone alerts (optional)
Message [@BotFather](https://t.me/BotFather) to create a bot, set `TELEGRAM_TOKEN`, send the bot a message, then get your chat id from `https://api.telegram.org/bot<TOKEN>/getUpdates` and set `TELEGRAM_CHAT_ID`.

## Local test
```
npm install
copy .env.example .env
```
Edit `.env`, then `npm start` and open http://localhost:3000

Fake website lead:
```
curl -X POST localhost:3000/api/leads/website -H "Content-Type: application/json" -d "{\"name\":\"Test\",\"phone\":\"+923001234567\"}"
```

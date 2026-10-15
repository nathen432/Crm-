# Lead CRM

Collects leads from Meta Lead Ads, WhatsApp and your website into one dashboard with unique IDs (LD-YYMMDD-0001), statuses, an activity log and live alerts (dashboard + optional Telegram on your phone).

## 1. Deploy
1. Put this folder on GitHub, then create a Web Service on Render (or Railway) from it. Build: `npm install`, Start: `npm start`.
2. Add the variables from `.env.example` in the host's Environment settings.
3. Add a persistent disk and set `DB_PATH` to a path on it (otherwise the database resets on redeploy).
4. Open your URL. Browser asks for a password: any username, password = ADMIN_PASSWORD.

## 2. Meta (Lead Ads + WhatsApp)
1. developers.facebook.com > Create App (Business). Copy App Secret into META_APP_SECRET.
2. Webhooks: callback URL `https://YOUR-URL/webhooks/meta`, verify token = META_VERIFY_TOKEN.
3. Subscribe the Page object to `leadgen` and the WhatsApp Business Account object to `messages`.
4. Generate a Page access token with `leads_retrieval`, `pages_manage_metadata`, `pages_show_list`, then put it in META_PAGE_TOKEN.
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

## 4. Phone alerts (optional)
Message @BotFather on Telegram to create a bot, set TELEGRAM_TOKEN, send the bot a message, then get your chat id from `https://api.telegram.org/bot<TOKEN>/getUpdates` and set TELEGRAM_CHAT_ID.

## Local test
`npm install && cp .env.example .env` (edit it) `&& npm start`, then open http://localhost:3000
Fake website lead: `curl -X POST localhost:3000/api/leads/website -H "Content-Type: application/json" -d '{"name":"Test","phone":"+923001234567"}'`

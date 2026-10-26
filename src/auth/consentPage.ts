const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function renderConsentPage(input: { pendingId: string; clientName: string; redirectHost: string; error?: string }): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Authorize access · Company Intelligence MCP</title>
<style>
  :root { color-scheme: light dark; --bg:#f6f7f9; --card:#fff; --fg:#111827; --muted:#6b7280; --line:#e5e7eb; --accent:#2563eb; --err:#b91c1c; }
  @media (prefers-color-scheme: dark) { :root { --bg:#0b0f17; --card:#131a26; --fg:#e5e7eb; --muted:#9ca3af; --line:#273042; --accent:#60a5fa; --err:#f87171; } }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:grid; place-items:center; padding:24px 16px; background:var(--bg); color:var(--fg);
         font:15px/1.5 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
  main { width:100%; max-width:420px; background:var(--card); border:1px solid var(--line); border-radius:12px; padding:28px; }
  h1 { font-size:20px; margin:0 0 8px; }
  p { margin:0 0 16px; color:var(--muted); }
  strong { color:var(--fg); }
  label { display:block; font-weight:600; margin-bottom:6px; }
  input { width:100%; padding:10px 12px; border:1px solid var(--line); border-radius:8px; background:transparent; color:inherit; font:inherit; font-family:ui-monospace, monospace; }
  .error { color:var(--err); margin:10px 0 0; }
  /* Approve comes first in the markup so Enter submits it; row-reverse still shows Deny on the left. */
  .row { display:flex; flex-direction:row-reverse; gap:10px; margin-top:20px; }
  button { flex:1; padding:10px; border-radius:8px; border:1px solid var(--line); background:transparent; color:inherit; font:inherit; font-weight:600; cursor:pointer; }
  button[value=approve] { background:var(--accent); border-color:var(--accent); color:#fff; }
  ul { margin:0 0 16px; padding-left:20px; color:var(--muted); }
</style>
</head>
<body>
<main>
  <h1>Authorize ${escapeHtml(input.clientName)}</h1>
  <p><strong>${escapeHtml(input.clientName)}</strong> wants to use the Company Intelligence MCP server on your behalf.
     After you approve, you'll be sent back to <strong>${escapeHtml(input.redirectHost)}</strong>.</p>
  <ul><li>Search companies and contacts</li><li>Enrich contacts</li><li>Create contact exports</li></ul>
  <form method="post" action="/oauth/consent">
    <input type="hidden" name="pending_id" value="${escapeHtml(input.pendingId)}">
    <label for="api_key">Sign in with your API key</label>
    <input id="api_key" name="api_key" type="password" autocomplete="off" placeholder="aik_…" autofocus>
    ${input.error ? `<p class="error" role="alert">${escapeHtml(input.error)}</p>` : ''}
    <div class="row">
      <button type="submit" name="action" value="approve">Approve</button>
      <button type="submit" name="action" value="deny">Deny</button>
    </div>
  </form>
</main>
</body>
</html>`;
}

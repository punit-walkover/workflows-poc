/* Ticket0 chat widget loader. Paste on any site:
   <script src="https://<ticket0-host>/widget.js" data-title="Support" data-color="#1a1a1a"
           data-name="Jane" data-email="jane@acme.com" async></script>
   data-name / data-email are optional: pass them when the host product knows the signed-in user. */
(function () {
  var s = document.currentScript;
  if (!s || window.Ticket0Chat) return;
  var origin = new URL(s.src).origin;
  var d = s.dataset;
  var color = d.color || '#1a1a1a';
  var q = new URLSearchParams({ title: d.title || 'Support', color: color });
  if (d.name) q.set('name', d.name);
  if (d.email) q.set('email', d.email);

  var frame = document.createElement('iframe');
  frame.src = origin + '/embed?' + q.toString();
  frame.title = d.title || 'Support chat';
  frame.style.cssText = 'position:fixed;right:20px;bottom:92px;width:380px;max-width:calc(100vw - 40px);height:580px;max-height:calc(100vh - 120px);' +
    'border:0;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.18);z-index:2147483000;display:none;background:#fff';

  var btn = document.createElement('button');
  btn.type = 'button';
  btn.setAttribute('aria-label', 'Open support chat');
  btn.style.cssText = 'position:fixed;right:20px;bottom:20px;width:56px;height:56px;border-radius:50%;border:0;cursor:pointer;' +
    'background:' + color + ';color:#fff;box-shadow:0 6px 20px rgba(0,0,0,.2);z-index:2147483000;display:flex;align-items:center;justify-content:center';
  var chatIcon = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
  var closeIcon = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  btn.innerHTML = chatIcon;

  var open = false;
  function set(v) { open = v; frame.style.display = v ? 'block' : 'none'; btn.innerHTML = v ? closeIcon : chatIcon; }
  btn.onclick = function () { set(!open); };
  window.addEventListener('message', function (e) {
    if (e.origin === origin && e.data && e.data.t0 === 'close') set(false);
  });

  document.body.appendChild(frame);
  document.body.appendChild(btn);
  window.Ticket0Chat = { open: function () { set(true); }, close: function () { set(false); } };
})();

/**
 * CYBERTEK Chat Bot — Cloudflare Worker (Service Worker Format)
 * ✅ Paste trực tiếp vào Cloudflare Dashboard Editor — không cần build!
 */

// ─── CẤU HÌNH BOT ─────────────────────────────────────────────────────────────
const BOT_TOKEN = '8489397864:AAHYk87-1RtzecNJ08llP7HbnI8PDNtBDw8';
const CHAT_ID = '8097921469';

// ─── In-memory session store ─────────────────────────────────────────────────
// Lưu các session chat đang hoạt động
const sessions = new Map();

// ─── CORS Headers ─────────────────────────────────────────────────────────────
const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

// ─── Main Event Listener (Service Worker format) ──────────────────────────────
addEventListener('fetch', event => {
    event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
    const url = new URL(request.url);
    const method = request.method;

    // CORS Preflight
    if (method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: CORS });
    }

    // ── POST /contact — Form liên hệ (Hình thức 1) ──────────────────────────
    if (url.pathname === '/contact' && method === 'POST') {
        let data;
        try { data = await request.json(); } catch { return errRes('Invalid JSON'); }

        const { name, phone, email, topic, message } = data;

        const topicLabels = {
            product: 'Hỏi về sản phẩm',
            order: 'Đặt hàng / Pre-order',
            shipping: 'Vận chuyển & giao hàng',
            warranty: 'Bảo hành & hỗ trợ kỹ thuật',
            other: 'Khác',
        };

        const text =
            `📋 <b>LIÊN HỆ MỚI — CYBERTEK</b>\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `👤 <b>Họ tên:</b> ${esc(name)}\n` +
            `📱 <b>SĐT:</b> <code>${esc(phone)}</code>\n` +
            `📧 <b>Email:</b> ${esc(email || 'Không có')}\n` +
            `📌 <b>Chủ đề:</b> ${esc(topicLabels[topic] || topic || 'Không rõ')}\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `💬 <b>Yêu cầu:</b>\n${esc(message)}\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `⏰ ${new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`;

        await tgSend(text);
        return jsonRes({ ok: true, message: 'Đã nhận yêu cầu!' });
    }

    // ── POST /chat — Tin nhắn live chat (Hình thức 2) ───────────────────────
    if (url.pathname === '/chat' && method === 'POST') {
        let data;
        try { data = await request.json(); } catch { return errRes('Invalid JSON'); }

        const { sessionId, message, guestName } = data;
        if (!sessionId || !message) return errRes('Missing fields');

        if (!sessions.has(sessionId)) {
            sessions.set(sessionId, { messages: [], guestName: guestName || 'Ẩn danh' });
        }
        const session = sessions.get(sessionId);
        session.messages.push({ role: 'guest', text: message, time: Date.now() });

        const guestCount = session.messages.filter(m => m.role === 'guest').length;
        const isFirst = guestCount === 1;

        let text;
        if (isFirst) {
            text =
                `💬 <b>CHAT MỚI — CYBERTEK</b>\n` +
                `👤 Khách: <b>${esc(guestName || 'Ẩn danh')}</b>\n` +
                `🔑 Session: <code>${sessionId}</code>\n` +
                `━━━━━━━━━━━━━━━━━━━━\n` +
                `${esc(message)}\n\n` +
                `<i>↩️ Reply tin nhắn này để trả lời khách</i>`;
        } else {
            text =
                `💬 <b>${esc(guestName || 'Khách')}</b> [<code>${sessionId.slice(-6)}</code>]:\n` +
                `${esc(message)}\n\n` +
                `<i>↩️ Reply để trả lời</i>`;
        }

        await tgSend(text);
        return jsonRes({ ok: true });
    }

    // ── GET /poll — Polling nhận reply từ Telegram ──────────────────────────
    if (url.pathname === '/poll' && method === 'GET') {
        const sessionId = url.searchParams.get('session');
        if (!sessionId || !sessions.has(sessionId)) {
            return jsonRes({ ok: true, replies: [] });
        }

        const session = sessions.get(sessionId);
        const pending = (session.messages || []).filter(m => m.role === 'owner' && !m.delivered);
        pending.forEach(m => { m.delivered = true; });

        return jsonRes({
            ok: true,
            replies: pending.map(m => ({ text: m.text, time: m.time })),
        });
    }

    // ── POST /telegram-webhook — Telegram gửi update về đây ─────────────────
    if (url.pathname === '/telegram-webhook' && method === 'POST') {
        let update;
        try { update = await request.json(); } catch { return new Response('ok'); }

        if (update.message) {
            const msg = update.message;
            const fromId = String(msg.from?.id || '');
            const ownerText = (msg.text || '').trim();

            // Chỉ xử lý nếu là chính chủ reply
            if (fromId !== String(CHAT_ID)) return new Response('ok');

            // Lệnh xem sessions
            if (ownerText === '/sessions') {
                const list = [...sessions.keys()].map(k => `• ${k.slice(-6)} (${sessions.get(k).guestName})`).join('\n') || 'Không có session nào đang active.';
                await tgSend(`📊 <b>Sessions đang hoạt động:</b>\n${list}`);
                return new Response('ok');
            }

            // Reply tin nhắn của khách
            if (msg.reply_to_message) {
                const originalText = msg.reply_to_message.text || '';

                // Tìm session từ tin nhắn gốc
                let targetSession = null;

                // Tìm theo Session full ID
                const fullMatch = originalText.match(/Session: ([a-zA-Z0-9_-]+)/);
                if (fullMatch) {
                    targetSession = fullMatch[1];
                }

                // Tìm theo 6 ký tự cuối
                if (!targetSession) {
                    const shortMatch = originalText.match(/\[([a-zA-Z0-9]{6})\]/);
                    if (shortMatch) {
                        for (const [sid] of sessions.entries()) {
                            if (sid.endsWith(shortMatch[1])) {
                                targetSession = sid;
                                break;
                            }
                        }
                    }
                }

                if (targetSession && sessions.has(targetSession)) {
                    sessions.get(targetSession).messages.push({
                        role: 'owner',
                        text: ownerText,
                        time: Date.now(),
                        delivered: false,
                    });

                    // Xác nhận đã ghi nhận
                    await tgSend(`✅ Đã gửi reply tới khách [${targetSession.slice(-6)}]`);
                } else {
                    await tgSend(`⚠️ Không tìm thấy session. Hãy reply đúng vào tin nhắn chat của khách.`);
                }
            }
        }

        return new Response('ok');
    }

    // ── GET /set-webhook — Đăng ký webhook URL với Telegram ─────────────────
    if (url.pathname === '/set-webhook') {
        const webhookUrl = `${url.origin}/telegram-webhook`;
        const resp = await fetch(
            `https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: webhookUrl }),
            }
        );
        const result = await resp.json();
        return jsonRes(result);
    }

    // ── Default ──────────────────────────────────────────────────────────────
    return new Response('CYBERTEK Bot Worker v2.0 ✅ Running', {
        status: 200,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function tgSend(text) {
    return fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: 'HTML' }),
    });
}

function esc(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function jsonRes(data) {
    return new Response(JSON.stringify(data), {
        headers: { 'Content-Type': 'application/json', ...CORS },
    });
}

function errRes(msg, status = 400) {
    return new Response(JSON.stringify({ ok: false, error: msg }), {
        status,
        headers: { 'Content-Type': 'application/json', ...CORS },
    });
}

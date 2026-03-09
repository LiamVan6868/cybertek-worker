/**
 * CYBERTEK Chat Bot — Cloudflare Worker
 * Requires KV Namespace binding: CHAT_SESSIONS
 */

const BOT_TOKEN = '8489397864:AAHYk87-1RtzecNJ08llP7HbnI8PDNtBDw8';
const CHAT_ID = '8097921469';

// Fallback in-memory map if KV is not set up
const memSessions = new Map();

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const method = request.method;

        if (method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

        // -- Helpers inside fetch --
        async function getSession(sid) {
            if (!env.CHAT_SESSIONS) return memSessions.get(sid) || null;
            const str = await env.CHAT_SESSIONS.get(sid);
            return str ? JSON.parse(str) : null;
        }

        async function saveSession(sid, data) {
            if (!env.CHAT_SESSIONS) { memSessions.set(sid, data); return; }
            await env.CHAT_SESSIONS.put(sid, JSON.stringify(data), { expirationTtl: 86400 * 3 }); // 3 days
        }

        // ── POST /contact
        if (url.pathname === '/contact' && method === 'POST') {
            let data; try { data = await request.json(); } catch { return errRes('Invalid JSON'); }
            const { name, phone, email, topic, message } = data;
            const topicLabels = { product: 'Hỏi về sản phẩm', order: 'Đặt hàng / Pre-order', shipping: 'Vận chuyển', warranty: 'Bảo hành', other: 'Khác' };
            const text = `📋 <b>LIÊN HỆ MỚI — CYBERTEK</b>\n━━━━━━━━━━━━━━━━━━━━\n👤 <b>Họ tên:</b> ${esc(name)}\n📱 <b>SĐT:</b> <code>${esc(phone)}</code>\n📧 <b>Email:</b> ${esc(email || 'Không có')}\n📌 <b>Chủ đề:</b> ${esc(topicLabels[topic] || topic || 'Không rõ')}\n━━━━━━━━━━━━━━━━━━━━\n💬 <b>Yêu cầu:</b>\n${esc(message)}`;
            await tgSend(text);
            return jsonRes({ ok: true, message: 'Đã nhận yêu cầu!' });
        }

        // ── POST /chat
        if (url.pathname === '/chat' && method === 'POST') {
            let data; try { data = await request.json(); } catch { return errRes('Invalid JSON'); }
            const { sessionId, message, guestName } = data;
            if (!sessionId || !message) return errRes('Missing fields');

            let session = await getSession(sessionId);
            if (!session) session = { messages: [], guestName: guestName || 'Ẩn danh' };

            session.messages.push({ role: 'guest', text: message, time: Date.now() });
            await saveSession(sessionId, session);

            const isFirst = session.messages.filter(m => m.role === 'guest').length === 1;
            const text = isFirst
                ? `💬 <b>CHAT MỚI — CYBERTEK</b>\n👤 Khách: <b>${esc(guestName || 'Ẩn danh')}</b>\n🔑 Session: <code>${sessionId}</code>\n━━━━━━━━━━━━━━━━━━━━\n${esc(message)}\n\n<i>↩️ Reply tin nhắn này để trả lời khách</i>`
                : `💬 <b>${esc(guestName || 'Khách')}</b> [<code>${sessionId.slice(-6)}</code>]:\n${esc(message)}\n\n<i>↩️ Reply để trả lời</i>`;

            await tgSend(text);
            return jsonRes({ ok: true });
        }

        // ── POST /order
        if (url.pathname === '/order' && method === 'POST') {
            let data; try { data = await request.json(); } catch { return errRes('Invalid JSON'); }
            const { name, phone, email, address, city, items, total, deposit, payment, note } = data;
            let itemsText = Array.isArray(items) ? items.map(i => `• ${esc(i.name)} x${i.qty}: <code>${esc(i.price)}</code>`).join('\n') : '';
            const text = `🛒 <b>ĐƠN HÀNG MỚI — CYBERTEK</b>\n━━━━━━━━━━━━━━━━━━━━\n👤 <b>Khách hàng:</b> ${esc(name)}\n📱 <b>SĐT:</b> <code>${esc(phone)}</code>\n📧 <b>Email:</b> ${esc(email || 'Không có')}\n📍 <b>Địa chỉ:</b> ${esc(address)}, ${esc(city)}\n━━━━━━━━━━━━━━━━━━━━\n📦 <b>Sản phẩm:</b>\n${itemsText}\n━━━━━━━━━━━━━━━━━━━━\n💰 <b>Tổng cộng:</b> <code>${esc(total)}</code>\n💳 <b>Cọc tối thiểu:</b> <code>${esc(deposit)}</code>\n🔑 <b>Thanh toán:</b> ${esc(payment === 'bank' ? 'Chuyển khoản (Cọc 50%)' : 'Thanh toán toàn bộ')}\n📝 <b>Ghi chú:</b> ${esc(note || 'Không có')}`;
            await tgSend(text);
            return jsonRes({ ok: true });
        }

        // ── GET /poll
        if (url.pathname === '/poll' && method === 'GET') {
            const sid = url.searchParams.get('session');
            if (!sid) return jsonRes({ ok: true, messages: [] });

            const session = await getSession(sid);
            if (!session) return jsonRes({ ok: true, messages: [] });

            // Trả về toàn bộ lịch sử để khách hàng không bị mất chat khi refresh
            return jsonRes({ ok: true, messages: session.messages.map(m => ({ role: m.role, text: m.text, time: m.time })) });
        }

        // ── GET /debug_session
        if (url.pathname === '/debug_session' && method === 'GET') {
            const sid = url.searchParams.get('session');
            const session = await getSession(sid);
            return jsonRes({ ok: true, session });
        }

        // ── POST /telegram-webhook
        if (url.pathname === '/telegram-webhook' && method === 'POST') {
            let update; try { update = await request.json(); } catch { return new Response('ok'); }
            if (update.message) {
                const msg = update.message;
                const fromId = String(msg.from?.id || '');
                const ownerText = (msg.text || '').trim();

                // Only process replies from the correct user, and it has to be a reply_to_message
                if (fromId === String(CHAT_ID) && msg.reply_to_message) {
                    const originalHTML = msg.reply_to_message.text || '';
                    let targetSession = null;
                    const fullMatch = originalHTML.match(/Session: ([a-zA-Z0-9_-]+)/);
                    if (fullMatch) {
                        targetSession = fullMatch[1];
                    } else if (originalHTML.match(/\[([a-zA-Z0-9]{6})\]/)) {
                        // Support for shorter session IDs in replies
                        const shortMatch = originalHTML.match(/\[([a-zA-Z0-9]{6})\]/);
                        if (shortMatch && env.CHAT_SESSIONS) {
                            const keys = await env.CHAT_SESSIONS.list();
                            for (let key of keys.keys) {
                                if (key.name.endsWith(shortMatch[1])) {
                                    targetSession = key.name;
                                    break;
                                }
                            }
                        }
                    }

                    if (targetSession) {
                        const session = await getSession(targetSession);
                        if (session) {
                            session.messages.push({ role: 'owner', text: ownerText, time: Date.now(), delivered: false });
                            await saveSession(targetSession, session);
                            await tgSend(`✅ Đã gửi phản hồi tới khách hàng thành công!`);
                        } else {
                            // If no KV is configured, memSessions is reset
                            await tgSend(`⚠️ Thất bại: Không tìm thấy phiên bản lưu trữ cho khách hàng. Vui lòng thiết lập Cloudflare KV!`);
                        }
                    } else {
                        await tgSend(`⚠️ Không tìm thấy Session ID. Hãy chắc chắn bạn reply vào ĐÚNG tin nhắn đầu tiên của khách có hiển thị chuỗi bắt đầu bằng sess_...`);
                    }
                }
            }
            return new Response('ok');
        }

        // ── GET /set-webhook
        if (url.pathname === '/set-webhook') {
            const webhookUrl = `${url.origin}/telegram-webhook`;
            const resp = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: webhookUrl })
            });
            return jsonRes(await resp.json());
        }

        return new Response('CYBERTEK Bot Worker ✅ Running w/ KV Support', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
};

async function tgSend(text) {
    return fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: 'HTML' })
    });
}
function esc(str) { return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function jsonRes(d) { return new Response(JSON.stringify(d), { headers: { 'Content-Type': 'application/json', ...CORS } }); }
function errRes(m, s = 400) { return new Response(JSON.stringify({ ok: false, error: m }), { status: s, headers: { 'Content-Type': 'application/json', ...CORS } }); }

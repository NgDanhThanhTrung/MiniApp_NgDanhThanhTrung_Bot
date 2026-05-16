/**
 * SIÊU CẤP KIẾM XU - TMA
 * Monolith Server Engine (Bot Control, RAM Storage, API Hosting & Anti-Sleep)
 * Năm vận hành: 2026
 */

const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const XLSX = require('xlsx');
const path = require('path');

// ==========================================
// 1. BẢO MẬT: NẠP BIẾN MÔI TRƯỜNG (ENV)
// ==========================================
// Các thông tin này sẽ được cấu hình trực tiếp trên Dashboard của Render
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = parseInt(process.env.ADMIN_ID, 10);
const MY_APP_LINK = process.env.MY_APP_LINK; // Ví dụ: https://sieu-cap-ki-xu.onrender.com

// Kiểm tra nghiêm ngặt biến môi trường khi khởi động hệ thống
if (!BOT_TOKEN || isNaN(ADMIN_ID) || !MY_APP_LINK) {
    console.error('❌ THIẾU CẤU HÌNH BIẾN MÔI TRƯỜNG (ENV)! Thao tác boot server bị hủy.');
    process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);
const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ==========================================
// 2. ROUTE /HEALTH & CƠ CHẾ TỰ ĐỘNG PING CHỐNG NGỦ
// ==========================================
// Thêm route /health để các hệ thống ping (hoặc chính nó) kiểm tra trạng thái
app.get('/health', (req, res) => {
    res.status(200).json({
        status: "OK",
        uptime: process.uptime(),
        ram_usage: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)} MB`,
        timestamp: new Date().toISOString()
    });
});

// Hàm tự động Ping chính nó sau mỗi 10 phút (600000 ms) để lách luật ngủ đông của Render
function startSelfPingMechanism() {
    setInterval(async () => {
        try {
            const healthUrl = `${MY_APP_LINK}/health`;
            const response = await fetch(healthUrl);
            if (response.ok) {
                console.log(`[Keep-Alive] Ping thành công tới /health lúc: ${new Date().toLocaleTimeString()}`);
            }
        } catch (e) {
            console.error('[Keep-Alive] Lỗi tự gọi Ping:', e.message);
        }
    }, 10 * 60 * 1000); 
}

// ==========================================
// 3. IN-MEMORY DATABASE (QUẢN LÝ TRÊN RAM)
// ==========================================
let userDatabase = new Map();
const BACKUP_INTERVAL = 5 * 60 * 1000; // Tự động gửi bản lưu ngầm sau mỗi 5 phút

function verifyTelegramWebAppData(initDataString) {
    try {
        const urlParams = new URLSearchParams(initDataString);
        const hash = urlParams.get('hash');
        urlParams.delete('hash');
        const sortedParams = Array.from(urlParams.entries()).map(([key, value]) => `${key}=${value}`).sort().join('\n');
        const secretKey = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
        const calculatedHash = crypto.createHmac('sha256', secretKey).update(sortedParams).digest('hex');
        if (calculatedHash === hash) {
            return JSON.parse(urlParams.get('user'));
        }
        return null;
    } catch (e) {
        return null;
    }
}

function syncUserInMemory(userId, userData) {
    if (!userDatabase.has(userId)) {
        userDatabase.set(userId, {
            id: userId,
            username: userData.username || '',
            first_name: userData.first_name || 'Người chơi',
            coins: 12000, 
            spinsLeft: 3,
            lastSpinTimestamp: 0,
            lastAdsTimestamp: 0,
            dailySpinsCount: 0,
            dailyAdsCount: 0,
            lastActiveDate: new Date().toISOString().split('T')[0]
        });
    }
    return userDatabase.get(userId);
}

// ==========================================
// 4. ĐỊNH TUYẾN WEB API (KẾT NỐI FRONTEND)
// ==========================================
app.post('/api/user-data', (req, res) => {
    const { initData } = req.body;
    const tgUser = verifyTelegramWebAppData(initData);
    if (!tgUser) return res.status(403).json({ error: "Xác thực thất bại!" });
    
    const user = syncUserInMemory(tgUser.id, tgUser);
    res.json(user);
});

app.post('/api/update-assets', async (req, res) => {
    const { initData, action, rewardCoins, withdrawMethod, withdrawAddress, withdrawAmount } = req.body;
    const tgUser = verifyTelegramWebAppData(initData);
    if (!tgUser) return res.status(403).json({ error: "Xác thực thất bại!" });

    const user = userDatabase.get(tgUser.id);
    if (!user) return res.status(404).json({ error: "User không tồn tại!" });

    const now = Date.now();

    if (action === 'spin_start') {
        user.spinsLeft -= 1;
        user.dailySpinsCount += 1;
        user.lastSpinTimestamp = now;
    } else if (action === 'spin_reward') {
        user.coins += parseInt(rewardCoins || 0);
    } else if (action === 'watch_ads_success') {
        user.coins += 12000;
        user.spinsLeft += 1;
        user.dailyAdsCount += 1;
        user.lastAdsTimestamp = now;
    } else if (action === 'withdraw_request') {
        const amount = parseInt(withdrawAmount);
        if (amount > user.coins) return res.status(400).json({ error: "Số dư không đủ!" });
        
        user.coins -= amount;
        
        const reportMsg = `💰 *YÊU CẦU RÚT TIỀN MỚI*\n\n` +
                          `👤 Người rút: [${user.first_name}](tg://user?id=${user.id})\n` +
                          `🆔 ID: \`${user.id}\`\n` +
                          `💳 Phương thức: *${withdrawMethod.toUpperCase()}*\n` +
                          `📍 Tài khoản nhận: \`${withdrawAddress}\`\n` +
                          `📉 Số tiền rút: -*${amount.toLocaleString()} Xu*`;
        await bot.telegram.sendMessage(ADMIN_ID, reportMsg, { parse_mode: 'Markdown' });
    }
    res.json(user);
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==========================================
// 5. AUTO BACKUP CLOUD MECHANISM
// ==========================================
async function triggerAutoBackup() {
    if (userDatabase.size === 0) return;
    try {
        const userList = Array.from(userDatabase.values());
        const backupRawString = JSON.stringify(userList);
        await bot.telegram.sendMessage(ADMIN_ID, `📦 [AUTO_BACKUP_DATA]\n\`\`\`json\n${backupRawString}\n\`\`\``, { parse_mode: 'MarkdownV2' });
        console.log(`[Backup] Đã tự động sao lưu ${userList.length} tài khoản lên Telegram Cloud.`);
    } catch (e) {
        console.error("Lỗi tự động sao lưu dữ liệu:", e.message);
    }
}

// ==========================================
// 6. CHỨC NĂNG ĐIỀU HÀNH BOT TELEGRAM
// ==========================================
function isAdminMiddleware(ctx, next) {
    if (ctx.from?.id === ADMIN_ID) return next();
    return ctx.reply('❌ Lệnh này chỉ dành riêng cho Ban Quản Trị.');
}

bot.start((ctx) => {
    const user = syncUserInMemory(ctx.from.id, ctx.from);
    const welcomeText = `👋 *Xin chào ${ctx.from.first_name}!*\n\n` +
                        `Chào mừng bạn đến với hệ thống *Siêu Cấp Kiếm Xu*.\n` +
                        `💰 Số dư của bạn: *${user.coins.toLocaleString()} Xu*\n` +
                        `🎡 Lượt quay: *${user.spinsLeft} lượt*\n\n` +
                        `Hãy bấm vào nút dưới đây để vào ứng dụng cày xu ngay! 👇`;

    return ctx.replyWithMarkdown(welcomeText, Markup.inlineKeyboard([
        [Markup.button.webApp('🚀 Mở Ứng Dụng Kiếm Xu', MY_APP_LINK)]
    ]));
});

bot.command('saoluu', isAdminMiddleware, async (ctx) => {
    const userList = Array.from(userDatabase.values());
    if (userList.length === 0) return ctx.reply('⚠️ Hệ thống RAM trống.');

    const rows = userList.map(u => ({
        'ID Telegram': u.id, 'Username': u.username ? `@${u.username}` : 'Không có', 'Tên': u.first_name, 'Số Dư Xu': u.coins, 'Lượt Quay': u.spinsLeft
    }));

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Users');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    await ctx.replyWithDocument(
        { source: buffer, filename: 'DanhSachHoiVien.xlsx' },
        { caption: `📊 Đã xuất danh sách thành công! Tổng số: *${userList.length}* tài khoản trên RAM.` }
    );
});

bot.command('broadcast', isAdminMiddleware, async (ctx) => {
    const msgText = ctx.payload;
    if (!msgText) return ctx.reply('⚠️ Cú pháp đúng: `/broadcast [Nội dung tin nhắn]`');

    const userIds = Array.from(userDatabase.keys());
    ctx.reply(`📣 Đang tiến hành gửi thông báo tới ${userIds.length} người dùng...`);

    let thanhCong = 0;
    for (const id of userIds) {
        try {
            await ctx.telegram.sendMessage(id, `📢 *THÔNG BÁO TỪ HỆ THỐNG*\n\n${msgText}`, { parse_mode: 'Markdown' });
            thanhCong++;
            await new Promise(resolve => setTimeout(resolve, 50));
        } catch (e) {}
    }
    ctx.reply(`✅ Đã gửi tin nhắn hoàn tất! Thành công: ${thanhCong}/${userIds.length}`);
});

bot.on('message', isAdminMiddleware, async (ctx) => {
    if (ctx.message.text && ctx.message.text.includes('[AUTO_BACKUP_DATA]')) {
        try {
            const rawJson = ctx.message.text.split('```json')[1].split('```')[0].trim();
            const userList = JSON.parse(rawJson);
            userList.forEach(u => userDatabase.set(u.id, u));
            return ctx.reply(`🎉 KHÔI PHỤC THẦN TỐC THÀNH CÔNG! Đã nạp lại *${userList.length}* tài khoản vào RAM.`);
        } catch { return ctx.reply('Chuỗi sao lưu lỗi cấu trúc!'); }
    }
    if (ctx.message.document && ctx.message.document.file_name.endsWith('.xlsx')) {
        try {
            const fileLink = await ctx.telegram.getFileLink(ctx.message.document.file_id);
            const res = await fetch(fileLink.href);
            const buf = await res.arrayBuffer();
            const workbook = XLSX.read(new Uint8Array(buf), { type: 'array' });
            const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
            let count = 0;
            rows.forEach(r => {
                const uid = parseInt(r['ID Telegram'] || r['ID Người Dùng']);
                if (uid) {
                    userDatabase.set(uid, { id: uid, username: r['Username'] ? r['Username'].replace('@','') : '', first_name: r['Tên'], coins: parseInt(r['Số Dư Xu']), spinsLeft: parseInt(r['Lượt Quay']), updatedAt: new Date().toISOString() });
                    count++;
                }
            });
            return ctx.reply(`🎉 Khôi phục từ file Excel thành công *${count}* người dùng vào RAM.`);
        } catch { return ctx.reply('Lỗi phân tích file Excel.'); }
    }
});

// ==========================================
// 7. KHỞI CHẠY MÁY CHỦ NGUYÊN KHỐI
// ==========================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`[Web Server] Đang mở cổng hosting tại Port: ${PORT}`);
});

bot.launch().then(() => {
    console.log('🚀 [Bot Telegram] Hệ thống lắng nghe lệnh trực tuyến đã sẵn sàng!');
    setInterval(triggerAutoBackup, BACKUP_INTERVAL); // Kích hoạt backup tự động
    startSelfPingMechanism(); // Kích hoạt tự động gọi lệnh Ping chống ngủ đông cho Render
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

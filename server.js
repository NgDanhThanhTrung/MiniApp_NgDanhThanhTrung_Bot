/**
 * SIÊU CẤP KIẾM XU - TMA
 * Monolith Server Engine (Bot Control, RAM Storage, API Hosting & Anti-Sleep)
 * Năm vận hành: 2026
 * Phiên bản: 5.7.0 - Sửa lỗi nhận diện giải mã sâu ID, Tên và Username
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
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = parseInt(process.env.ADMIN_ID, 10);
const MY_APP_LINK = process.env.MY_APP_LINK; 

if (!BOT_TOKEN || isNaN(ADMIN_ID) || !MY_APP_LINK) {
    console.error('❌ THIẾU CẤU HÌNH BIẾN MÔI TRƯỜNG (ENV)!');
    process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);
const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const SERVER_CONFIG = {
    MAX_DAILY_SPINS: 10,
    MAX_DAILY_ADS: 5,
    SPIN_COOLDOWN_MS: 30 * 1000,
    ADS_COOLDOWN_MS: 60 * 1000,
    MIN_VND_COINS_LIMIT: 2000000 
};

const WHEEL_REWARDS = [
    { text: "1,000 XU",  value: 1000 },
    { text: "5,000 XU",  value: 5000 },
    { text: "MẤT LƯỢT",  value: 0 },
    { text: "10,000 XU", value: 10000 },
    { text: "500 XU",    value: 500 },
    { text: "20,000 XU", value: 20000 },
    { text: "MẤT LƯỢT",  value: 0 },
    { text: "50,000 XU", value: 50000 }
];

// ==========================================
// 2. ROUTE /HEALTH & CƠ CHẾ TỰ ĐỘNG PING
// ==========================================
app.get('/health', (req, res) => {
    res.status(200).json({
        status: "OK",
        uptime: process.uptime(),
        ram_usage: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)} MB`,
        timestamp: new Date().toISOString()
    });
});

function startSelfPingMechanism() {
    setInterval(async () => {
        try {
            const healthUrl = `${MY_APP_LINK}/health`;
            const response = await fetch(healthUrl);
            if (response.ok) {
                console.log(`[Keep-Alive] Ping thành công tới /health`);
            }
        } catch (e) {
            console.error('[Keep-Alive] Lỗi tự gọi Ping:', e.message);
        }
    }, 10 * 60 * 1000);
}

// ==========================================
// 3. IN-MEMORY DATABASE & BỘ GIẢI MÃ SÂU (FIX LỖI NHẬN DIỆN)
// ==========================================
let userDatabase = new Map();
const BACKUP_INTERVAL = 5 * 60 * 1000;

// [SỬA LỖI KIỂM CHỨNG]: Tự động xử lý giải mã URL-encoded nâng cao trước khi trích xuất thông tin
function verifyTelegramWebAppData(initDataString) {
    try {
        if (!initDataString) return null;

        // Xử lý giải mã chuỗi thô phòng trường hợp ký tự đặc biệt bị biến đổi qua môi trường Internet của Render
        const decodedData = decodeURIComponent(initDataString);
        const urlParams = new URLSearchParams(decodedData);
        const hash = urlParams.get('hash');
        urlParams.delete('hash');

        const sortedParams = Array.from(urlParams.entries())
            .map(([key, value]) => `${key}=${value}`)
            .sort()
            .join('\n');

        const secretKey = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
        const calculatedHash = crypto.createHmac('sha256', secretKey).update(sortedParams).digest('hex');

        if (calculatedHash === hash) {
            return JSON.parse(urlParams.get('user'));
        }
        return null;
    } catch (e) {
        console.error("[Auth Error] Lỗi phân tích cú pháp initData:", e.message);
        return null;
    }
}

function syncUserInMemory(userId, userData) {
    const todayStr = new Date().toISOString().split('T')[0];
    const uid = parseInt(userId, 10);
    
    if (!userDatabase.has(uid)) {
        userDatabase.set(uid, {
            id: uid,
            username: userData.username || '',
            first_name: userData.first_name || 'Hội viên', // Đồng bộ ngôn từ chuyên nghiệp mới
            coins: 50000, 
            spinsLeft: 3,  
            lastSpinTimestamp: 0,
            lastAdsTimestamp: 0,
            dailySpinsCount: 0,
            dailyAdsCount: 0,
            lastActiveDate: todayStr,
            botAppLink: `https://t.me/${bot.botInfo?.username || 'SieuCapCayXu_NDTTrung_Bot'}/app`
        });
    } else {
        const existing = userDatabase.get(uid);
        if (userData.username) existing.username = userData.username;
        if (userData.first_name) existing.first_name = userData.first_name;
        existing.botAppLink = `https://t.me/${bot.botInfo?.username || 'SieuCapCayXu_NDTTrung_Bot'}/app`;
        
        if (existing.lastActiveDate !== todayStr) {
            existing.dailySpinsCount = 0;
            existing.dailyAdsCount = 0;
            existing.spinsLeft = Math.max(existing.spinsLeft, 3);
            existing.lastActiveDate = todayStr;
        }
    }
    return userDatabase.get(uid);
}

// ==========================================
// 4. ĐỊNH TUYẾN WEB API (KẾT NỐI FRONTEND)
// ==========================================

app.post('/api/user-data', (req, res) => {
    const { initData } = req.body;
    const tgUser = verifyTelegramWebAppData(initData);
    
    if (!tgUser) {
        return res.status(403).json({ error: "Xác thực danh tính lớp bảo mật Telegram thất bại!" });
    }

    const user = syncUserInMemory(tgUser.id, tgUser);
    res.json(user);
});

app.post('/api/user/profile', (req, res) => {
    const { telegramId, username, firstName } = req.body;
    if (!telegramId) return res.status(400).json({ error: "Thiếu thông tin định danh!" });
    
    const user = syncUserInMemory(parseInt(telegramId, 10), { username, first_name: firstName });
    res.json(user);
});

app.post('/api/user/spin', (req, res) => {
    const { telegramId } = req.body;
    const uid = parseInt(telegramId, 10);
    const user = userDatabase.get(uid);

    if (!user) return res.status(404).json({ error: "Không tìm thấy thông tin tài khoản trên RAM!" });
    if (user.spinsLeft <= 0) return res.status(400).json({ error: "Bạn đã hết lượt quay khả dụng!" });
    if (user.dailySpinsCount >= SERVER_CONFIG.MAX_DAILY_SPINS) return res.status(400).json({ error: "Đã đạt giới hạn số lần quay hôm nay!" });
    
    const now = Date.now();
    if (now - user.lastSpinTimestamp < SERVER_CONFIG.SPIN_COOLDOWN_MS) {
        return res.status(400).json({ error: "Vòng quay đang trong thời gian hồi chiêu!" });
    }

    const rewardIndex = Math.floor(Math.random() * 8);
    const prize = WHEEL_REWARDS[rewardIndex];

    user.spinsLeft -= 1;
    user.dailySpinsCount += 1;
    user.lastSpinTimestamp = now;
    user.coins += prize.value;

    res.json({ rewardIndex: rewardIndex, user: user });
});

app.post('/api/update-assets', async (req, res) => {
    const { initData, action, withdrawMethod, withdrawAddress, withdrawAmount } = req.body;
    const tgUser = verifyTelegramWebAppData(initData);
    if (!tgUser) return res.status(403).json({ error: "Xác thực bảo mật Telegram thất bại!" });

    const user = userDatabase.get(tgUser.id);
    if (!user) return res.status(404).json({ error: "Tài khoản không tồn tại trên hệ thống RAM!" });

    const now = Date.now();

    switch (action) {
        case 'spin_start': 
            if (user.spinsLeft <= 0) return res.status(400).json({ error: "Hết lượt quay!" });
            user.spinsLeft -= 1;
            user.dailySpinsCount += 1;
            user.lastSpinTimestamp = now;
            break;

        case 'watch_ads_success':
            if (user.dailyAdsCount >= SERVER_CONFIG.MAX_DAILY_ADS) {
                return res.status(400).json({ error: "Đã hết hạn mức xem Ads hôm nay!" });
            }
            if (now - user.lastAdsTimestamp < SERVER_CONFIG.ADS_COOLDOWN_MS) {
                return res.status(400).json({ error: "Quảng cáo đang trong thời gian hồi!" });
            }
            user.coins += 12000;
            user.spinsLeft += 1;
            user.dailyAdsCount += 1;
            user.lastAdsTimestamp = now;
            break;

        case 'withdraw_request':
            const amount = parseInt(withdrawAmount, 10);
            if (isNaN(amount) || amount <= 0) return res.status(400).json({ error: "Số xu rút không hợp lệ!" });
            if (amount > user.coins) return res.status(400).json({ error: "Số dư ví khả dụng không đủ!" });

            if ((withdrawMethod === 'momo' || withdrawMethod === 'bank') && amount < SERVER_CONFIG.MIN_VND_COINS_LIMIT) {
                return res.status(400).json({ error: "Lệnh bị hủy do dưới hạn mức tối thiểu 2,000,000 Xu!" });
            }

            user.coins -= amount;

            const reportMsg = `💰 *YÊU CẦU RÚT TIỀN MỚI* 💰\n\n` +
                              `👤 Khách hàng: [${user.first_name}](tg://user?id=${user.id})\n` +
                              `🆔 ID Tài khoản: \`${user.id}\`\n` +
                              `💳 Phương thức: *${withdrawMethod.toUpperCase()}*\n` +
                              `📍 Địa chỉ nhận / STK: \`${withdrawAddress}\`\n` +
                              `📉 Số xu cấu trúc trừ: -*${amount.toLocaleString()} Xu*\n` +
                              `⏱️ Thời gian: ${new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}` +
                              `\n\n*(Lưu ý: Đối với TON Network, Admin duyệt và thanh toán dựa trên tỷ giá thực tế)*`;

            try {
                await bot.telegram.sendMessage(ADMIN_ID, reportMsg, { parse_mode: 'Markdown' });
            } catch (err) {
                console.error("Lỗi gửi tin nhắn báo cáo rút tiền tới Admin:", err.message);
            }
            break;

        default:
            return res.status(400).json({ error: "Hành động cấu hình không hợp lệ!" });
    }

    res.json(user);
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==========================================
// 5. AUTO BACKUP MECHANISM
// ==========================================
async function triggerAutoBackup() {
    if (userDatabase.size === 0) return;
    try {
        const userList = Array.from(userDatabase.values());
        const backupRawString = JSON.stringify(userList);
        await bot.telegram.sendMessage(ADMIN_ID, `📦 [AUTO_BACKUP_DATA]\n\`\`\`json\n${backupRawString}\n\`\`\``);
    } catch (e) {
        console.error("Lỗi sao lưu tự động:", e.message);
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
    const welcomeText = `✨ *Chào mừng Thượng khách ${ctx.from.first_name} đến với Siêu Cấp Kiếm Xu!* ✨\n\n` +
                        `Hệ thống TMA đã thiết lập không gian khai thác tài sản kỹ thuật số an toàn trên bộ nhớ RAM Server. Thông tin tài khoản hiện tại của bạn:\n\n` +
                        `💳 *Ví Tài Sản:* \`${user.coins.toLocaleString()}\` *Xu*\n` +
                        `🎡 *Cơ Hội May Mắn:* \`${user.spinsLeft}\` *Lượt quay khả dụng*\n\n` +
                        `Hãy kích hoạt nút khởi động bên dưới để truy cập vào giao diện Mini App, hoàn thành các nhiệm vụ đối tác Adsgram và tối ưu hóa dòng tiền thu nhập thụ động ngay lập tức! 👇`;

    return ctx.replyWithMarkdown(welcomeText, Markup.inlineKeyboard([
        [Markup.button.webApp('🚀 KHỔI ĐỘNG ỨNG DỤNG NGAY', MY_APP_LINK)]
    ]));
});

bot.command('saoluu', isAdminMiddleware, async (ctx) => {
    const userList = Array.from(userDatabase.values());
    if (userList.length === 0) return ctx.reply('⚠️ Hệ thống RAM trống.');

    const rows = userList.map(u => ({
        'ID Telegram': u.id, 
        'Username': u.username ? `@${u.username}` : 'Không có', 
        'Tên': u.first_name, 
        'Số Dư Xu': u.coins, 
        'Lượt Quay Còn Lại': u.spinsLeft
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
            await new Promise(resolve => setTimeout(resolve, 35));
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
                const uid = parseInt(r['ID Telegram'] || r['ID Người Dùng'], 10);
                if (uid) {
                    userDatabase.set(uid, { 
                        id: uid, 
                        username: r['Username'] ? r['Username'].replace('@','') : '', 
                        first_name: r['Tên'] || 'Người chơi', 
                        coins: parseInt(r['Số Dư Xu']) || 0, 
                        spinsLeft: parseInt(r['Lượt Quay Còn Lại'] || r['Lượt Quay'], 10) || 3, 
                        lastSpinTimestamp: 0,
                        lastAdsTimestamp: 0,
                        dailySpinsCount: 0,
                        dailyAdsCount: 0,
                        lastActiveDate: new Date().toISOString().split('T')[0]
                    });
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
app.listen(PORT, () => console.log(`[Web Server] Khởi chạy mượt mà tại cổng mạng: ${PORT}`));

bot.launch().then(() => {
    setInterval(triggerAutoBackup, BACKUP_INTERVAL);
    startSelfPingMechanism();
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

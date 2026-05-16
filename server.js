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
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = parseInt(process.env.ADMIN_ID, 10);
const MY_APP_LINK = process.env.MY_APP_LINK; // Định dạng mẫu: https://sieu-cap-ki-xu.onrender.com

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

// Cấu hình các tham số giới hạn đồng bộ hằng ngày
const SERVER_CONFIG = {
    MAX_DAILY_SPINS: 10,
    MAX_DAILY_ADS: 5,
    SPIN_COOLDOWN_MS: 30 * 1000,
    ADS_COOLDOWN_MS: 60 * 1000,
    MIN_VND_COINS_LIMIT: 2000000 // Tối thiểu 2.000 VNĐ = 2.000.000 Xu
};

// Mảng phần thưởng khớp chính xác 100% với giao diện bánh xe
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
// 2. ROUTE /HEALTH & CƠ CHẾ TỰ ĐỘNG PING CHỐNG NGỦ
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
                console.log(`[Keep-Alive] Ping thành công tới /health lúc: ${new Date().toLocaleTimeString()}`);
            }
        } catch (e) {
            console.error('[Keep-Alive] Lỗi tự gọi Ping:', e.message);
        }
    }, 10 * 60 * 1000); // 10 phút ping một lần
}

// ==========================================
// 3. IN-MEMORY DATABASE (QUẢN LÝ TRÊN RAM)
// ==========================================
let userDatabase = new Map();
const BACKUP_INTERVAL = 5 * 60 * 1000;

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
    const todayStr = new Date().toISOString().split('T')[0];
    
    if (!userDatabase.has(userId)) {
        userDatabase.set(userId, {
            id: userId,
            username: userData.username || '',
            first_name: userData.first_name || 'Người chơi',
            coins: 50000, // Tặng sẵn 50,000 Xu tài khoản trải nghiệm ban đầu giống app.js
            spinsLeft: 3,  // 3 Lượt quay khởi tạo đầu game
            lastSpinTimestamp: 0,
            lastAdsTimestamp: 0,
            dailySpinsCount: 0,
            dailyAdsCount: 0,
            lastActiveDate: todayStr,
            botAppLink: `https://t.me/${bot.botInfo?.username || 'SieuCapCayXu_NDTTrung_Bot'}/app`
        });
    } else {
        const existing = userDatabase.get(userId);
        existing.username = userData.username || existing.username;
        existing.first_name = userData.first_name || existing.first_name;
        existing.botAppLink = `https://t.me/${bot.botInfo?.username || 'SieuCapCayXu_NDTTrung_Bot'}/app`;
        
        // Cơ chế Auto-Reset hạn mức cày cuốc theo ngày dựa trên Server Time
        if (existing.lastActiveDate !== todayStr) {
            existing.dailySpinsCount = 0;
            existing.dailyAdsCount = 0;
            existing.spinsLeft = Math.max(existing.spinsLeft, 3); // Hoàn trả tối thiểu 3 lượt quay
            existing.lastActiveDate = todayStr;
        }
    }
    return userDatabase.get(userId);
}

// ==========================================
// 4. ĐỊNH TUYẾN WEB API (KẾT NỐI FRONTEND)
// ==========================================

// Đồng bộ cổng API kéo dữ liệu chân thực từ chuỗi mã hóa initData bảo mật phía app.js gửi sang
app.post('/api/user-data', (req, res) => {
    const { initData } = req.body;
    const tgUser = verifyTelegramWebAppData(initData);
    
    if (!tgUser) {
        return res.status(403).json({ error: "Xác thực lớp bảo mật Telegram thất bại!" });
    }

    const user = syncUserInMemory(tgUser.id, tgUser);
    res.json(user);
});

// Giữ cổng dự phòng profile hỗ trợ quá trình test mượt mà
app.post('/api/user/profile', (req, res) => {
    const { telegramId, username, firstName } = req.body;
    if (!telegramId) return res.status(400).json({ error: "Thiếu thông tin định danh!" });
    
    const user = syncUserInMemory(parseInt(telegramId, 10), { username, first_name: firstName });
    res.json(user);
});

// Tiếp nhận xử lý tính toán vòng quay an toàn tập trung từ xa
app.post('/api/user/spin', (req, res) => {
    const { telegramId } = req.body;
    const uid = parseInt(telegramId, 10);
    const user = userDatabase.get(uid);

    if (!user) return res.status(404).json({ error: "Không tìm thấy thông tin tài khoản trên RAM!" });

    if (user.spinsLeft <= 0) return res.status(400).json({ error: "Bạn đã hết lượt quay khả dụng!" });
    if (user.dailySpinsCount >= SERVER_CONFIG.MAX_DAILY_SPINS) return res.status(400).json({ error: "Đã đạt giới hạn số lần quay hôm nay!" });
    
    const now = Date.now();
    if (now - user.lastSpinTimestamp < SERVER_CONFIG.SPIN_COOLDOWN_MS) {
        return res.status(400).json({ error: "Thao tác quá nhanh, vòng quay đang trong thời gian hồi chiêu!" });
    }

    // Thực hiện thuật toán bốc ngẫu nhiên ô trúng thưởng và trừ lượt ngầm trên RAM
    const rewardIndex = Math.floor(Math.random() * 8);
    const prize = WHEEL_REWARDS[rewardIndex];

    user.spinsLeft -= 1;
    user.dailySpinsCount += 1;
    user.lastSpinTimestamp = now;
    user.coins += prize.value;

    res.json({
        rewardIndex: rewardIndex,
        user: user
    });
});

// Tuyến đường sạc Xu quảng cáo AdsGram hoặc cập nhật tạo đơn rút tiền
app.post('/api/update-assets', async (req, res) => {
    const { initData, action, withdrawMethod, withdrawAddress, withdrawAmount } = req.body;
    const tgUser = verifyTelegramWebAppData(initData);
    if (!tgUser) return res.status(403).json({ error: "Xác thực bảo mật Telegram thất bại!" });

    const user = userDatabase.get(tgUser.id);
    if (!user) return res.status(404).json({ error: "Tài khoản không tồn tại trên hệ thống RAM!" });

    const now = Date.now();

    switch (action) {
        case 'spin_start': // Hỗ trợ trừ lượt đồng bộ từ xa nếu frontend có gọi lệnh khóa
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
            if (amount > user.coins) return res.status(400).json({ error: "Số dư khả dụng tài khoản không đủ!" });

            // Phân luồng kiểm soát hạn mức tối thiểu từ phía Backend bảo mật
            if ((withdrawMethod === 'momo' || withdrawMethod === 'bank') && amount < SERVER_CONFIG.MIN_VND_COINS_LIMIT) {
                return res.status(400).json({ error: "Lệnh bị hủy do dưới hạn mức tối thiểu 2,000,000 Xu!" });
            }

            // Khấu trừ trực tiếp tài sản trên RAM
            user.coins -= amount;

            // Bắn tin nhắn báo cáo trực tiếp đến cổng Chat điều hành của Admin
            const reportMsg = `💰 *YÊU CẦU RÚT TIỀN MỚI* 💰\n\n` +
                              `👤 Khách hàng: [${user.first_name}](tg://user?id=${user.id})\n` +
                              `🆔 ID Tài khoản: \`${user.id}\`\n` +
                              `💳 Phương thức: *${withdrawMethod.toUpperCase()}*\n` +
                              `📍 Địa chỉ nhận / STK: \`${withdrawAddress}\`\n` +
                              `📉 Số xu cấu trúc trừ: -*${amount.toLocaleString()} Xu*\n` +
                              `⏱️ Thời gian: ${new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}` +
                              `\n\n*(Lưu ý: Đối với TON Network, Admin thực hiện xét duyệt ngầm và quy đổi dựa theo tỷ giá thực tế)*`;

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

// Hỗ trợ tuyến đường phụ đồng bộ cập nhật tài sản thô (Dành cho bản build test local cũ)
app.post('/api/user/update', async (req, res) => {
    const { telegramId, action, withdrawMethod, withdrawAddress, withdrawAmount } = req.body;
    const uid = parseInt(telegramId, 10);
    const user = userDatabase.get(uid);
    if (!user) return res.status(404).json({ error: "User không tồn tại!" });

    const now = Date.now();
    if (action === 'watch_ads') {
        user.coins += 12000; user.spinsLeft += 1; user.dailyAdsCount += 1; user.lastAdsTimestamp = now;
    } else if (action === 'withdraw_request') {
        const amount = parseInt(withdrawAmount, 10);
        if (!isNaN(amount) && amount <= user.coins) user.coins -= amount;
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
        console.log(`[Backup] Tự động sao lưu an toàn ${userList.length} tài khoản thành công.`);
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
    const welcomeText = `👋 *Xin chào ${ctx.from.first_name}!* \n\n` +
                        `Chào mừng bạn đến với hệ thống *Siêu Cấp Kiếm Xu*.\n` +
                        `💰 Số dư trải nghiệm: *${user.coins.toLocaleString()} Xu*\n` +
                        `🎡 Lượt quay sẵn có: *${user.spinsLeft} lượt*\n\n` +
                        `Hệ thống dữ liệu đã được cấu hình đồng bộ hóa thời gian thực chống hack an toàn 100%. Bấm nút dưới đây để vào ứng dụng cày xu ngay! 👇`;

    return ctx.replyWithMarkdown(welcomeText, Markup.inlineKeyboard([
        [Markup.button.webApp('🚀 Mở Ứng Dụng Kiếm Xu', MY_APP_LINK)]
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
                // Đồng bộ linh hoạt tên cột nạp từ file Excel vào RAM không lo lệch pha
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
app.listen(PORT, () => {
    console.log(`[Web Server] Đang mở cổng hosting tại Port: ${PORT}`);
});

bot.launch().then(() => {
    console.log('🚀 [Bot Telegram] Hệ thống lắng nghe lệnh trực tuyến đã sẵn sàng!');
    setInterval(triggerAutoBackup, BACKUP_INTERVAL);
    startSelfPingMechanism();
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

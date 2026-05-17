/**
 * SIÊU CẤP KIẾM XU - TMA
 * Monolith Server Engine (Bot Control, RAM Storage, API Hosting & Anti-Sleep)
 * Năm vận hành: 2026
 * Phiên bản: 2.3.0 (Cập nhật 8 ô phần thưởng thuần xu & Vá lệnh /saoluu)
 */

const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = parseInt(process.env.ADMIN_ID, 10);
const MY_APP_LINK = process.env.MY_APP_LINK; 

if (!BOT_TOKEN || isNaN(ADMIN_ID) || !MY_APP_LINK) {
    console.error('❌ THIẾU CẤU HÌNH BIẾN MÔI TRƯỜNG (ENV)! Thao tác boot server bị hủy.');
    process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);
const app = express();

bot.catch((err, ctx) => {
    console.error(`[Telegraf Core Error] Đã chặn lỗi rớt cổng mạng từ Update ${ctx.update.update_id}:`, err.message);
});

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

// 🌟 CẬP NHẬT: Mảng phần thưởng khớp chuẩn 100% với Frontend và RAM xử lý tài sản
const WHEEL_REWARDS = [
    { text: "1,000 XU",  value: 1000 },
    { text: "5,000 XU",  value: 5000 },
    { text: "200 XU",    value: 200 },
    { text: "10,000 XU", value: 10000 },
    { text: "500 XU",    value: 500 },
    { text: "2,000 XU",  value: 2000 },
    { text: "20,000 XU", value: 20000 },
    { text: "50,000 XU", value: 50000 }
];

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
    }, 5 * 60 * 1000); 
}

let userDatabase = new Map();
const BACKUP_INTERVAL = 5 * 60 * 1000; 
const EXCEL_FILE_PATH = path.join(__dirname, 'DanhSachHoiVien_Backup.xlsx');

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
        const existing = userDatabase.get(userId);
        existing.username = userData.username || existing.username;
        existing.first_name = userData.first_name || existing.first_name;
        existing.botAppLink = `https://t.me/${bot.botInfo?.username || 'SieuCapCayXu_NDTTrung_Bot'}/app`;
        
        if (existing.lastActiveDate !== todayStr) {
            existing.dailySpinsCount = 0;
            existing.dailyAdsCount = 0;
            existing.spinsLeft = Math.max(existing.spinsLeft, 3); 
            existing.lastActiveDate = todayStr;
        }
    }
    return userDatabase.get(userId);
}

// TỰ ĐỘNG KHÔI PHỤC KHI REBOOT
if (fs.existsSync(EXCEL_FILE_PATH)) {
    try {
        const workbook = XLSX.readFile(EXCEL_FILE_PATH);
        const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
        rows.forEach(r => {
            const uid = parseInt(r['ID Telegram'] || r['ID Người Dùng'], 10);
            if (uid) {
                userDatabase.set(uid, { 
                    id: uid, 
                    username: r['Username'] ? String(r['Username']).replace('@','') : '', 
                    first_name: r['Tên'] || 'Người chơi', 
                    coins: parseInt(r['Số Dư Xu']) || 0, 
                    spinsLeft: parseInt(r['Lượt Quay'] || r['Lượt Quay Còn Lại'], 10) || 3, 
                    lastSpinTimestamp: parseInt(r['lastSpinTimestamp']) || 0,
                    lastAdsTimestamp: parseInt(r['lastAdsTimestamp']) || 0,
                    dailySpinsCount: parseInt(r['dailySpinsCount']) || 0,
                    dailyAdsCount: parseInt(r['dailyAdsCount']) || 0,
                    lastActiveDate: r['lastActiveDate'] || new Date().toISOString().split('T')[0]
                });
            }
        });
    } catch (err) {}
}

app.post('/api/user-data', (req, res) => {
    const { initData } = req.body;
    const tgUser = verifyTelegramWebAppData(initData);
    if (!tgUser) return res.status(403).json({ error: "Xác thực thất bại!" });
    const user = syncUserInMemory(tgUser.id, tgUser);
    res.json(user);
});

app.post('/api/user/spin', (req, res) => {
    const { telegramId } = req.body;
    const uid = parseInt(telegramId, 10);
    const user = userDatabase.get(uid);

    if (!user) return res.status(404).json({ error: "RAM lỗi khoản!" });
    if (user.spinsLeft <= 0) return res.status(400).json({ error: "Hết lượt!" });
    
    const now = Date.now();
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
    if (!tgUser) return res.status(403).json({ error: "Xác thực lỗi!" });

    const user = userDatabase.get(tgUser.id);
    if (!user) return res.status(404).json({ error: "RAM trống!" });

    const now = Date.now();

    switch (action) {
        case 'spin_start':
            if (user.spinsLeft <= 0) return res.status(400).json({ error: "Hết lượt!" });
            user.spinsLeft -= 1;
            user.dailySpinsCount += 1;
            user.lastSpinTimestamp = now;
            break;

        case 'watch_ads_success':
            user.coins += 12000;
            user.spinsLeft += 1;
            user.dailyAdsCount += 1;
            user.lastAdsTimestamp = now;
            break;

        case 'withdraw_request':
            const amount = parseInt(withdrawAmount, 10);
            if (isNaN(amount) || amount <= 0 || amount > user.coins) return res.status(400).json({ error: "Dữ liệu ví không đủ!" });

            if ((withdrawMethod === 'momo' || withdrawMethod === 'bank') && amount < SERVER_CONFIG.MIN_VND_COINS_LIMIT) {
                return res.status(400).json({ error: "Chưa đạt mức tối thiểu 2M Xu!" });
            }

            user.coins -= amount;

            const reportMsg = `💰 *YÊU CẦU RÚT TIỀN MỚI* 💰\n\n` +
                              `👤 Khách: [${user.first_name}](tg://user?id=${user.id})\n` +
                              `💳 Ví: *${withdrawMethod.toUpperCase()}*\n` +
                              `📍 STK: \`${withdrawAddress}\`\n` +
                              `📉 Trừ: -*${amount.toLocaleString()} Xu*`;

            try {
                await bot.telegram.sendMessage(ADMIN_ID, reportMsg, { parse_mode: 'Markdown' });
            } catch (err) {
                user.coins += amount;
                return res.status(500).json({ error: "Lỗi báo cáo!" });
            }
            break;
    }
    res.json(user);
});

async function triggerAutoBackup() {
    if (userDatabase.size === 0) return;
    try {
        const userList = Array.from(userDatabase.values());
        const rows = userList.map(u => ({
            'ID Telegram': u.id, 'Username': u.username, 'Tên': u.first_name, 'Số Dư Xu': u.coins, 'Lượt Quay': u.spinsLeft,
            'lastSpinTimestamp': u.lastSpinTimestamp, 'lastAdsTimestamp': u.lastAdsTimestamp, 'dailySpinsCount': u.dailySpinsCount, 'dailyAdsCount': u.dailyAdsCount, 'lastActiveDate': u.lastActiveDate
        }));
        const worksheet = XLSX.utils.json_to_sheet(rows);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Users');
        XLSX.writeFile(workbook, EXCEL_FILE_PATH);

        const backupRawString = JSON.stringify(userList);
        await bot.telegram.sendMessage(ADMIN_ID, `📦 [AUTO_BACKUP_DATA]\n\`\`\`json\n${backupRawString}\n\`\`\``, { parse_mode: 'MarkdownV2' });
    } catch (e) {}
}

function isAdminMiddleware(ctx, next) {
    if (ctx.from?.id === ADMIN_ID) return next();
}

bot.start((ctx) => {
    const user = syncUserInMemory(ctx.from.id, ctx.from);
    return ctx.replyWithMarkdown(`👋 *Xin chào ${ctx.from.first_name}!* \n\nSố dư: *${user.coins.toLocaleString()} Xu*`, Markup.inlineKeyboard([
        [Markup.button.webApp('🚀 Mở Ứng Dụng Kiếm Xu', MY_APP_LINK)]
    ]));
});

// 🌟 LỆNH /SAOLUU HOÀN CHỈNH KHÔNG CRASH SERVER
bot.command('saoluu', isAdminMiddleware, async (ctx) => {
    try {
        const userList = Array.from(userDatabase.values());
        if (userList.length === 0) return ctx.reply('⚠️ Hệ thống RAM hiện tại đang trống.');

        const rows = userList.map(u => ({
            'ID Telegram': u.id, 
            'Username': u.username ? `@${u.username}` : 'Không có', 
            'Tên': u.first_name, 
            'Số Dư Xu': u.coins, 
            'Lượt Quay': u.spinsLeft
        }));

        const worksheet = XLSX.utils.json_to_sheet(rows);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Users');
        const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

        await ctx.replyWithDocument(
            { source: buffer, filename: 'DanhSachHoiVien.xlsx' },
            { caption: `📊 Đã xuất danh sách thành công! Tổng số: *${userList.length}* tài khoản.` }
        );
    } catch (err) {
        console.error("Lỗi gửi file Excel:", err.message);
        ctx.reply('❌ Hệ thống tạo file Excel thành công nhưng cổng Telegram bị nghẽn. Hãy gõ lại lệnh sau ít phút!').catch(() => {});
    }
});

bot.on('message', isAdminMiddleware, async (ctx) => {
    if (ctx.message.text && ctx.message.text.includes('[AUTO_BACKUP_DATA]')) {
        try {
            const rawJson = ctx.message.text.split('```json')[1].split('```')[0].trim();
            const userList = JSON.parse(rawJson);
            userList.forEach(u => userDatabase.set(u.id, u));
            return ctx.reply(`🎉 KHÔI PHỤC THÀNH CÔNG!`);
        } catch { return ctx.reply('Lỗi chuỗi JSON!'); }
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Cổng: ${PORT}`));

bot.launch().then(() => {
    setInterval(triggerAutoBackup, BACKUP_INTERVAL);
    startSelfPingMechanism();
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

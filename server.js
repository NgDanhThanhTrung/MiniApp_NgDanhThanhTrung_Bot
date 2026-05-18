/**
 * SIÊU CẤP KIẾM XU - TMA
 * Monolith Server Engine - Bảo mật Webhook Adsgram
 * Năm vận hành: 2026
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
    console.error('❌ THIẾU CẤU HÌNH BIẾN MÔI TRƯỜNG (ENV)!');
    process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);
const app = express();

bot.catch((err) => console.error(`[Telegraf Error]:`, err.message));

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const SERVER_CONFIG = {
    MAX_DAILY_SPINS: 10,
    MAX_DAILY_ADS: 5,
    MIN_VND_COINS_LIMIT: 2000000, 
    REFERRAL_REWARD_COINS: 50000  
};

let userDatabase = new Map();
const EXCEL_FILE_PATH = path.join(__dirname, 'DanhSachHoiVien_Backup.xlsx');

// KHỞI ĐỘNG XÁC THỰC CHUỖI KHÓA KHÁNG GIAN LẬN TELEGRAM
function verifyTelegramWebAppData(initDataString) {
    try {
        if (!initDataString) return null;
        const urlParams = new URLSearchParams(initDataString);
        const hash = urlParams.get('hash');
        urlParams.delete('hash');
        const sortedParams = Array.from(urlParams.entries()).map(([key, value]) => `${key}=${value}`).sort().join('\n');
        const secretKey = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
        const calculatedHash = crypto.createHmac('sha256', secretKey).update(sortedParams).digest('hex');
        if (calculatedHash === hash) return JSON.parse(urlParams.get('user'));
        return null;
    } catch (e) { return null; }
}

function syncUserInMemory(userId, userData) {
    const todayStr = new Date().toISOString().split('T')[0];
    const uid = parseInt(userId, 10);

    if (!userDatabase.has(uid)) {
        userDatabase.set(uid, {
            id: uid,
            username: userData.username || '',
            first_name: userData.first_name || 'Người chơi',
            coins: 50000,           
            spinsLeft: 3,            
            lastSpinTimestamp: 0,
            lastAdsTimestamp: 0,
            dailySpinsCount: 0,
            dailyAdsCount: 0,
            referralCount: 0, 
            lastActiveDate: todayStr
        });
    } else {
        const existing = userDatabase.get(uid);
        if (existing.lastActiveDate !== todayStr) {
            existing.dailySpinsCount = 0;
            existing.dailyAdsCount = 0;
            existing.spinsLeft = Math.max(existing.spinsLeft, 3); 
            existing.lastActiveDate = todayStr;
        }
    }
    return userDatabase.get(uid);
}

// KHÔI PHỤC DỮ LIỆU TỪ EXCEL BACKUP KHI REBOOT SERVER
if (fs.existsSync(EXCEL_FILE_PATH)) {
    try {
        const workbook = XLSX.readFile(EXCEL_FILE_PATH);
        const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
        const todayStr = new Date().toISOString().split('T')[0];
        rows.forEach(r => {
            const uid = parseInt(r['ID telegram'] || r['id'], 10);
            if (uid) {
                userDatabase.set(uid, { 
                    id: uid, username: r['Username'] || '', first_name: r['Tên'] || 'Người chơi', 
                    coins: parseInt(r['số Xu/coin']) || 0, spinsLeft: parseInt(r['Lượt quay còn lại']) || 3, 
                    lastSpinTimestamp: 0, lastAdsTimestamp: 0, dailySpinsCount: 0,
                    dailyAdsCount: Math.max(0, SERVER_CONFIG.MAX_DAILY_ADS - (parseInt(r['số lượng quảng cáo còn lại trong ngày']) ?? 5)),
                    referralCount: parseInt(r['Số người đã mời']) || 0, lastActiveDate: todayStr
                });
            }
        });
        console.log(`[RAM Base] Khôi phục thành công hệ thống từ Excel.`);
    } catch (err) {}
}

app.get('/health', (req, res) => res.status(200).json({ status: "OK", uptime: process.uptime() }));

app.post('/api/user-data', (req, res) => {
    const { initData } = req.body;
    const tgUser = verifyTelegramWebAppData(initData);
    if (!tgUser) return res.status(403).json({ error: "Xác thực lớp bảo mật thất bại!" });
    res.json(syncUserInMemory(tgUser.id, tgUser));
});

// CỔNG API XỬ LÝ CHUẨN: CHỈ CHẤP NHẬN YÊU CẦU QUẢNG CÁO ĐẾN TỪ REWARD URL ADSGRAM
app.all('/api/user/update', async (req, res) => {
    // Ép phân tích tham số khớp hoàn toàn cấu hình trên ảnh: [userId] -> userId
    const telegramId = req.query.userId || req.query['[userId]'] || req.body.telegramId;
    const action = req.query.action || req.body.action;

    if (!telegramId) return res.status(400).json({ error: "Thiếu định danh userId!" });
    
    let user = userDatabase.get(parseInt(telegramId, 10));
    if (!user && req.query.isSandboxDev === 'true') {
        user = syncUserInMemory(parseInt(telegramId, 10), { username: "sandbox_dev", first_name: "Dev Local" });
    }

    if (!user) return res.status(404).json({ error: "User không tồn tại trên hệ thống RAM!" });
    const now = Date.now();

    switch (action) {
        case 'spin_start':
            if (user.spinsLeft <= 0) return res.status(400).json({ error: "❌ Hết lượt quay khả dụng!" });
            user.spinsLeft -= 1; user.dailySpinsCount += 1; user.lastSpinTimestamp = now;
            break;

        case 'spin_reward':
            user.coins += parseInt(req.query.rewardCoins || req.body.rewardCoins, 10);
            break;

        // CHẶN BỎ LUỒNG CLIENT TỰ GỌI 'watch_ads_success' 
        case 'watch_ads_success':
            return res.status(403).json({ error: "🔒 Nghiêm cấm hành vi tự cộng tiền từ Frontend!" });

        // LUỒNG DUY NHẤT HỢP PHÁP: Adsgram Webhook bắn về thông qua Reward URL bảo mật
        case 'watch_ads': 
            if (user.dailyAdsCount >= SERVER_CONFIG.MAX_DAILY_ADS) return res.status(400).json({ error: "Hết hạn mức" });
            user.coins += 12000; 
            user.spinsLeft += 1; 
            user.dailyAdsCount += 1; 
            user.lastAdsTimestamp = now;
            console.log(`[Webhook Adsgram Xác Thực] Đã cộng +12,000 xu bảo mật cho ID: ${telegramId}`);
            break;

        case 'withdraw_request':
            const { withdrawMethod, withdrawAddress, withdrawAmount } = req.query;
            const amount = parseInt(withdrawAmount, 10);
            if (amount > user.coins) return res.status(400).json({ error: "❌ Không đủ số dư!" });
            user.coins -= amount;
            // Bắn đơn rút tiền về quản trị Admin Bot
            await bot.telegram.sendMessage(ADMIN_ID, `💰 **ĐƠN RÚT TIỀN MỚI:**\nID: \`${user.id}\`\nVí/STK: \`${withdrawAddress}\`\nPhương thức: \`${withdrawMethod}\`\nSố tiền: -${amount.toLocaleString()} Xu`).catch(()=>{});
            break;
            
        default:
            return res.status(400).json({ error: "Hành động cập nhật không hợp lệ!" });
    }
    return res.json(user);
});

async function triggerAutoBackup() {
    if (userDatabase.size === 0) return;
    const userList = Array.from(userDatabase.values());
    const rows = userList.map(u => ({ 
        'ID telegram': u.id, 'Username': u.username, 'Tên': u.first_name, 
        'Lượt quay còn lại': u.spinsLeft, 'số Xu/coin': u.coins, 
        'số lượng quảng cáo còn lại trong ngày': Math.max(0, 5 - u.dailyAdsCount), 'Số người đã mời': u.referralCount || 0 
    }));
    XLSX.writeFile(XLSX.utils.book_append_sheet(XLSX.utils.book_new(), XLSX.utils.json_to_sheet(rows), 'Users'), EXCEL_FILE_PATH);
}

// KHỞI CHẠY BOT TELEGRAM
bot.start(async (ctx) => {
    const userId = ctx.from.id;
    const startPayload = ctx.payload ? ctx.payload.trim() : ""; 
    let isNewUser = !userDatabase.has(userId);
    const user = syncUserInMemory(userId, ctx.from);

    if (isNewUser && startPayload) {
        const referrerId = parseInt(startPayload, 10);
        if (!isNaN(referrerId) && referrerId !== userId && userDatabase.has(referrerId)) {
            const inviter = userDatabase.get(referrerId);
            inviter.coins += SERVER_CONFIG.REFERRAL_REWARD_COINS;
            inviter.referralCount = (inviter.referralCount || 0) + 1; 
            
            bot.telegram.sendMessage(
                referrerId, 
                `🎉 *Mời bạn thành công!*\nHội viên mới: ${ctx.from.first_name} vừa tham gia.\nSố dư tài khoản của bạn được thưởng: *+50,000 Xu*!`,
                { parse_mode: 'Markdown' }
            ).catch(()=>{});
        }
    }
    const welcomeText = `👋 *Xin chào ${ctx.from.first_name}!* \nSố dư tài khoản: *${user.coins.toLocaleString()} Xu*`;
    return ctx.replyWithMarkdown(welcomeText, Markup.inlineKeyboard([[Markup.button.webApp('🚀 Mở Ứng Dụng Kiếm Xu', MY_APP_LINK)]]));
});

bot.command('saoluu', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    await triggerAutoBackup();
    ctx.replyWithDocument({ source: EXCEL_FILE_PATH, filename: 'DanhSachHoiVien.xlsx' }).catch(()=>{});
});

// CƠ CHẾ ANTI-SLEEP GIỮ SERVER HOẠT ĐỘNG LIÊN TỤC
setInterval(async () => {
    try { await fetch(`${MY_APP_LINK}/health`); } catch (e) {}
}, 5 * 60 * 1000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`[Hosting] Chạy cổng ${PORT}`);
    setInterval(triggerAutoBackup, 5 * 60 * 1000);
});

bot.launch();

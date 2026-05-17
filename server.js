/**
 * SIÊU CẤP KIẾM XU - TMA
 * Monolith Server Engine (Bot Control, RAM Storage, API Hosting & Anti-Sleep)
 * Năm vận hành: 2026
 * Phiên bản: 3.3.0 (Hệ thống endpoint sạch đồng nhất và an toàn)
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

bot.catch((err, ctx) => {
    console.error(`[Telegraf Core Error] Đã chặn lỗi mạng:`, err.message);
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const SERVER_CONFIG = {
    MAX_DAILY_SPINS: 10,
    MAX_DAILY_ADS: 5,
    SPIN_COOLDOWN_MS: 30 * 1000,
    ADS_COOLDOWN_MS: 60 * 1000,
    MIN_VND_COINS_LIMIT: 2000000, 
    REFERRAL_REWARD_COINS: 50000  
};

app.get('/health', (req, res) => {
    res.status(200).json({ status: "OK", uptime: process.uptime() });
});

function startSelfPingMechanism() {
    setInterval(async () => {
        try {
            await fetch(`${MY_APP_LINK}/health`);
        } catch (e) {
            console.error(e.message);
        }
    }, 5 * 60 * 1000);
}

let userDatabase = new Map();
const EXCEL_FILE_PATH = path.join(__dirname, 'DanhSachHoiVien_Backup.xlsx');

function verifyTelegramWebAppData(initDataString) {
    try {
        const urlParams = new URLSearchParams(initDataString);
        const hash = urlParams.get('hash');
        urlParams.delete('hash');
        const sortedParams = Array.from(urlParams.entries()).map(([key, value]) => `${key}=${value}`).sort().join('\n');
        const secretKey = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
        const calculatedHash = crypto.createHmac('sha256', secretKey).update(sortedParams).digest('hex');
        if (calculatedHash === hash) return JSON.parse(urlParams.get('user'));
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
            lastActiveDate: todayStr
        });
    } else {
        const existing = userDatabase.get(userId);
        if (existing.lastActiveDate !== todayStr) {
            existing.dailySpinsCount = 0;
            existing.dailyAdsCount = 0;
            existing.spinsLeft = Math.max(existing.spinsLeft, 3); 
            existing.lastActiveDate = todayStr;
        }
    }
    return userDatabase.get(userId);
}

function loadRowsIntoDatabase(rows) {
    let count = 0;
    rows.forEach(r => {
        const uid = parseInt(r['ID telegram'] || r['ID Telegram'], 10);
        if (uid) {
            userDatabase.set(uid, { 
                id: uid, 
                username: r['Username'] ? String(r['Username']).replace('@','') : '', 
                first_name: r['Tên'] || 'Người chơi', 
                coins: parseInt(r['số Xu/coin']) || 0, 
                spinsLeft: parseInt(r['Lượt quay còn lại']) || 3, 
                lastSpinTimestamp: 0, lastAdsTimestamp: 0, dailySpinsCount: 0,
                dailyAdsCount: Math.max(0, SERVER_CONFIG.MAX_DAILY_ADS - (parseInt(r['số lượng quảng cáo còn lại trong ngày']) ?? 5)),
                lastActiveDate: new Date().toISOString().split('T')[0]
            });
            count++;
        }
    });
    return count;
}

if (fs.existsSync(EXCEL_FILE_PATH)) {
    try {
        const workbook = XLSX.readFile(EXCEL_FILE_PATH);
        loadRowsIntoDatabase(XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]));
    } catch (err) {}
}

app.post('/api/user-data', (req, res) => {
    const { initData } = req.body;
    const tgUser = verifyTelegramWebAppData(initData);
    if (!tgUser) return res.status(403).json({ error: "Xác thực bảo mật thất bại!" });
    res.json(syncUserInMemory(tgUser.id, tgUser));
});

app.post('/api/update-assets', async (req, res) => {
    const { initData, action, withdrawMethod, withdrawAddress, withdrawAmount } = req.body;
    const tgUser = verifyTelegramWebAppData(initData);
    if (!tgUser) return res.status(403).json({ error: "Bảo mật thất bại!" });

    const user = userDatabase.get(tgUser.id);
    if (!user) return res.status(404).json({ error: "Không tồn tại hội viên!" });
    const now = Date.now();

    switch (action) {
        case 'spin_start':
            user.spinsLeft -= 1; user.dailySpinsCount += 1; user.lastSpinTimestamp = now;
            break;
        case 'spin_reward':
            user.coins += parseInt(req.body.rewardCoins, 10);
            break;
        case 'watch_ads_success':
            user.coins += 12000; user.spinsLeft += 1; user.dailyAdsCount += 1; user.lastAdsTimestamp = now;
            break;
        case 'withdraw_request':
            const amount = parseInt(withdrawAmount, 10);
            user.coins -= amount;
            await bot.telegram.sendMessage(ADMIN_ID, `💰 **ĐƠN RÚT TIỀN MỚI:**\nID: \`${user.id}\`\nSTK/Ví: \`${withdrawAddress}\`\nSố tiền: -${amount.toLocaleString()} Xu`);
            break;
    }
    res.json(user);
});

// TIẾP NHẬN WEBHOOK TRẢ THƯỞNG CHO REWARD URL ĐỒNG BỘ SẠCH GIỮA FRONTEND VÀ DASHBOARD
app.all('/api/user/update', async (req, res) => {
    const telegramId = req.query.userId || req.body.telegramId || req.query.telegramId || req.query['[userId]'];
    const action = req.query.action || req.body.action;

    if (!telegramId) return res.status(400).json({ error: "Thiếu định danh userId!" });
    
    const user = userDatabase.get(parseInt(telegramId, 10));
    if (!user) return res.status(404).json({ error: "User không tồn tại!" });

    if (action === 'watch_ads') {
        user.coins += 12000; user.spinsLeft += 1; user.dailyAdsCount += 1; user.lastAdsTimestamp = Date.now();
        console.log(`[Webhook Done] +12k xu cho ID: ${telegramId}`);
    }
    res.json(user);
});

app.get('/watch-ads', (req, res) => {
    const userId = req.query.userId;
    res.send(`
        <!DOCTYPE html>
        <html>
        <head><title>Adsgram Link Cày Xu...</title><script src="https://sad.adsgram.ai/js/v1/adsgram-telegram-widget.js"></script></head>
        <body style="background:#17212b;color:#fff;text-align:center;padding-top:50px;">
            <h3>🔄 Đang kết nối luồng Video Adsgram cho ID: ${userId}...</h3>
            <script>
                document.addEventListener('DOMContentLoaded', () => {
                    if(window.Adsgram) {
                        const AdController = window.Adsgram.createAdController('30388');
                        AdController.show().then(async () => {
                            await fetch('/api/user/update?userId=${userId}&action=watch_ads');
                            alert("💎 Thành công!");
                        });
                    }
                });
            </script>
        </body>
        </html>
    `);
});

async function triggerAutoBackup() {
    if (userDatabase.size === 0) return;
    const userList = Array.from(userDatabase.values());
    const rows = userList.map(u => ({ 'ID telegram': u.id, 'Username': u.username, 'Tên': u.first_name, 'Lượt quay còn lại': u.spinsLeft, 'số Xu/coin': u.coins, 'số lượng quảng cáo còn lại trong ngày': Math.max(0, 5 - u.dailyAdsCount) }));
    XLSX.writeFile(XLSX.utils.book_append_sheet(XLSX.utils.book_new(), XLSX.utils.json_to_sheet(rows), 'Users'), EXCEL_FILE_PATH);
}

bot.start(async (ctx) => {
    const user = syncUserInMemory(ctx.from.id, ctx.from);
    return ctx.replyWithMarkdown(`👋 *Xin chào ${ctx.from.first_name}!* \nSố dư: *${user.coins.toLocaleString()} Xu*`, Markup.inlineKeyboard([[Markup.button.webApp('🚀 Mở Ứng Dụng Kiếm Xu', MY_APP_LINK)]]));
});

bot.command('saoluu', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    await triggerAutoBackup();
    ctx.replyWithDocument({ source: EXCEL_FILE_PATH, filename: 'DanhSachHoiVien.xlsx' });
});

bot.launch().then(() => {
    setInterval(triggerAutoBackup, 5 * 60 * 1000);
    startSelfPingMechanism();
});

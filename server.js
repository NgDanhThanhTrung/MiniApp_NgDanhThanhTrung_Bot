/**
 * SIÊU CẤP KIẾM XU - TMA
 * Monolith Server Engine (Bot Control, RAM Storage, API Hosting & Anti-Sleep)
 * Năm vận hành: 2026
 * Phiên bản: 4.0.0 (Hợp nhất cổng API qua Query Parameter - Gỡ bỏ hoàn toàn Cooldown)
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
        if (!initDataString) return null;
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
        existing.username = userData.username || existing.username;
        existing.first_name = userData.first_name || existing.first_name;
        
        if (existing.referralCount === undefined) {
            existing.referralCount = 0;
        }

        if (existing.lastActiveDate !== todayStr) {
            existing.dailySpinsCount = 0;
            existing.dailyAdsCount = 0;
            existing.spinsLeft = Math.max(existing.spinsLeft, 3); 
            existing.lastActiveDate = todayStr;
        }
    }
    return userDatabase.get(uid);
}

function loadRowsIntoDatabase(rows) {
    let count = 0;
    const todayStr = new Date().toISOString().split('T')[0];
    rows.forEach(r => {
        const uid = parseInt(r['ID telegram'] || r['ID Telegram'] || r['id'], 10);
        if (uid) {
            userDatabase.set(uid, { 
                id: uid, 
                username: r['Username'] || r['Tên tài khoản'] || '', 
                first_name: r['Tên'] || 'Người chơi', 
                coins: parseInt(r['số Xu/coin'] || r['Số Xu/coin']) || 0, 
                spinsLeft: parseInt(r['Lượt quay còn lại'] || r['Lượt Quay Còn Lại']) || 3, 
                lastSpinTimestamp: 0, 
                lastAdsTimestamp: 0, 
                dailySpinsCount: 0,
                dailyAdsCount: Math.max(0, SERVER_CONFIG.MAX_DAILY_ADS - (parseInt(r['số lượng quảng cáo còn lại trong ngày']) ?? 5)),
                referralCount: parseInt(r['Số người đã mời'] || r['Referrals']) || 0, 
                lastActiveDate: todayStr
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
        console.log(`[RAM Base] Khôi phục dữ liệu Excel thành công.`);
    } catch (err) {}
}

app.post('/api/user-data', (req, res) => {
    const { initData } = req.body;
    const tgUser = verifyTelegramWebAppData(initData);
    if (!tgUser) return res.status(403).json({ error: "Xác thực bảo mật thất bại!" });
    res.json(syncUserInMemory(tgUser.id, tgUser));
});

// CỔNG API HỢP NHẤT TOÀN DIỆN CHẠY BẰNG PHƯƠNG THỨC TRUY VẤN URL QUERY (ĐỒNG BỘ 100% KẾT NỐI RAM)
app.all('/api/user/update', async (req, res) => {
    const telegramId = req.query.userId || req.body.telegramId || req.query.telegramId || req.query['[userId]'];
    const action = req.query.action || req.body.action;

    if (!telegramId) return res.status(400).json({ error: "Thiếu định danh userId!" });
    
    // Đảm bảo tạo mới hoặc đồng bộ tài khoản nếu người dùng chạy chế độ giả lập Sandbox Dev
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

        case 'watch_ads_success': // Luồng xem video thành công từ Mini App gửi về
            if (user.dailyAdsCount >= SERVER_CONFIG.MAX_DAILY_ADS) return res.status(400).json({ error: "❌ Hết hạn mức xem Ads hôm nay!" });
            user.coins += 12000; user.spinsLeft += 1; user.dailyAdsCount += 1; user.lastAdsTimestamp = now;
            break;

        case 'watch_ads': // Luồng Webhook trả thưởng ngầm từ đối tác Adsgram gọi về URL
            user.coins += 12000; user.spinsLeft += 1; user.dailyAdsCount += 1; user.lastAdsTimestamp = now;
            console.log(`[Webhook Adsgram Done] Trả thưởng liên tiếp cho ID: ${telegramId}`);
            break;

        case 'withdraw_request':
            const { withdrawMethod, withdrawAddress, withdrawAmount } = req.query;
            const amount = parseInt(withdrawAmount, 10);
            if (amount > user.coins) return res.status(400).json({ error: "❌ Không đủ số dư!" });
            user.coins -= amount;
            await bot.telegram.sendMessage(ADMIN_ID, `💰 **ĐƠN RÚT TIỀN MỚI:**\nID: \`${user.id}\`\nSTK/Ví: \`${withdrawAddress}\`\nSố tiền: -${amount.toLocaleString()} Xu`).catch(()=>{});
            break;
            
        default:
            return res.status(400).json({ error: "Hành động cập nhật không hợp lệ!" });
    }
    
    return res.json(user);
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
                            alert("💎 Cộng tài sản thành công!");
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
    const rows = userList.map(u => ({ 
        'ID telegram': u.id, 
        'Username': u.username, 
        'Tên': u.first_name, 
        'Lượt quay còn lại': u.spinsLeft, 
        'số Xu/coin': u.coins, 
        'số lượng quảng cáo còn lại trong ngày': Math.max(0, 5 - u.dailyAdsCount),
        'Số người đã mời': u.referralCount || 0 
    }));
    XLSX.writeFile(XLSX.utils.book_append_sheet(XLSX.utils.book_new(), XLSX.utils.json_to_sheet(rows), 'Users'), EXCEL_FILE_PATH);
}

bot.start(async (ctx) => {
    const userId = ctx.from.id;
    const startPayload = ctx.payload ? ctx.payload.trim() : (ctx.startPayload ? ctx.startPayload.trim() : ""); 
    let isNewUser = !userDatabase.has(userId);

    const user = syncUserInMemory(userId, ctx.from);

    if (isNewUser && startPayload) {
        const referrerId = parseInt(startPayload, 10);
        if (!isNaN(referrerId) && referrerId !== userId && userDatabase.has(referrerId)) {
            const inviter = userDatabase.get(referrerId);
            inviter.coins += SERVER_CONFIG.REFERRAL_REWARD_COINS;
            inviter.referralCount = (inviter.referralCount || 0) + 1; 
            userDatabase.set(referrerId, inviter);

            try {
                await bot.telegram.sendMessage(
                    referrerId, 
                    `🎉 *Hệ thống Giới Thiệu ghi nhận thành công!*\n` +
                    `👤 Hội viên mới: [${ctx.from.first_name}](tg://user?id=${userId}) vừa tham gia qua link của bạn.\n` +
                    `📊 Tổng số bạn bè đã mời: *${inviter.referralCount} người*\n` +
                    `💎 Số dư tài khoản được cộng thưởng: *+${SERVER_CONFIG.REFERRAL_REWARD_COINS.toLocaleString()} Xu*!` ,
                    { parse_mode: 'Markdown' }
                );
            } catch (e) {
                console.error("Lỗi gửi tin nhắn thưởng tới người mời:", e.message);
            }
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`[Hosting] Chạy cổng ${PORT}`);
    setInterval(triggerAutoBackup, 5 * 60 * 1000);
    startSelfPingMechanism();
});

bot.launch();

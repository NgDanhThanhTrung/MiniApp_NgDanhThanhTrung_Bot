/**
 * SIÊU CẤP KIẾM XU - TMA
 * Monolith Server Engine (Bot Control, RAM Storage, API Hosting & Anti-Sleep)
 * Năm vận hành: 2026
 * Phiên bản: 3.0.0 (Đồng bộ cấu trúc Webhook Adsgram định dạng tham số [userId])
 */

const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

// ==========================================
// 1. CẤU HÌNH & KIỂM TRA BIẾN MÔI TRƯỜNG (ENV)
// ==========================================
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = parseInt(process.env.ADMIN_ID, 10);
const MY_APP_LINK = process.env.MY_APP_LINK; // Định dạng mẫu: https://sieu-cap-ki-xu.onrender.com

if (!BOT_TOKEN || isNaN(ADMIN_ID) || !MY_APP_LINK) {
    console.error('❌ THIẾU CẤU HÌNH BIẾN MÔI TRƯỜNG (ENV)! Tiến trình khởi động server bị hủy.');
    process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);
const app = express();

bot.catch((err, ctx) => {
    console.error(`[Telegraf Core Error] Đã chặn lỗi từ cổng mạng của Update ${ctx.update.update_id}:`, err.message);
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Cấu hình tham số giới hạn hệ thống
const SERVER_CONFIG = {
    MAX_DAILY_SPINS: 10,
    MAX_DAILY_ADS: 5,
    SPIN_COOLDOWN_MS: 30 * 1000,
    ADS_COOLDOWN_MS: 60 * 1000,
    MIN_VND_COINS_LIMIT: 2000000, // Tối thiểu 2,000,000 Xu = 2,000 VNĐ cho MoMo/Bank
    REFERRAL_REWARD_COINS: 50000  // Thưởng mời bạn bè: 50,000 Xu
};

// ==========================================
// 2. CƠ CHẾ TỰ ĐỘNG PING CHỐNG NGỦ ĐÔNG
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
                console.log(`[Keep-Alive] Tự động Ping thành công tới /health lúc: ${new Date().toLocaleTimeString()}`);
            }
        } catch (e) {
            console.error('[Keep-Alive] Lỗi tiến trình tự gọi Ping chống ngủ đông:', e.message);
        }
    }, 5 * 60 * 1000);
}

// ==========================================
// 3. IN-MEMORY DATABASE (QUẢN LÝ RAM & SAO LƯU CỤC BỘ)
// ==========================================
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
            lastActiveDate: todayStr
        });
    } else {
        const existing = userDatabase.get(userId);
        existing.username = userData.username || existing.username;
        existing.first_name = userData.first_name || existing.first_name;
        
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
    const todayStr = new Date().toISOString().split('T')[0];
    
    rows.forEach(r => {
        const uid = parseInt(r['ID telegram'] || r['ID Telegram'] || r['ID Người Dùng'], 10);
        if (uid) {
            const coins = parseInt(r['số Xu/coin'] || r['Số Xu/coin'] || r['Số Dư Xu']) || 0;
            const spinsLeft = parseInt(r['Lượt quay còn lại'] || r['Lượt Quay Còn Lại'] || r['Lượt Quay'], 10) || 3;
            
            const adsRemainingInput = parseInt(r['số lượng quảng cáo còn lại trong ngày'] || r['Số lượng quảng cáo còn lại trong ngày']) ?? SERVER_CONFIG.MAX_DAILY_ADS;
            const dailyAdsCount = Math.max(0, SERVER_CONFIG.MAX_DAILY_ADS - adsRemainingInput);

            userDatabase.set(uid, { 
                id: uid, 
                username: r['Username'] ? String(r['Username']).replace('@','') : '', 
                first_name: r['Tên'] || 'Người chơi', 
                coins: coins, 
                spinsLeft: spinsLeft, 
                lastSpinTimestamp: parseInt(r['lastSpinTimestamp']) || 0,
                lastAdsTimestamp: parseInt(r['lastAdsTimestamp']) || 0,
                dailySpinsCount: parseInt(r['dailySpinsCount']) || 0,
                dailyAdsCount: dailyAdsCount,
                lastActiveDate: r['lastActiveDate'] || todayStr
            });
            count++;
        }
    });
    return count;
}

if (fs.existsSync(EXCEL_FILE_PATH)) {
    try {
        const workbook = XLSX.readFile(EXCEL_FILE_PATH);
        const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
        const count = loadRowsIntoDatabase(rows);
        console.log(`🎉 [RAM Storage] Đã khôi phục thành công dữ liệu của ${count} hội viên từ file Excel.`);
    } catch (err) {
        console.error("❌ Thất bại khi đọc file Excel khôi phục dữ liệu ban đầu:", err.message);
    }
}

// ==========================================
// 4. ROUTE WEB API (KẾT NỐI KHỚP 100% VỚI APP.JS)
// ==========================================
app.post('/api/user-data', (req, res) => {
    const { initData } = req.body;
    const tgUser = verifyTelegramWebAppData(initData);
    if (!tgUser) return res.status(403).json({ error: "Xác thực lớp bảo mật Telegram thất bại!" });
    res.json(syncUserInMemory(tgUser.id, tgUser));
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
            if (user.spinsLeft <= 0) return res.status(400).json({ error: "❌ Bạn đã hết lượt quay khả dụng!" });
            if (user.dailySpinsCount >= SERVER_CONFIG.MAX_DAILY_SPINS) return res.status(400).json({ error: "❌ Bạn đã đạt giới hạn số lần quay hôm nay." });
            if (now - user.lastSpinTimestamp < SERVER_CONFIG.SPIN_COOLDOWN_MS) return res.status(400).json({ error: "⏳ Vòng quay đang trong thời gian hồi năng lượng!" });

            user.spinsLeft -= 1;
            user.dailySpinsCount += 1;
            user.lastSpinTimestamp = now;
            break;

        case 'spin_reward':
            const { rewardCoins } = req.body;
            const validRewards = [1000, 5000, 200, 10000, 500, 2000, 20000, 50000];
            const rewardVal = parseInt(rewardCoins, 10);
            if (!rewardVal || !validRewards.includes(rewardVal)) return res.status(400).json({ error: "❌ Dữ liệu phần thưởng vòng quay không hợp lệ!" });
            user.coins += rewardVal;
            break;

        case 'watch_ads_success':
            if (user.dailyAdsCount >= SERVER_CONFIG.MAX_DAILY_ADS) return res.status(400).json({ error: "❌ Bạn đã xem hết giới hạn số lượng Ads hôm nay." });
            if (now - user.lastAdsTimestamp < SERVER_CONFIG.ADS_COOLDOWN_MS) return res.status(400).json({ error: "⏳ Vui lòng chờ thời gian chuẩn bị video kế tiếp." });

            user.coins += 12000; 
            user.spinsLeft += 1;  
            user.dailyAdsCount += 1;
            user.lastAdsTimestamp = now;
            break;

        case 'withdraw_request':
            const amount = parseInt(withdrawAmount, 10);
            if (!withdrawAddress || isNaN(amount) || amount <= 0) return res.status(400).json({ error: "❌ Vui lòng nhập đầy đủ địa chỉ và số xu rút hợp lệ!" });
            if (amount > user.coins) return res.status(400).json({ error: "❌ Số dư khả dụng trong tài khoản hiện tại không đủ!" });

            if ((withdrawMethod === 'momo' || withdrawMethod === 'bank') && amount < SERVER_CONFIG.MIN_VND_COINS_LIMIT) {
                return res.status(400).json({ error: `❌ MoMo/Ngân hàng yêu cầu rút tối thiểu từ ${SERVER_CONFIG.MIN_VND_COINS_LIMIT.toLocaleString()} Xu!` });
            }

            user.coins -= amount;

            const reportMsg = `💰 *YÊU CẦU RÚT TIỀN MỚI* 💰\n\n` +
                              `👤 Người chơi: [${user.first_name}](tg://user?id=${user.id})\n` +
                              `🆔 ID Tài khoản: \`${user.id}\`\n` +
                              `💳 Phương thức: *${withdrawMethod.toUpperCase()}*\n` +
                              `📍 Địa chỉ nhận / STK: \`${withdrawAddress}\`\n` +
                              `📉 Khấu trừ tài sản: -*${amount.toLocaleString()} Xu*\n` +
                              `⏱️ Thời gian hệ thống: ${new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}` +
                              `\n\n*(Lưu ý: Đối với TON Network, Admin thực hiện xét duyệt ngầm và quy đổi dựa theo tỷ giá thực tế)*`;

            try {
                await bot.telegram.sendMessage(ADMIN_ID, reportMsg, { parse_mode: 'Markdown' });
            } catch (err) {
                user.coins += amount;
                return res.status(500).json({ error: "❌ Cổng gửi báo cáo tới Admin bị nghẽn, lệnh rút bị tạm hoãn!" });
            }
            break;
    }
    res.json(user);
});

// CỔNG API TIẾP NHẬN REWARD WEBHOOK TỪ ADSGRAM (XỬ LÝ ĐỒNG BỘ ĐỊNH DẠNG THAM SỐ [userId])
app.all('/api/user/update', async (req, res) => {
    // Lấy ID thông minh từ body hoặc từ Query URL (Hỗ trợ bóc tách tham số dạng chuỗi [userId])
    const telegramId = req.body.telegramId || req.query.telegramId || req.query['[userId]'];
    const action = req.body.action || req.query.action;

    if (!telegramId) {
        return res.status(400).json({ error: "❌ Thao tác thất bại: Thiếu tham số định danh telegramId trên cấu trúc URL!" });
    }
    
    const uid = parseInt(telegramId, 10);
    const user = userDatabase.get(uid);
    if (!user) {
        return res.status(404).json({ error: "❌ Hội viên không tồn tại trên bộ nhớ đệm RAM!" });
    }

    if (action === 'watch_ads') {
        const now = Date.now();
        if (user.dailyAdsCount >= SERVER_CONFIG.MAX_DAILY_ADS) return res.status(400).json({ error: "Max Ads Limit" });
        if (now - user.lastAdsTimestamp < SERVER_CONFIG.ADS_COOLDOWN_MS) return res.status(400).json({ error: "Cooldown Engine Active" });

        user.coins += 12000;      
        user.spinsLeft += 1;      
        user.dailyAdsCount += 1;  
        user.lastAdsTimestamp = now;
        
        console.log(`[Adsgram Webhook Server] Khớp định dạng thành công! +12,000 Xu cho UserID: ${uid}`);
    }
    res.json(user);
});

// Cổng điều hướng hiển thị Adsgram qua liên kết ngoài
app.get('/watch-ads', (req, res) => {
    const userId = req.query.userId;
    if (!userId || isNaN(parseInt(userId, 10))) return res.status(400).send("<h3>❌ Cấu trúc URL sai định dạng!</h3>");

    res.send(`
        <!DOCTYPE html>
        <html lang="vi">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
            <title>Đang kết nối cổng Adsgram...</title>
            <script src="https://telegram.org/js/telegram-web-app.js"></script>
            <script src="https://sad.adsgram.ai/js/v1/adsgram-telegram-widget.js"></script>
            <style>
                body { background-color: #17212b; color: #f5f5f5; font-family: sans-serif; text-align: center; padding: 40px 20px; margin: 0; }
                .loader { border: 4px solid rgba(255,255,255,0.1); border-top: 4px solid #64b5f6; border-radius: 50%; width: 45px; height: 45px; animation: spin 1s linear infinite; margin: 25px auto; }
                @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
                .card { background: #24303f; padding: 20px; border-radius: 16px; border: 1px solid rgba(255,255,255,0.05); box-shadow: 0 4px 15px rgba(0,0,0,0.3); }
                h3 { margin-bottom: 10px; font-size: 1.1rem; color: #64b5f6; }
                p { font-size: 0.9rem; color: #708499; line-height: 1.4; }
            </style>
        </head>
        <body>
            <div class="card">
                <div class="loader"></div>
                <h3 id="status-text">🔄 Đang tải luồng Video Adsgram...</h3>
                <p>Hệ thống đang chuẩn bị kết nối cho Tài khoản ID: <b>${userId}</b>. Vui lòng xem hết 15 giây quảng cáo để nhận thưởng.</p>
            </div>
            <script>
                document.addEventListener('DOMContentLoaded', () => {
                    if (window.Adsgram) {
                        const AdController = window.Adsgram.createAdController('30379');
                        AdController.show().then(async () => {
                            document.getElementById('status-text').innerText = "⏳ Đang ghi nhận phần thưởng lên RAM Server...";
                            
                            // Điều hướng trích xuất gọi cổng webhook gán tham số dạng cấu trúc mảng [userId]
                            const response = await fetch('/api/user/update?[userId]=${userId}&action=watch_ads', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' }
                            });
                            if (response.ok) {
                                document.getElementById('status-text').innerText = "🎉 THÀNH CÔNG!";
                                alert("💎 Cộng +12,000 Xu thành công!");
                            } else {
                                document.getElementById('status-text').innerText = "❌ Lỗi: Hệ thống từ chối do Cooldown hoặc quá hạn mức hằng ngày.";
                            }
                        }).catch(() => {
                            document.getElementById('status-text').innerText = "❌ Lỗi tải quảng cáo.";
                        });
                    }
                });
            </script>
        </body>
        </html>
    `);
});

app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });

// ==========================================
// 5. TIẾN TRÌNH TỰ ĐỘNG GHI SAO LƯU ĐỊNH KỲ
// ==========================================
async function triggerAutoBackup() {
    if (userDatabase.size === 0) return;
    try {
        const userList = Array.from(userDatabase.values());
        const rows = userList.map(u => ({
            'ID telegram': u.id, 
            'Username': u.username ? `@${u.username}` : '', 
            'Tên': u.first_name,
            'Lượt quay còn lại': u.spinsLeft,
            'số Xu/coin': u.coins,
            'số lượng quảng cáo còn lại trong ngày': Math.max(0, SERVER_CONFIG.MAX_DAILY_ADS - u.dailyAdsCount),
            'lastSpinTimestamp': u.lastSpinTimestamp,
            'lastAdsTimestamp': u.lastAdsTimestamp,
            'dailySpinsCount': u.dailySpinsCount,
            'lastActiveDate': u.lastActiveDate
        }));
        const worksheet = XLSX.utils.json_to_sheet(rows);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Users');
        XLSX.writeFile(workbook, EXCEL_FILE_PATH);
    } catch (e) {
        console.error("Lỗi tiến trình sao lưu:", e.message);
    }
}

// ==========================================
// 6. CHỨC NĂNG ĐIỀU HÀNH BOT TELEGRAM (ADMIN CONTROL)
// ==========================================
function isAdminMiddleware(ctx, next) {
    if (ctx.from?.id === ADMIN_ID) return next();
    return ctx.reply('❌ Lệnh này chỉ dành riêng cho Ban Quản Trị.').catch(() => {});
}

bot.start(async (ctx) => {
    const userId = ctx.from.id;
    const startPayload = ctx.startPayload; 
    let isNewUser = !userDatabase.has(userId);

    const user = syncUserInMemory(userId, ctx.from);

    if (isNewUser && startPayload && startPayload.startsWith('ref_')) {
        const inviterId = parseInt(startPayload.replace('ref_', ''), 10);
        
        if (!isNaN(inviterId) && inviterId !== userId && userDatabase.has(inviterId)) {
            const inviter = userDatabase.get(inviterId);
            inviter.coins += SERVER_CONFIG.REFERRAL_REWARD_COINS;
            userDatabase.set(inviterId, inviter);

            try {
                await bot.telegram.sendMessage(
                    inviterId, 
                    `🎉 *Hệ thống Referral kích hoạt thành công!*\n` +
                    `👤 Người bạn mời: [${ctx.from.first_name}](tg://user?id=${userId}) đã tham gia.\n` +
                    `💎 Tài khoản của bạn được cộng thưởng: *+${SERVER_CONFIG.REFERRAL_REWARD_COINS.toLocaleString()} Xu*!` ,
                    { parse_mode: 'Markdown' }
                );
            } catch (e) {
                console.error("Lỗi gửi tin nhắn thưởng tới người mời:", e.message);
            }
        }
    }

    const welcomeText = `👋 *Xin chào ${ctx.from.first_name}!* \n\n` +
                        `Chào mừng bạn đến với hệ thống *Siêu Cấp Kiếm Xu*.\n` +
                        `💰 Số dư: *${user.coins.toLocaleString()} Xu*\n` +
                        `🎡 Lượt quay: *${user.spinsLeft} lượt*\n\n` +
                        `Bấm nút dưới đây để vào ứng dụng cày xu ngay! 👇`;

    return ctx.replyWithMarkdown(welcomeText, Markup.inlineKeyboard([
        [Markup.button.webApp('🚀 Mở Ứng Dụng Kiếm Xu', MY_APP_LINK)]
    ])).catch(() => {});
});

bot.command('saoluu', isAdminMiddleware, async (ctx) => {
    try {
        const userList = Array.from(userDatabase.values());
        if (userList.length === 0) return ctx.reply('⚠️ Cơ sở dữ liệu RAM hiện tại đang trống.');

        const rows = userList.map(u => ({
            'ID telegram': u.id, 
            'Username': u.username ? `@${u.username}` : 'Không có', 
            'Tên': u.first_name, 
            'Lượt quay còn lại': u.spinsLeft,
            'số Xu/coin': u.coins,
            'số lượng quảng cáo còn lại trong ngày': Math.max(0, SERVER_CONFIG.MAX_DAILY_ADS - u.dailyAdsCount)
        }));

        const worksheet = XLSX.utils.json_to_sheet(rows);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Users');
        const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

        await ctx.replyWithDocument(
            { source: buffer, filename: 'DanhSachHoiVien.xlsx' },
            { caption: `📊 Xuất danh sách thành công! Tổng số: *${userList.length}* tài khoản hiện hữu trên RAM.` }
        );
    } catch (err) {
        ctx.reply('❌ Có lỗi xảy ra trong quá trình tạo và gửi file Excel!').catch(() => {});
    }
});

bot.on('document', isAdminMiddleware, async (ctx) => {
    const doc = ctx.message.document;
    if (!doc.file_name.endsWith('.xlsx')) {
        return ctx.reply('⚠️ Định dạng file không hợp lệ! Vui lòng chỉ gửi file Excel có đuôi `.xlsx`.');
    }

    try {
        ctx.reply('🔄 Đang tiến hành đọc và phân tích file Excel dữ liệu...');
        const fileLink = await bot.telegram.getFileLink(doc.file_id);
        const response = await fetch(fileLink.href);
        const arrayBuffer = await response.arrayBuffer();
        
        const workbook = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array' });
        const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
        const restoredCount = loadRowsIntoDatabase(rows);

        if (restoredCount > 0) {
            await triggerAutoBackup();
            return ctx.reply(`🎉 ĐỒNG BỘ THÀNH CÔNG!\n📊 Hệ thống đã nhận diện cấu trúc và nạp lại thành công dữ liệu của *${restoredCount}* tài khoản vào bộ nhớ RAM.`);
        } else {
            return ctx.reply('❌ Thao tác thất bại! File Excel gửi lên trống hoặc không chứa tên tiêu đề các cột hợp lệ (`ID telegram`, `Lượt quay còn lại`, `số Xu/coin`).');
        }
    } catch (err) {
        console.error("Lỗi khi import file Excel:", err.message);
        ctx.reply(`❌ Quá trình đọc file lỗi: ${err.message}. Hãy chắc chắn cấu trúc cột không bị sửa đổi sai định dạng.`);
    }
});

// ==========================================
// 7. KHỞI CHẠY MÁY CHỦ NGUYÊN KHỐI MONOLITH
// ==========================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`[Hosting] Máy chủ đang mở tại cổng Port: ${PORT}`));

bot.launch().then(() => {
    console.log('🚀 Hệ thống Bot lắng nghe lệnh trực tuyến thành công!');
    setInterval(triggerAutoBackup, BACKUP_INTERVAL);
    startSelfPingMechanism(); 
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

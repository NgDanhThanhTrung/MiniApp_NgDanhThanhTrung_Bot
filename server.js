/**
 * SIÊU CẤP KIẾM XU - TMA
 * Monolith Server Engine - Bản vá lỗi Đồng bộ RAM 100% với app.js
 * Năm vận hành: 2026
 */

const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const cors = require('cors');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const querystring = require('querystring');

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = parseInt(process.env.ADMIN_ID, 10);
const MY_APP_LINK = process.env.MY_APP_LINK; 

if (!BOT_TOKEN || isNaN(ADMIN_ID) || !MY_APP_LINK) {
    console.error('❌ THIẾU CẤU HÌNH BIẾN MÔI TRƯỜNG (ENV)! Thao tác boot server bị hủy.');
    process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);
const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const SERVER_CONFIG = {
    COIN_TO_VND_RATE: 1000,
    MAX_DAILY_SPINS: 10,
    MAX_DAILY_ADS: 5,
    SPIN_COOLDOWN: 30 * 1000, 
    ADS_COOLDOWN: 60 * 1000,  
    MIN_WITHDRAW_COINS: 2000000 
};

const BACKUP_INTERVAL = 10 * 60 * 1000; 
const EXCEL_BACKUP_PATH = path.join(__dirname, 'user_database_backup.xlsx');

// ==========================================
// RAM STORAGE CORE
// ==========================================
const userDatabase = new Map();

function createNewUser(uid, username, firstName) {
    return {
        id: uid,
        username: username || '',
        first_name: firstName || 'Người chơi',
        coins: 50000, 
        spinsLeft: 3,  
        lastSpinTimestamp: 0,
        lastAdsTimestamp: 0,
        dailySpinsCount: 0,
        dailyAdsCount: 0,
        referredBy: null,
        totalInvited: 0,
        lastActiveDate: new Date().toISOString().split('T')[0],
        updatedAt: new Date().toISOString()
    };
}

function checkAndResetDailyLimits(user) {
    const today = new Date().toISOString().split('T')[0];
    if (user.lastActiveDate !== today) {
        user.dailySpinsCount = 0;
        user.dailyAdsCount = 0;
        user.lastActiveDate = today;
        user.updatedAt = new Date().toISOString();
    }
}

// Hàm bóc tách dữ liệu an toàn initData từ Telegram gửi lên WebApp
function parseTelegramInitData(initDataString) {
    try {
        const parsed = querystring.parse(initDataString);
        if (parsed.user) {
            return JSON.parse(parsed.user);
        }
    } catch (e) {
        console.error("Lỗi bóc tách initData:", e);
    }
    return null;
}

// Khôi phục database từ file Excel khi khởi động lại
if (fs.existsSync(EXCEL_BACKUP_PATH)) {
    try {
        const workbook = XLSX.readFile(EXCEL_BACKUP_PATH);
        const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
        rows.forEach(r => {
            const uid = parseInt(r['ID Telegram'] || r['id'], 10);
            if (uid) {
                userDatabase.set(uid, {
                    id: uid,
                    username: r['Username'] || '',
                    first_name: r['Tên'] || 'Người chơi',
                    coins: parseInt(r['Số Dư Xu']) || 0,
                    spinsLeft: parseInt(r['Lượt Quay']) || 0,
                    lastSpinTimestamp: parseInt(r['lastSpinTimestamp']) || 0,
                    lastAdsTimestamp: parseInt(r['lastAdsTimestamp']) || 0,
                    dailySpinsCount: parseInt(r['dailySpinsCount']) || 0,
                    dailyAdsCount: parseInt(r['dailyAdsCount']) || 0,
                    referredBy: r['referredBy'] || null,
                    totalInvited: parseInt(r['totalInvited']) || 0,
                    lastActiveDate: r['lastActiveDate'] || new Date().toISOString().split('T')[0],
                    updatedAt: r['updatedAt'] || new Date().toISOString()
                });
            }
        });
        console.log(`[RAM] Đã nạp thành công dữ liệu cũ từ Excel vào bộ nhớ.`);
    } catch(err) { console.error("Lỗi đọc file khôi phục:", err); }
}

// ==========================================
// BOT TELEGRAM TELEGRAF CONTROL
// ==========================================
bot.start((ctx) => {
    const uid = ctx.from.id;
    const username = ctx.from.username || '';
    const firstName = ctx.from.first_name || 'Người chơi';
    const startPayload = ctx.payload;

    let user = userDatabase.get(uid);
    if (!user) {
        user = createNewUser(uid, username, firstName);
        if (startPayload && startPayload.startsWith('ref_')) {
            const referrerId = parseInt(startPayload.split('_')[1], 10);
            if (referrerId && referrerId !== uid && userDatabase.has(referrerId)) {
                user.referredBy = referrerId;
                const referrer = userDatabase.get(referrerId);
                referrer.coins += 10000; // Cộng xu mời bạn bè theo đúng file mẫu
                referrer.totalInvited += 1;
                bot.telegram.sendMessage(referrerId, `🎁 Bạn nhận được +10,000 Xu vì đã mời ${firstName} tham gia!`).catch(()=>{});
            }
        }
        userDatabase.set(uid, user);
    } else {
        user.username = username;
        user.first_name = firstName;
    }
    checkAndResetDailyLimits(user);

    return ctx.replyWithMarkdownV2(
        `👋 *Chào mừng ${firstName.replace('_','\\_')} trở lại\\!*\n💰 Số dư: *${user.coins.toLocaleString()} Xu*`,
        Markup.inlineKeyboard([[Markup.button.webApp('🎡 Mở Vòng Quay Kiếm Xu', MY_APP_LINK)]])
    );
});

// ==========================================
// RESTFUL API ENDPOINTS (ĐỒNG BỘ 100% VỚI APP.JS)
// ==========================================

// 1. API Lấy thông tin ban đầu (Khớp với hàm fetchUserAccountData trong app.js)
app.post('/api/user-data', (req, res) => {
    const { initData } = req.body;
    const tgUser = parseTelegramInitData(initData);
    
    if (!tgUser || !tgUser.id) {
        return res.status(400).json({ error: "Dữ liệu xác thực Telegram không hợp lệ." });
    }

    let user = userDatabase.get(tgUser.id);
    if (!user) {
        user = createNewUser(tgUser.id, tgUser.username, tgUser.first_name);
        userDatabase.set(tgUser.id, user);
    }
    checkAndResetDailyLimits(user);
    return res.json(user);
});

// 2. API Xử lý hành động tài sản tập trung (Khớp với hàm postAssetUpdate trong app.js)
app.post('/api/update-assets', (req, res) => {
    const { initData, action } = req.body;
    const tgUser = parseTelegramInitData(initData);

    if (!tgUser || !tgUser.id) {
        return res.status(400).json({ error: "Xác thực RAM lỗi!" });
    }

    const user = userDatabase.get(tgUser.id);
    if (!user) return res.status(404).json({ error: "Không tìm thấy người dùng." });
    checkAndResetDailyLimits(user);

    const now = Date.now();

    switch(action) {
        case 'spin_start': // Khóa an toàn trước khi xoay vòng đồ họa
            if (user.spinsLeft <= 0) return res.status(400).json({ error: "Bạn đã hết lượt quay!" });
            if (user.dailySpinsCount >= SERVER_CONFIG.MAX_DAILY_SPINS) return res.status(400).json({ error: "Đạt giới hạn quay hôm nay!" });
            if (now - user.lastSpinTimestamp < SERVER_CONFIG.SPIN_COOLDOWN) return res.status(400).json({ error: "Hệ thống đang hồi năng lượng!" });
            
            user.spinsLeft -= 1;
            user.dailySpinsCount += 1;
            user.lastSpinTimestamp = now;
            user.updatedAt = new Date().toISOString();
            return res.json(user);

        case 'spin_reward': // Thực nhận phần thưởng cộng tiền sau khi kết thúc 4s quay
            const { rewardCoins } = req.body;
            if (rewardCoins && rewardCoins > 0) {
                user.coins += parseInt(rewardCoins, 10);
                user.updatedAt = new Date().toISOString();
            }
            return res.json(user);

        case 'watch_ads_success': // Xem xong Adsgram
            if (user.dailyAdsCount >= SERVER_CONFIG.MAX_DAILY_ADS) return res.status(400).json({ error: "Hết lượt xem hôm nay!" });
            if (now - user.lastAdsTimestamp < SERVER_CONFIG.ADS_COOLDOWN) return res.status(400).json({ error: "Thao tác quá nhanh!" });

            user.coins += 12000; // Cộng +12K xu đúng chuẩn app.js của bạn
            user.spinsLeft += 1; // Cộng +1 lượt quay
            user.dailyAdsCount += 1;
            user.lastAdsTimestamp = now;
            user.updatedAt = new Date().toISOString();
            return res.json(user);

        case 'withdraw_request': // Lệnh tạo yêu cầu rút tiền
            const { withdrawMethod, withdrawAddress, withdrawAmount } = req.body;
            const amount = parseInt(withdrawAmount, 10);

            if (!withdrawAddress || isNaN(amount) || amount <= 0) {
                return res.status(400).json({ error: "Dữ liệu nhập không hợp lệ!" });
            }
            if ((withdrawMethod === 'momo' || withdrawMethod === 'bank') && amount < SERVER_CONFIG.MIN_WITHDRAW_COINS) {
                return res.status(400).json({ error: "Chưa đạt hạn mức rút tối thiểu 2M Xu!" });
            }
            if (amount > user.coins) {
                return res.status(400).json({ error: "Số dư ví không đủ!" });
            }

            // Trừ tiền trên RAM ngay để chống bug nhấn liên tục
            user.coins -= amount;
            user.updatedAt = new Date().toISOString();

            // Gửi tin nhắn duyệt tiền về máy Admin Telegram
            const msgAdmin = `💳 *ĐƠN RÚT TIỀN MỚI CHỜ DUYỆT*\n\n` +
                             `👤 Người chơi: ${user.first_name} (ID: \`${user.id}\`)\n` +
                             ` phương thức: *${withdrawMethod.toUpperCase()}*\n` +
                             `📍 Địa chỉ nhận: \`${withdrawAddress}\`\n` +
                             `💰 Số xu: *${amount.toLocaleString()} Xu* (~ ${(amount/1000).toLocaleString()} VNĐ)`;

            bot.telegram.sendMessage(ADMIN_ID, msgAdmin, { parse_mode: 'Markdown' })
                .then(() => res.json(user))
                .catch((e) => {
                    user.coins += amount; // Hoàn tiền nếu lỗi hệ thống bot chặn gửi
                    res.status(500).json({ error: "Lỗi luồng tin nhắn Telegram Admin." });
                });
            break;

        default:
            return res.status(400).json({ error: "Hành động tài sản không hợp lệ." });
    }
});

// ==========================================
// CƠ CHẾ BACKUP & CHỐNG NGỦ ĐÔNG
// ==========================================
function triggerAutoBackup() {
    if (userDatabase.size === 0) return;
    try {
        const arr = [];
        userDatabase.forEach(v => {
            arr.push({
                'ID Telegram': v.id, 'Username': v.username, 'Tên': v.first_name,
                'Số Dư Xu': v.coins, 'Lượt Quay': v.spinsLeft,
                'lastSpinTimestamp': v.lastSpinTimestamp, 'lastAdsTimestamp': v.lastAdsTimestamp,
                'dailySpinsCount': v.dailySpinsCount, 'dailyAdsCount': v.dailyAdsCount,
                'referredBy': v.referredBy, 'totalInvited': v.totalInvited,
                'lastActiveDate': v.lastActiveDate, 'updatedAt': v.updatedAt
            });
        });
        const ws = XLSX.utils.json_to_sheet(arr);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Users');
        XLSX.writeFile(wb, EXCEL_BACKUP_PATH);
        console.log(`[Backup] Đã lưu trữ ${userDatabase.size} tài khoản.`);
    } catch(e) { console.error("Lỗi ghi file Excel:", e); }
}

function startSelfPingMechanism() {
    setInterval(() => {
        import('node-fetch').then(({default: fetch}) => {
            fetch(MY_APP_LINK)
                .then(() => console.log('[Anti-Sleep] Đang giữ máy chủ Render hoạt động liên tục...'))
                .catch((e) => console.log('Lỗi gọi tự Ping:', e.message));
        });
    }, 5 * 60 * 1000);
}

// Admin nạp trực tiếp file Excel đè lại bộ nhớ qua chat
bot.on('document', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const doc = ctx.message.document;
    if (doc.file_name.endsWith('.xlsx')) {
        try {
            const link = await ctx.telegram.getFileLink(doc.file_id);
            const res = await import('node-fetch').then(m => m.default(link.href));
            const buf = await res.arrayBuffer();
            const workbook = XLSX.read(new Uint8Array(buf), { type: 'array' });
            const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
            rows.forEach(r => {
                const uid = parseInt(r['ID Telegram'] || r['id'], 10);
                if (uid) {
                    userDatabase.set(uid, {
                        id: uid, username: r['Username'] || '', first_name: r['Tên'] || 'Người chơi',
                        coins: parseInt(r['Số Dư Xu']) || 0, spinsLeft: parseInt(r['Lượt Quay']) || 3,
                        lastSpinTimestamp: parseInt(r['lastSpinTimestamp']) || 0,
                        lastAdsTimestamp: parseInt(r['lastAdsTimestamp']) || 0,
                        dailySpinsCount: parseInt(r['dailySpinsCount']) || 0,
                        dailyAdsCount: parseInt(r['dailyAdsCount']) || 0,
                        referredBy: r['referredBy'] || null, totalInvited: parseInt(r['totalInvited']) || 0,
                        lastActiveDate: r['lastActiveDate'] || new Date().toISOString().split('T')[0],
                        updatedAt: new Date().toISOString()
                    });
                }
            });
            triggerAutoBackup();
            return ctx.reply(`🎉 Khôi phục dữ liệu thành công vào RAM!`);
        } catch(e) { return ctx.reply('Lỗi đọc cấu trúc file Excel.'); }
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`[Hosting] Chạy cổng: ${PORT}`));

bot.launch().then(() => {
    console.log('🚀 Hệ thống Bot lắng nghe trực tuyến thành công!');
    setInterval(triggerAutoBackup, BACKUP_INTERVAL);
    startSelfPingMechanism();
});

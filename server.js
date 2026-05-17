/**
 * SIÊU CẤP KIẾM XU - TMA
 * Monolith Server Engine (Bot Control, RAM Storage, API Hosting & Anti-Sleep)
 * Năm vận hành: 2026
 * Phiên bản: 2.6.0 (Tối ưu hóa luồng bảo mật rút tiền và đồng bộ an toàn RAM)
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

// Chặn đứng toàn bộ lỗi sập Socket mạng từ Telegram API để giữ server Node.js luôn chạy
bot.catch((err, ctx) => {
    console.error(`[Telegraf Core Error] Đã chặn lỗi từ cổng mạng của Update ${ctx.update.update_id}:`, err.message);
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Cấu hình các tham số giới hạn đồng bộ hằng ngày khớp 100% với app.js
const SERVER_CONFIG = {
    MAX_DAILY_SPINS: 10,
    MAX_DAILY_ADS: 5,
    SPIN_COOLDOWN_MS: 30 * 1000,
    ADS_COOLDOWN_MS: 60 * 1000,
    MIN_VND_COINS_LIMIT: 2000000 // Tối thiểu 2,000,000 Xu = 2,000 VNĐ cho MoMo/Bank
};

// ==========================================
// 2. CƠ CHẾ TỰ ĐỘNG PING GIỮ RENDER LUÔN THỨC
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
    }, 5 * 60 * 1000); // Định kỳ 5 phút tự động ping 1 lần để giữ Render không rơi vào trạng thái ngủ đông
}

// ==========================================
// 3. IN-MEMORY DATABASE (QUẢN LÝ RAM & SAO LƯU CỤC BỘ)
// ==========================================
let userDatabase = new Map();
const BACKUP_INTERVAL = 5 * 60 * 1000; // Tự động ghi file Excel sau mỗi 5 phút
const EXCEL_FILE_PATH = path.join(__dirname, 'DanhSachHoiVien_Backup.xlsx');

// Hàm giải mã mã hóa chuỗi dữ liệu initData an toàn được đẩy lên từ Telegram WebApp
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

// Hàm đồng bộ trạng thái tài khoản người chơi trực tiếp trên bộ nhớ RAM
function syncUserInMemory(userId, userData) {
    const todayStr = new Date().toISOString().split('T')[0];
    
    if (!userDatabase.has(userId)) {
        userDatabase.set(userId, {
            id: userId,
            username: userData.username || '',
            first_name: userData.first_name || 'Người chơi',
            coins: 50000,           // Mồi sẵn 50,000 Xu tài khoản trải nghiệm ban đầu giống app.js
            spinsLeft: 3,            // Mồi sẵn 3 lượt quay ban đầu tránh lỗi giao diện
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
        
        // Cơ chế Auto-Reset toàn bộ hạn mức cày cuốc theo ngày dựa trên Server Time khi sang ngày mới
        if (existing.lastActiveDate !== todayStr) {
            existing.dailySpinsCount = 0;
            existing.dailyAdsCount = 0;
            existing.spinsLeft = Math.max(existing.spinsLeft, 3); // Hoàn trả tối thiểu 3 lượt quay ngày mới cho hội viên
            existing.lastActiveDate = todayStr;
        }
    }
    return userDatabase.get(userId);
}

// ------ KHÔI PHỤC DỮ LIỆU TỰ ĐỘNG TỪ EXCEL KHI MÁY CHỦ REBOOT ------
if (fs.existsSync(EXCEL_FILE_PATH)) {
    try {
        const workbook = XLSX.readFile(EXCEL_FILE_PATH);
        const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
        let count = 0;
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
                count++;
            }
        });
        console.log(`🎉 [RAM Storage] Đã khôi phục thành công dữ liệu của ${count} hội viên từ file Excel sao lưu.`);
    } catch (err) {
        console.error("❌ Thất bại khi đọc file Excel khôi phục dữ liệu ban đầu:", err.message);
    }
}

// ==========================================
// 4. ROUTE WEB API (KẾT NỐI KHỚP 100% VỚI APP.JS)
// ==========================================

// Tuyến đường số 1: Nhận diện và đồng bộ dữ liệu tài khoản khi vừa tải app (fetchUserAccountData trong app.js)
app.post('/api/user-data', (req, res) => {
    const { initData } = req.body;
    const tgUser = verifyTelegramWebAppData(initData);
    
    if (!tgUser) {
        return res.status(403).json({ error: "Xác thực lớp bảo mật Telegram thất bại!" });
    }

    const user = syncUserInMemory(tgUser.id, tgUser);
    res.json(user);
});

// Tuyến đường số 2: Tiếp quản cổng postAssetUpdate tập trung chính xử lý an toàn tài sản từ app.js
app.post('/api/update-assets', async (req, res) => {
    const { initData, action, withdrawMethod, withdrawAddress, withdrawAmount } = req.body;
    const tgUser = verifyTelegramWebAppData(initData);
    if (!tgUser) return res.status(403).json({ error: "Xác thực bảo mật Telegram thất bại!" });

    const user = userDatabase.get(tgUser.id);
    if (!user) return res.status(404).json({ error: "Tài khoản không tồn tại trên hệ thống RAM!" });

    const now = Date.now();

    switch (action) {
        case 'spin_start': // Phân luồng 1: Khóa trừ lượt quay ngầm từ xa ngay khi bấm quay trên giao diện công khai
            if (user.spinsLeft <= 0) return res.status(400).json({ error: "❌ Bạn đã hết lượt quay khả dụng!" });
            if (user.dailySpinsCount >= SERVER_CONFIG.MAX_DAILY_SPINS) return res.status(400).json({ error: "❌ Bạn đã đạt giới hạn số lần quay hôm nay." });
            if (now - user.lastSpinTimestamp < SERVER_CONFIG.SPIN_COOLDOWN_MS) return res.status(400).json({ error: "⏳ Vòng quay đang trong thời gian hồi năng lượng!" });

            user.spinsLeft -= 1;
            user.dailySpinsCount += 1;
            user.lastSpinTimestamp = now;
            break;

        case 'spin_reward': // Phân luồng 2: Thực lĩnh cộng tiền sau khi kết thúc hiệu ứng xoay đồ họa 4 giây tĩnh
            const { rewardCoins } = req.body;
            const validRewards = [1000, 5000, 200, 10000, 500, 2000, 20000, 50000]; // Mảng phần thưởng cấu trúc khớp bánh xe
            const rewardVal = parseInt(rewardCoins, 10);

            if (!rewardVal || !validRewards.includes(rewardVal)) {
                return res.status(400).json({ error: "❌ Dữ liệu phần thưởng vòng quay không hợp lệ!" });
            }

            user.coins += rewardVal;
            break;

        case 'watch_ads_success': // Phân luồng 3: Xem hết luồng quảng cáo Adsgram Live thành công trọn vẹn 15 giây
            if (user.dailyAdsCount >= SERVER_CONFIG.MAX_DAILY_ADS) return res.status(400).json({ error: "❌ Bạn đã xem hết giới hạn số lượng Ads hôm nay." });
            if (now - user.lastAdsTimestamp < SERVER_CONFIG.ADS_COOLDOWN_MS) return res.status(400).json({ error: "⏳ Vui lòng chờ thời gian chuẩn bị video kế tiếp." });

            user.coins += 12000; // Cộng +12,000 Xu chuẩn logic app.js
            user.spinsLeft += 1;  // Tặng +1 Lượt quay may mắn vào RAM
            user.dailyAdsCount += 1;
            user.lastAdsTimestamp = now;
            break;

        case 'withdraw_request': // Phân luồng 4: Tạo đơn tạo lệnh rút tiền mặt phân luồng bảo mật bắn về Telegram Admin
            const amount = parseInt(withdrawAmount, 10);
            if (!withdrawAddress || isNaN(amount) || amount <= 0) {
                return res.status(400).json({ error: "❌ Vui lòng nhập đầy đủ địa chỉ và số xu rút hợp lệ!" });
            }
            if (amount > user.coins) {
                return res.status(400).json({ error: "❌ Số dư khả dụng trong tài khoản hiện tại không đủ!" });
            }

            // Chặn hạn mức rút tối thiểu của MoMo và Bank (Hệ thống TON Crypto được tự do quy đổi ngầm)
            if ((withdrawMethod === 'momo' || withdrawMethod === 'bank') && amount < SERVER_CONFIG.MIN_VND_COINS_LIMIT) {
                return res.status(400).json({ error: `❌ MoMo/Ngân hàng yêu cầu rút tối thiểu từ ${SERVER_CONFIG.MIN_VND_COINS_LIMIT.toLocaleString()} Xu!` });
            }

            // Khấu trừ trực tiếp tài sản trên RAM ngay lập tức chống hành vi lặp lệnh (Anti-Double-Spend)
            user.coins -= amount;

            // Đóng gói nội dung báo cáo chi tiết chuẩn hóa gửi về chat điều hành của Admin
            const reportMsg = `💰 *YÊU CẦU RÚT TIỀN MỚI* 💰\n\n` +
                              `👤 Người chơi: [${user.first_name}](tg://user?id=${user.id})\n` +
                              `🆔 ID Tài khoản: \`${user.id}\`\n` +
                              `💳 Phương thức: *${withdrawMethod.toUpperCase()}*\n` +
                              `📍 Địa chỉ nhận / STK: \`${withdrawAddress}\`\n` +
                              `📉 Khấu trừ tài sản: -*${amount.toLocaleString()} Xu*\n` +
                              `⏱️ Thời gian hệ thống: ${new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}` +
                              `\n\n*(Lưu ý: Đối với TON Network, Admin thực hiện xét duyệt ngầm và quy đổi dựa theo tỷ giá thực tế)*`;

            try {
                // Thực hiện bắn tin nhắn trực tiếp qua Bot Telegram về tài khoản Admin cấu hình
                await bot.telegram.sendMessage(ADMIN_ID, reportMsg, { parse_mode: 'Markdown' });
            } catch (err) {
                console.error("Lỗi gửi tin nhắn báo cáo tới Admin:", err.message);
                user.coins += amount; // Hoàn trả lại tài sản trên RAM cho khách nếu cổng mạng bot bị nghẽn kết nối
                return res.status(500).json({ error: "❌ Cổng gửi báo cáo tới Admin bị nghẽn, lệnh rút bị tạm hoãn!" });
            }
            break;

        default:
            return res.status(400).json({ error: "Hành động cập nhật tài sản không hợp lệ!" });
    }

    res.json(user);
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==========================================
// 5. TIẾN TRÌNH TỰ ĐỘNG GHI SAO LƯU EXCEL ĐỊNH KỲ TĨNH
// ==========================================
async function triggerAutoBackup() {
    if (userDatabase.size === 0) return;
    try {
        const userList = Array.from(userDatabase.values());
        
        const rows = userList.map(u => ({
            'ID Telegram': u.id, 
            'Username': u.username, 
            'Tên': u.first_name, 
            'Số Dư Xu': u.coins, 
            'Lượt Quay': u.spinsLeft,
            'lastSpinTimestamp': u.lastSpinTimestamp,
            'lastAdsTimestamp': u.lastAdsTimestamp,
            'dailySpinsCount': u.dailySpinsCount,
            'dailyAdsCount': u.dailyAdsCount,
            'lastActiveDate': u.lastActiveDate
        }));
        const worksheet = XLSX.utils.json_to_sheet(rows);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Users');
        XLSX.writeFile(workbook, EXCEL_FILE_PATH);
        console.log(`[Auto-Backup] Đã đồng bộ an toàn dữ liệu của ${userDatabase.size} hội viên vào file Excel.`);
    } catch (e) {
        console.error("Lỗi tiến trình sao lưu tự động hệ thống:", e.message);
    }
}

// ==========================================
// 6. CHỨC NĂNG ĐIỀU HÀNH BOT TELEGRAM (ADMIN CONTROL)
// ==========================================
function isAdminMiddleware(ctx, next) {
    if (ctx.from?.id === ADMIN_ID) return next();
    return ctx.reply('❌ Lệnh này chỉ dành riêng cho Ban Quản Trị.').catch(() => {});
}

bot.start((ctx) => {
    const user = syncUserInMemory(ctx.from.id, ctx.from);
    const welcomeText = `👋 *Xin chào ${ctx.from.first_name}!* \n\n` +
                        `Chào mừng bạn đến với hệ thống *Siêu Cấp Kiếm Xu*.\n` +
                        `💰 Số dư trải nghiệm ban đầu: *${user.coins.toLocaleString()} Xu*\n` +
                        `🎡 Lượt quay sẵn có: *${user.spinsLeft} lượt*\n\n` +
                        `Dữ liệu đã được cấu hình đồng bộ hóa thời gian thực chống hack an toàn 100%. Bấm nút dưới đây để vào ứng dụng cày xu ngay! 👇`;

    return ctx.replyWithMarkdown(welcomeText, Markup.inlineKeyboard([
        [Markup.button.webApp('🚀 Mở Ứng Dụng Kiếm Xu', MY_APP_LINK)]
    ])).catch(() => {});
});

// Lệnh dành riêng cho Admin để kết xuất nhanh file Excel đối soát số dư hội viên
bot.command('saoluu', isAdminMiddleware, async (ctx) => {
    try {
        const userList = Array.from(userDatabase.values());
        if (userList.length === 0) return ctx.reply('⚠️ Cơ sở dữ liệu RAM hiện tại đang trống.');

        const rows = userList.map(u => ({
            'ID Telegram': u.id, 
            'Username': u.username ? `@${u.username}` : 'Không có', 
            'Tên': u.first_name, 
            'Số Dư Xu': u.coins, 
            'Lượt Quay': u.spinsLeft,
            'Lượt xem Ads hôm nay': u.dailyAdsCount
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
        console.error("Lỗi xuất gửi tài liệu dữ liệu:", err.message);
        ctx.reply('❌ Có lỗi xảy ra trong quá trình tạo và gửi file Excel!').catch(() => {});
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
    startSelfPingMechanism(); // Kích hoạt cơ chế giữ máy chủ luôn thức tỉnh liên tục trên Render
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

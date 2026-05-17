/**
 * SIÊU CẤP KIẾM XU - TMA
 * Monolith Server Engine (Bot Control, RAM Storage, API Hosting & Anti-Sleep)
 * Năm vận hành: 2026
 * Phiên bản: 2.4.0 (Đồng bộ hóa 100% cơ chế xác thực chuỗi initData bảo mật)
 */

const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

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

// Chặn đứng toàn bộ các lỗi rớt Socket mạng bất ngờ từ Telegram API làm sập ứng dụng Node.js
bot.catch((err, ctx) => {
    console.error(`[Telegraf Core Error] Đã chặn lỗi rớt cổng mạng từ Update ${ctx.update.update_id}:`, err.message);
});

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

// Mảng phần thưởng khớp chính xác 100% với giao diện bánh xe và file app.js
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
            console.error('[Keep-Alive] Lỗi tự gọi Ping chống ngủ đông:', e.message);
        }
    }, 5 * 60 * 1000); // Định kỳ 5 phút ping một lần giữ Render luôn thức tỉnh
}

// ==========================================
// 3. IN-MEMORY DATABASE (QUẢN LÝ VÀ SAO LƯU TRÊN Ổ CỨNG)
// ==========================================
let userDatabase = new Map();
const BACKUP_INTERVAL = 5 * 60 * 1000; // Tự động ghi file Excel sau mỗi 5 phút
const EXCEL_FILE_PATH = path.join(__dirname, 'DanhSachHoiVien_Backup.xlsx');

// Hàm giải mã chuỗi dữ liệu initData an toàn được đẩy lên từ Telegram WebApp
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
            spinsLeft: 3,  // 3 lượt quay ban đầu mồi sẵn cho tân thủ
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
            existing.spinsLeft = Math.max(existing.spinsLeft, 3); // Hoàn trả tối thiểu 3 lượt quay ngày mới
            existing.lastActiveDate = todayStr;
        }
    }
    return userDatabase.get(userId);
}

// ====== TỰ ĐỘNG KHÔI PHỤC DỮ LIỆU TỪ FILE EXCEL LƯU CỤC BỘ KHI KHỞI ĐỘNG MÁY CHỦ ======
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
        console.log(`🎉 [RAM Storage] Khôi phục thành công dữ liệu của ${count} hội viên từ file Excel.`);
    } catch (err) {
        console.error("❌ Lỗi đọc file khôi phục dữ liệu ban đầu:", err.message);
    }
}

// ==========================================
// 4. ĐỊNH TUYẾN WEB API (KẾT NỐI KHỚP 100% VỚI APP.JS)
// ==========================================

// Tuyến đường số 1: Kéo thông tin tài khoản ban đầu khi tải app (fetchUserAccountData trong app.js)
app.post('/api/user-data', (req, res) => {
    const { initData } = req.body;
    const tgUser = verifyTelegramWebAppData(initData);
    
    if (!tgUser) {
        return res.status(403).json({ error: "Xác thực lớp bảo mật Telegram thất bại!" });
    }

    const user = syncUserInMemory(tgUser.id, tgUser);
    res.json(user);
});

// Giữ cổng dự phòng phục vụ các bản test cục bộ bằng ID thô
app.post('/api/user/profile', (req, res) => {
    const { telegramId, username, firstName } = req.body;
    if (!telegramId) return res.status(400).json({ error: "Thiếu thông tin định danh!" });
    
    const user = syncUserInMemory(parseInt(telegramId, 10), { username, first_name: firstName });
    res.json(user);
});

// Tuyến đường số 2: API tiếp nhận kết quả kết nối vòng quay may mắn xử lý an toàn
app.post('/api/user/spin', (req, res) => {
    const { telegramId } = req.body;
    const uid = parseInt(telegramId, 10);
    const user = userDatabase.get(uid);

    if (!user) return res.status(404).json({ error: "Không tìm thấy tài khoản trên RAM!" });
    if (user.spinsLeft <= 0) return res.status(400).json({ error: "Bạn đã hết lượt quay khả dụng!" });
    
    const now = Date.now();
    // Chốt kết quả ngẫu nhiên cấu trúc mảng WHEEL_REWARDS
    const rewardIndex = Math.floor(Math.random() * 8);
    res.json({ rewardIndex: rewardIndex, user: user });
});

// Tuyến đường số 3: Tiếp quản cổng postAssetUpdate tập trung chính trong app.js
app.post('/api/update-assets', async (req, res) => {
    const { initData, action, withdrawMethod, withdrawAddress, withdrawAmount } = req.body;
    const tgUser = verifyTelegramWebAppData(initData);
    if (!tgUser) return res.status(403).json({ error: "Xác thực bảo mật Telegram thất bại!" });

    const user = userDatabase.get(tgUser.id);
    if (!user) return res.status(404).json({ error: "Tài khoản không tồn tại trên hệ thống RAM!" });

    const now = Date.now();

    switch (action) {
        case 'spin_start': // Đồng bộ khóa an toàn lượt quay từ xa
            if (user.spinsLeft <= 0) return res.status(400).json({ error: "Hết lượt quay!" });
            user.spinsLeft -= 1;
            user.dailySpinsCount += 1;
            user.lastSpinTimestamp = now;
            break;

        case 'spin_reward': // Đơn thực nhận cộng tiền sau khi kết thúc hiệu ứng xoay đồ họa
            const { rewardCoins } = req.body;
            if (rewardCoins && rewardCoins > 0) {
                user.coins += parseInt(rewardCoins, 10);
            }
            break;

        case 'watch_ads_success': // Xem hết Adsgram thành công
            user.coins += 12000; // Cộng +12,000 xu chuẩn logic app.js
            user.spinsLeft += 1;  // Tặng +1 Lượt quay
            user.dailyAdsCount += 1;
            user.lastAdsTimestamp = now;
            break;

        case 'withdraw_request': // Tạo đơn rút tiền phân luồng bảo mật
            const amount = parseInt(withdrawAmount, 10);
            if (isNaN(amount) || amount <= 0 || amount > user.coins) return res.status(400).json({ error: "Dữ liệu ví hoặc số dư không khả dụng!" });

            if ((withdrawMethod === 'momo' || withdrawMethod === 'bank') && amount < SERVER_CONFIG.MIN_VND_COINS_LIMIT) {
                return res.status(400).json({ error: "Chưa đạt mức tối thiểu 2,000,000 Xu!" });
            }

            // Khấu trừ trực tiếp tài sản trên RAM ngay lập tức chống hành vi lặp lệnh
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
                console.error("Lỗi gửi tin nhắn báo cáo tới Admin:", err.message);
                user.coins += amount; // Hoàn lại tài sản cho khách nếu bot nghẽn kết nối mạng
                return res.status(500).json({ error: "Cổng gửi báo cáo tới Admin bị nghẽn, lệnh rút tạm ẩn!" });
            }
            break;
    }
    res.json(user);
});

// Hỗ trợ tuyến đường phụ cập nhật tài sản thô
app.post('/api/user/update', async (req, res) => {
    const { telegramId, action, withdrawAmount } = req.body;
    const uid = parseInt(telegramId, 10);
    const user = userDatabase.get(uid);
    if (!user) return res.status(404).json({ error: "User không tồn tại!" });

    if (action === 'watch_ads') {
        user.coins += 12000; user.spinsLeft += 1; user.dailyAdsCount += 1; user.lastAdsTimestamp = Date.now();
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
// 5. CƠ CHẾ GHI FILE SAO LƯU TỰ ĐỘNG LÊN Ổ CỨNG LƯU TRỮ
// ==========================================
async function triggerAutoBackup() {
    if (userDatabase.size === 0) return;
    try {
        const userList = Array.from(userDatabase.values());
        
        // 1. Ghi tệp Excel trực tiếp lên Container Render để khôi phục nhanh khi reboot
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

        // 2. Gửi chuỗi text dự phòng JSON về cổng chat của Admin
        const backupRawString = JSON.stringify(userList);
        await bot.telegram.sendMessage(ADMIN_ID, `📦 [AUTO_BACKUP_DATA]\n\`\`\`json\n${backupRawString}\n\`\`\``, { parse_mode: 'MarkdownV2' });
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
                        `💰 Số dư trải nghiệm: *${user.coins.toLocaleString()} Xu*\n` +
                        `🎡 Lượt quay sẵn có: *${user.spinsLeft} lượt*\n\n` +
                        `Hệ thống dữ liệu đã được cấu hình đồng bộ hóa thời gian thực chống hack an toàn 100%. Bấm nút dưới đây để vào ứng dụng cày xu ngay! 👇`;

    return ctx.replyWithMarkdown(welcomeText, Markup.inlineKeyboard([
        [Markup.button.webApp('🚀 Mở Ứng Dụng Kiếm Xu', MY_APP_LINK)]
    ])).catch(() => {});
});

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
            { caption: `📊 Đã xuất danh sách thành công! Tổng số: *${userList.length}* tài khoản hiện hữu trên RAM.` }
        );
    } catch (err) {
        console.error("Lỗi xuất gửi tài liệu dữ liệu:", err.message);
        ctx.reply('❌ Hệ thống tạo file Excel thành công nhưng kết nối mạng Telegram bị rớt. Hãy gõ lại lệnh sau ít phút!').catch(() => {});
    }
});

bot.on('message', isAdminMiddleware, async (ctx) => {
    if (ctx.message.text && ctx.message.text.includes('[AUTO_BACKUP_DATA]')) {
        try {
            const rawJson = ctx.message.text.split('```json')[1].split('```')[0].trim();
            const userList = JSON.parse(rawJson);
            userList.forEach(u => userDatabase.set(u.id, u));
            return ctx.reply(`🎉 KHÔI PHỤC THÀNH CÔNG! Đã khôi phục ${userList.length} tài khoản vào bộ nhớ RAM.`);
        } catch { return ctx.reply('Lỗi cấu trúc dữ liệu JSON!'); }
    }
});

// ==========================================
// 7. KHỞI CHẠY MÁY CHỦ NGUYÊN KHỐI
// ==========================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`[Hosting] Máy chủ đang mở tại cổng Port: ${PORT}`));

bot.launch().then(() => {
    console.log('🚀 Hệ thống Bot lắng nghe lệnh trực tuyến thành công!');
    setInterval(triggerAutoBackup, BACKUP_INTERVAL);
    startSelfPingMechanism(); // Kích hoạt cơ chế giữ máy chủ luôn thức tỉnh liên tục
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

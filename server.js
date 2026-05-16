/**
 * SIÊU CẤP KIẾM XU - TMA
 * Monolith Server Engine (Bot Control, RAM Storage, API Hosting & Anti-Sleep)
 * Năm vận hành: 2026
 * Phiên bản: 2.1.0 (Tối ưu đồng bộ & Quản lý đơn rút tiền)
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

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Cấu hình tham số hệ thống
const SERVER_CONFIG = {
    COIN_TO_VND_RATE: 1000,
    MAX_DAILY_SPINS: 10,
    MAX_DAILY_ADS: 5,
    SPIN_COOLDOWN: 30 * 1000, // 30 giây (ms)
    ADS_COOLDOWN: 60 * 1000,  // 60 giây (ms)
    MIN_WITHDRAW_COINS: 2000000 // Tối thiểu 2M xu để rút MoMo/Bank
};

const BACKUP_INTERVAL = 10 * 60 * 1000; // Tự động sao lưu mỗi 10 phút
const EXCEL_BACKUP_PATH = path.join(__dirname, 'user_database_backup.xlsx');

// ==========================================
// 2. RAM CORE STORAGE (Cơ sở dữ liệu lưu tại RAM)
// ==========================================
const userDatabase = new Map();

// Trạng thái mồi mặc định khi có người dùng mới gia nhập
function createNewUser(uid, username, firstName) {
    return {
        id: uid,
        username: username || '',
        first_name: firstName || 'Người chơi',
        coins: 50000, // Tặng sẵn 50,000 Xu trải nghiệm
        spinsLeft: 3,  // Tặng sẵn 3 lượt quay ban đầu
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

// Kiểm tra và đặt lại giới hạn ngày mới (Daily Reset)
function checkAndResetDailyLimits(user) {
    const today = new Date().toISOString().split('T')[0];
    if (user.lastActiveDate !== today) {
        user.dailySpinsCount = 0;
        user.dailyAdsCount = 0;
        user.lastActiveDate = today;
        user.updatedAt = new Date().toISOString();
    }
}

// Khôi phục dữ liệu từ bản sao lưu Excel cũ nếu có sẵn lúc khởi động
(function loadInitialDataFromExcel() {
    try {
        if (fs.existsSync(EXCEL_BACKUP_PATH)) {
            const workbook = XLSX.readFile(EXCEL_BACKUP_PATH);
            const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
            let count = 0;
            rows.forEach(r => {
                const uid = parseInt(r['ID Telegram'] || r['id'], 10);
                if (uid) {
                    userDatabase.set(uid, {
                        id: uid,
                        username: r['Username'] || r['username'] || '',
                        first_name: r['Tên'] || r['first_name'] || 'Người chơi',
                        coins: parseInt(r['Số Dư Xu'] || r['coins'], 10) || 0,
                        spinsLeft: parseInt(r['Lượt Quay'] || r['spinsLeft'], 10) || 0,
                        lastSpinTimestamp: parseInt(r['lastSpinTimestamp'], 10) || 0,
                        lastAdsTimestamp: parseInt(r['lastAdsTimestamp'], 10) || 0,
                        dailySpinsCount: parseInt(r['dailySpinsCount'], 10) || 0,
                        dailyAdsCount: parseInt(r['dailyAdsCount'], 10) || 0,
                        referredBy: r['referredBy'] || null,
                        totalInvited: parseInt(r['totalInvited'], 10) || 0,
                        lastActiveDate: r['lastActiveDate'] || new Date().toISOString().split('T')[0],
                        updatedAt: r['updatedAt'] || new Date().toISOString()
                    });
                    count++;
                }
            });
            console.log(`[RAM Storage] 💾 Khôi phục thành công ${count} người dùng từ file Excel lưu cục bộ.`);
        }
    } catch (err) {
        console.error('[RAM Storage] ❌ Thất bại khi quét file cấu trúc nạp bộ nhớ:', err);
    }
})();

// ==========================================
// 3. TELEGRAM BOT CORE CONTROL
// ==========================================

// Cơ chế lọc mã giới thiệu qua câu lệnh khởi động /start ref_xxxx
bot.start((ctx) => {
    const uid = ctx.from.id;
    const username = ctx.from.username ? ctx.from.username.replace('@', '') : '';
    const firstName = ctx.from.first_name || 'Người chơi';
    const startPayload = ctx.payload; // Lấy chuỗi mã sau lệnh /start

    let isNewUser = false;
    let user = userDatabase.get(uid);

    if (!user) {
        user = createNewUser(uid, username, firstName);
        isNewUser = true;

        // Xử lý logic Ref (Mời bạn bè kiếm xu)
        if (startPayload && startPayload.startsWith('ref_')) {
            const referrerId = parseInt(startPayload.split('_')[1], 10);
            if (referrerId && referrerId !== uid && userDatabase.has(referrerId)) {
                user.referredBy = referrerId;
                
                // Thưởng hoa hồng cho người mời
                const referrer = userDatabase.get(referrerId);
                referrer.coins += 250000; // Tặng 250K Xu cho người mời thành công
                referrer.totalInvited = (referrer.totalInvited || 0) + 1;
                referrer.updatedAt = new Date().toISOString();
                
                // Gửi thông báo ẩn cho người mời nếu bot hoạt động tốt
                bot.telegram.sendMessage(referrerId, `🎉 Bạn đã mời thành công ${firstName}! Nhận ngay +250,000 Xu hoa hồng.`).catch(() => {});
            }
        }
        userDatabase.set(uid, user);
    } else {
        // Cập nhật thông tin mới nhất từ Telegram chat phòng hờ đổi tên/username
        user.username = username;
        user.first_name = firstName;
        user.updatedAt = new Date().toISOString();
    }

    checkAndResetDailyLimits(user);

    const welcomeMsg = `👋 *Chào mừng ${firstName} đến với Siêu Cấp Kiếm Xu\\!*\n\n` +
                       `💰 *Số dư hiện tại:* ${user.coins.toLocaleString()} Xu\n` +
                       `🎡 *Lượt quay khả dụng:* ${user.spinsLeft} lượt\n\n` +
                       `Bấm vào nút dưới đây để mở ứng dụng Web App và bắt đầu kiếm tiền ngay thôi\\!`;

    return ctx.replyWithMarkdownV2(welcomeMsg, Markup.inlineKeyboard([
        [Markup.button.webApp('🚀 Mở Ứng Dụng Kiếm Xu', `${MY_APP_LINK}?uid=${uid}`)]
    ]));
});

// Lệnh ADMIN cứu hộ khẩn cấp: Xuất file dữ liệu RAM trực tiếp qua Chat Telegram
bot.command('backup', (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return ctx.reply('❌ Lệnh này chỉ dành riêng cho Quản trị viên cấp cao nhất.');
    
    triggerAutoBackup();
    if (fs.existsSync(EXCEL_BACKUP_PATH)) {
        return ctx.replyWithDocument({ source: EXCEL_BACKUP_PATH, filename: `Database_Manual_Backup.xlsx` });
    } else {
        return ctx.reply('❌ Không tìm thấy bản ghi dữ liệu nào.');
    }
});

// ==========================================
// 4. RESTFUL API ENDPOINTS (Dành cho Web App FrontEnd)
// ==========================================

// 4.1 API Đồng bộ dữ liệu tài khoản an toàn khi mở Web App
app.post('/api/sync-user', (expressCtx, response) => {
    const { uid } = expressCtx.body;
    const userId = parseInt(uid, 10);

    if (!userId || isNaN(userId)) {
        return response.status(400).json({ success: false, error: "Thiếu thông tin nhận diện tài khoản (UID)." });
    }

    let user = userDatabase.get(userId);
    if (!user) {
        // Hỗ trợ trường hợp mở trực tiếp ứng dụng không qua Bot click Start
        user = createNewUser(userId, "Ẩn Danh", "Người chơi WebApp");
        userDatabase.set(userId, user);
    }

    checkAndResetDailyLimits(user);
    return response.json({ success: true, user });
});

// 4.2 API Hành động: Vòng quay may mắn
app.post('/api/spin-wheel', (req, res) => {
    const { uid } = req.body;
    const userId = parseInt(uid, 10);
    const user = userDatabase.get(userId);

    if (!user) return res.status(404).json({ success: false, error: "Tài khoản không tồn tại." });
    checkAndResetDailyLimits(user);

    const now = Date.now();
    if (now - user.lastSpinTimestamp < SERVER_CONFIG.SPIN_COOLDOWN) {
        return res.json({ success: false, cooldown: true, error: "Thao tác quá nhanh! Vui lòng chờ đếm ngược kết thúc." });
    }

    if (user.spinsLeft <= 0 || user.dailySpinsCount >= SERVER_CONFIG.MAX_DAILY_SPINS) {
        return res.json({ success: false, error: "Bạn đã hết lượt quay khả dụng hoặc đạt giới hạn tối đa hôm nay!" });
    }

    // Thực hiện vòng quay - Tỷ lệ phần thưởng ngẫu nhiên
    const prizes = [10000, 20000, 50000, 100000, 200000, 500000];
    const prizeWon = prizes[Math.floor(Math.random() * prizes.length)];

    user.spinsLeft -= 1;
    user.dailySpinsCount += 1;
    user.coins += prizeWon;
    user.lastSpinTimestamp = now;
    user.updatedAt = new Date().toISOString();

    return res.json({ success: true, prizeWon, user });
});

// 4.3 API Hành động: Xem Ads Adsgram nhận Lượt quay & Xu thưởng
app.post('/api/watch-ads', (req, res) => {
    const { uid } = req.body;
    const userId = parseInt(uid, 10);
    const user = userDatabase.get(userId);

    if (!user) return res.status(404).json({ success: false, error: "Tài khoản không tồn tại." });
    checkAndResetDailyLimits(user);

    const now = Date.now();
    if (now - user.lastAdsTimestamp < SERVER_CONFIG.ADS_COOLDOWN) {
        return res.json({ success: false, cooldown: true, error: "Quảng cáo đang tải, vui lòng đợi thêm chút nữa." });
    }

    if (user.dailyAdsCount >= SERVER_CONFIG.MAX_DAILY_ADS) {
        return res.json({ success: false, error: "Hôm nay bạn đã xem hết số lượng video quảng cáo được phân phối!" });
    }

    // Phần thưởng cố định cho mỗi lượt xem quảng cáo hợp lệ
    user.coins += 100000;  // Cộng 100K xu
    user.spinsLeft += 2;   // Tặng thêm 2 lượt quay
    user.dailyAdsCount += 1;
    user.lastAdsTimestamp = now;
    user.updatedAt = new Date().toISOString();

    return res.json({ success: true, rewardCoins: 100000, rewardSpins: 2, user });
});

// 4.4 API Hành động: Tiếp nhận đơn rút tiền, đẩy thông báo qua Telegram Admin phê duyệt
app.post('/api/withdraw-request', (req, res) => {
    const { uid, withdrawMethod, withdrawAddress, withdrawAmount } = req.body;
    const userId = parseInt(uid, 10);
    const amount = parseInt(withdrawAmount, 10);
    const user = userDatabase.get(userId);

    if (!user) return res.status(404).json({ success: false, error: "Người dùng không tồn tại trong hệ thống bộ nhớ RAM." });
    if (!withdrawAddress || isNaN(amount) || amount <= 0) {
        return res.json({ success: false, error: "Dữ liệu nhập vào không hợp lệ hoặc bị bỏ trống." });
    }

    if ((withdrawMethod === 'momo' || withdrawMethod === 'bank') && amount < SERVER_CONFIG.MIN_WITHDRAW_COINS) {
        return res.json({ success: false, error: `Cảnh báo bảo mật: Cổng MoMo/Ngân Hàng yêu cầu tối thiểu từ ${SERVER_CONFIG.MIN_WITHDRAW_COINS.toLocaleString()} Xu!` });
    }

    if (amount > user.coins) {
        return res.json({ success: false, error: "Yêu cầu bị từ chối! Số dư ví hiện tại không đủ khả dụng để lập lệnh." });
    }

    // Khấu trừ số xu ngay lập tức để tránh tình trạng bug lặp đơn (Double Spending)
    user.coins -= amount;
    user.updatedAt = new Date().toISOString();

    const valueInVnd = amount / SERVER_CONFIG.COIN_TO_VND_RATE;

    // Thiết lập chuỗi tin nhắn mẫu gửi thẳng cho Admin Chat duyệt tiền bằng 1 click
    const notificationToAdmin = `🚨 *YÊU CẦU RÚT TIỀN MỚI CHỜ DUYỆT* 🚨\n\n` +
                                `👤 *Người chơi:* ${user.first_name} (ID: \`${userId}\`)\n` +
                                `📧 *Username:* ${user.username ? '@' + user.username : 'Không có'}\n` +
                                `💳 *Phương thức:* ${withdrawMethod.toUpperCase()}\n` +
                                `📍 *Địa chỉ nhận:* \`${withdrawAddress}\`\n` +
                                `💰 *Số xu rút:* ${amount.toLocaleString()} Xu\n` +
                                `💵 *Giá trị quy đổi:* ${valueInVnd.toLocaleString()} VNĐ\n\n` +
                                `👉 _Vui lòng xác minh kỹ thông tin tài khoản và chuyển tiền thủ công cho người chơi\\._`;

    // Gửi tin nhắn trực tiếp đến tài khoản Telegram Admin
    bot.telegram.sendMessage(ADMIN_ID, notificationToAdmin, { parse_mode: 'MarkdownV2' })
        .then(() => {
            res.json({ success: true, user });
        })
        .catch((err) => {
            console.error("❌ Thất bại khi đẩy tin nhắn thông báo rút tiền cho Admin:", err);
            // Hoàn lại tiền cho người chơi nếu lỗi kết nối hệ thống Bot Telegram xảy ra
            user.coins += amount;
            res.status(500).json({ success: false, error: "Lỗi đồng bộ máy chủ Telegram. Vui lòng thử lại sau ít phút!" });
        });
});

// ==========================================
// 5. CƠ CHẾ SAO LƯU TỰ ĐỘNG CHỐNG "NGỦ ĐÔNG" VÀ MẤT DỮ LIỆU
// ==========================================

// Hàm kích hoạt tạo File Excel lưu trực tiếp trên ổ cứng Container Render
function triggerAutoBackup() {
    try {
        if (userDatabase.size === 0) return;
        const listJson = [];
        userDatabase.forEach((v) => {
            listJson.push({
                'ID Telegram': v.id,
                'Username': v.username,
                'Tên': v.first_name,
                'Số Dư Xu': v.coins,
                'Lượt Quay': v.spinsLeft,
                'lastSpinTimestamp': v.lastSpinTimestamp,
                'lastAdsTimestamp': v.lastAdsTimestamp,
                'dailySpinsCount': v.dailySpinsCount,
                'dailyAdsCount': v.dailyAdsCount,
                'referredBy': v.referredBy,
                'totalInvited': v.totalInvited,
                'lastActiveDate': v.lastActiveDate,
                'updatedAt': v.updatedAt
            });
        });

        const worksheet = XLSX.utils.json_to_sheet(listJson);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'UserDatabase');
        XLSX.writeFile(workbook, EXCEL_BACKUP_PATH);
        console.log(`[Auto-Backup] 📑 Đã sao lưu đồng bộ an toàn ${userDatabase.size} tài khoản ra file Excel lưu trữ.`);
    } catch (e) {
        console.error('[Auto-Backup] ❌ Gặp lỗi nghiêm trọng trong quá trình ghi file Excel:', e);
    }
}

// Hàm Self-Ping: Định kỳ 5 phút gọi chính mình để giữ Server OnRender thức tỉnh liên tục
function startSelfPingMechanism() {
    if (!MY_APP_LINK) return;
    setInterval(() => {
        const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
        fetch(MY_APP_LINK)
            .then(() => console.log('[Anti-Sleep] 🛸 Tự động gửi lệnh Ping kích hoạt đánh thức Server thành công.'))
            .catch((e) => console.error('[Anti-Sleep] ❌ Ping lỗi:', e.message));
    }, 5 * 60 * 1000); 
}

// Tiếp nhận tập tin khôi phục khẩn cấp từ Chat Admin (Kéo thả file .xlsx trực tiếp vào Bot)
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
            let count = 0;
            rows.forEach(r => {
                const uid = parseInt(r['ID Telegram'] || r['id'], 10);
                if (uid) {
                    userDatabase.set(uid, {
                        id: uid,
                        username: r['Username'] || r['username'] || '',
                        first_name: r['Tên'] || r['first_name'] || 'Người chơi',
                        coins: parseInt(r['Số Dư Xu'] || r['coins'], 10) || 0,
                        spinsLeft: parseInt(r['Lượt Quay Còn Lại'] || r['Lượt Quay'] || r['spinsLeft'], 10) || 3,
                        lastSpinTimestamp: parseInt(r['lastSpinTimestamp'], 10) || 0,
                        lastAdsTimestamp: parseInt(r['lastAdsTimestamp'], 10) || 0,
                        dailySpinsCount: parseInt(r['dailySpinsCount'], 10) || 0,
                        dailyAdsCount: parseInt(r['dailyAdsCount'], 10) || 0,
                        referredBy: r['referredBy'] || null,
                        totalInvited: parseInt(r['totalInvited'], 10) || 0,
                        lastActiveDate: r['lastActiveDate'] || new Date().toISOString().split('T')[0],
                        updatedAt: r['updatedAt'] || new Date().toISOString()
                    });
                    count++;
                }
            });
            // Ghi đè lại bản backup lưu cục bộ ngay khi nạp thành công
            triggerAutoBackup();
            return ctx.reply(`🎉 Khôi phục từ file Excel thành công *${count}* người dùng vào RAM.`);
        } catch (err) { 
            return ctx.reply('❌ Thao tác thất bại! File Excel không đúng biểu mẫu cấu trúc dữ liệu.'); 
        }
    }
});

// ==========================================
// 6. KHỞI CHẠY MÁY CHỦ NGUYÊN KHỐI
// ==========================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`[Web Server] Đang mở cổng hosting tại Port: ${PORT}`);
});

bot.launch().then(() => {
    console.log('🚀 [Bot Telegram] Hệ thống lắng nghe lệnh trực tuyến đã sẵn sàng!');
    setInterval(triggerAutoBackup, BACKUP_INTERVAL); // Kích hoạt chu kỳ backup tự động
    startSelfPingMechanism(); // Kích hoạt tự động chống ngủ đông
});

// Đóng bot an toàn khi server bị kill đột ngột
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

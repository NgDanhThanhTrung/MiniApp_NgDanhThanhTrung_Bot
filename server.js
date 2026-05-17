/**
 * SIÊU CẤP KIẾM XU - TMA
 * Monolith Server Engine (Bot Control, RAM Storage, API Hosting & Anti-Sleep)
 * Năm vận hành: 2026
 * Phiên bản: 3.0.0 (Đồng nhất hoàn toàn Query Parameter userId loại bỏ cặp dấu ngoặc vuông)
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
const MY_APP_LINK = process.env.MY_APP_LINK; 

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

// ==========================================
// 2. CƠ SỞ DỮ LIỆU RAM (IN-MEMORY STORAGE ENGINE)
// ==========================================
const userDatabase = new Map();
const BACKUP_FILE = path.join(__dirname, 'user_database_backup.json');
const BACKUP_INTERVAL = 30000; 

const GAME_CONFIG = {
    SPIN_REWARD_MIN: 1000,
    SPIN_REWARD_MAX: 10000,
    ADS_REWARD_COINS: 12000,    
    REFERRAL_REWARD_COINS: 50000, 
    MAX_DAILY_SPINS: 10,
    MAX_DAILY_ADS: 5,
};

function createNewUserObject(userId, username = "Người dùng Telegram") {
    return {
        id: parseInt(userId, 10),
        username: username || `ID: ${userId}`,
        coins: 0,
        spins: 3, 
        dailySpinsCount: 0,
        dailyAdsCount: 0,
        lastSpinTime: 0,
        lastAdsTime: 0,
        lastResetDate: new Date().toDateString(),
        referredBy: null
    };
}

function checkAndResetDailyLimits(user) {
    const today = new Date().toDateString();
    if (user.lastResetDate !== today) {
        user.dailySpinsCount = 0;
        user.dailyAdsCount = 0;
        user.lastResetDate = today;
        return true;
    }
    return false;
}

// ==========================================
// 3. XỬ LÝ EVENT BOT TELEGRAM & BÓC TÁCH MÃ REF
// ==========================================
bot.start(async (ctx) => {
    const userId = ctx.from.id;
    const username = ctx.from.username || ctx.from.first_name || "Hội viên";
    const startPayload = ctx.payload ? ctx.payload.trim() : "";
    
    let isNewUser = false;
    let user = userDatabase.get(userId);

    if (!user) {
        user = createNewUserObject(userId, username);
        userDatabase.set(userId, user);
        isNewUser = true;

        if (startPayload && !isNaN(startPayload)) {
            const referrerId = parseInt(startPayload, 10);
            
            if (referrerId !== userId && userDatabase.has(referrerId)) {
                user.referredBy = referrerId;
                
                const referrer = userDatabase.get(referrerId);
                referrer.coins += GAME_CONFIG.REFERRAL_REWARD_COINS;
                
                bot.telegram.sendMessage(referrerId, `🔔 **Chúc mừng!** Tài khoản \`@${username}\` đã kích hoạt Bot thông qua link mời của bạn.\n💰 Bạn được cộng ngay **+${GAME_CONFIG.REFERRAL_REWARD_COINS.toLocaleString()} Xu** vào số dư RAM!`).catch(() => {});
            }
        }
    } else {
        user.username = username;
        checkAndResetDailyLimits(user);
    }

    const welcomeMsg = isNewUser 
        ? `🎉 **Chào mừng bạn đến với Siêu Cấp Kiếm Xu TMA!**\n\n📱 Ứng dụng đào xu kiếm tiền Web3 thế hệ mới đã được tích hợp trực tiếp vào Telegram của bạn. Hãy bấm nút dưới đây để bắt đầu quay thưởng và xem Ads kiếm tiền.`
        : `👋 **Chào mừng trở lại, ${username}!**\n\n📊 Trạng thái tài khoản của bạn luôn được đồng bộ trực tuyến trên bộ nhớ RAM an toàn. Hãy tiếp tục cày cuốc nào!`;

    return ctx.replyWithMarkdownV2(
        welcomeMsg.replace(/_/g, '\\_').replace(/\*/g, '\\*').replace(/\[/g, '\\[').replace(/\]/g, '\\\]').replace(/\./g, '\\.').replace(/-/g, '\\-').replace(/!/g, '\\!'),
        Markup.inlineKeyboard([
            [Markup.button.webApp('🎮 Mở Ứng Dụng Mini App', MY_APP_LINK)]
        ])
    );
});

bot.command('me', (ctx) => {
    const user = userDatabase.get(ctx.from.id);
    if (!user) return ctx.reply('❌ Bạn chưa khởi tạo dữ liệu! Vui lòng gõ lệnh /start trước.');
    
    checkAndResetDailyLimits(user);
    ctx.replyWithMarkdown(`📊 **THÔNG TIN TÀI KHOẢN CỦA BẠN:**\n\n🆔 ID: \`${user.id}\`\n👤 Tên: *${user.username}*\n💰 Số dư: *${user.coins.toLocaleString()} Xu*\n🎡 Lượt quay khả dụng: *${user.spins} lượt*\n📺 Đã xem Ads hôm nay: *${user.dailyAdsCount}/${GAME_CONFIG.MAX_DAILY_ADS}*`);
});

// ==========================================
// 4. HỆ THỐNG API ROUTING HOSTING (EXPRESS API)
// ==========================================

// API 1: Đồng bộ dữ liệu người dùng ban đầu khi nạp giao diện Mini App
app.get('/api/user/status', (expressCtx) => {
    const userId = parseInt(expressCtx.query.userId, 10);
    const username = expressCtx.query.username || "Hội viên";

    if (isNaN(userId)) return expressCtx.status(400).json({ error: "Thiếu thông tin tham số định danh Telegram ID!" });

    let user = userDatabase.get(userId);
    if (!user) {
        user = createNewUserObject(userId, username);
        userDatabase.set(userId, user);
    }
    
    checkAndResetDailyLimits(user);
    return expressCtx.json(user);
});

// API 2: Xử lý và tính toán biến động tài sản (Đã chuyển hoàn chỉnh sang expressCtx.query.userId sạch)
app.post('/api/user/update', (expressCtx) => {
    // ĐỒNG NHẤT: Đón nhận chính xác key 'userId', loại bỏ hoàn toàn bóc tách dấu ngoặc vuông cũ
    const userId = parseInt(expressCtx.query.userId, 10);
    const action = expressCtx.query.action;

    if (isNaN(userId)) return expressCtx.status(400).json({ error: "Định danh ID người chơi không hợp lệ!" });

    const user = userDatabase.get(userId);
    if (!user) return expressCtx.status(404).json({ error: "Hội viên chưa đăng ký trên hệ thống RAM!" });

    checkAndResetDailyLimits(user);
    const now = Date.now();

    // LUỒNG VÒNG QUAY MAY MẮN
    if (action === 'lucky_spin') {
        if (user.spins <= 0) return expressCtx.status(400).json({ error: "Bạn đã hết lượt quay khả dụng!" });
        if (user.dailySpinsCount >= GAME_CONFIG.MAX_DAILY_SPINS) return expressCtx.status(400).json({ error: "Đạt giới hạn lượt quay tối đa trong ngày!" });

        user.spins -= 1;
        user.dailySpinsCount += 1;
        
        const rewardCoins = Math.floor(Math.random() * (GAME_CONFIG.SPIN_REWARD_MAX - GAME_CONFIG.SPIN_REWARD_MIN + 1)) + GAME_CONFIG.SPIN_REWARD_MIN;
        user.coins += rewardCoins;
        user.lastSpinTime = now;

        return expressCtx.json(user);
    }

    // LUỒNG THƯỞNG XEM QUẢNG CÁO ADSGRAM THÀNH CÔNG (Chống hack cooldown)
    if (action === 'watch_ads_success') {
        if (user.dailyAdsCount >= GAME_CONFIG.MAX_DAILY_ADS) {
            return expressCtx.status(400).json({ error: "Bạn đã xem hết 5 lượt quảng cáo giới hạn của ngày hôm nay!" });
        }

        if (now - user.lastAdsTime < 60000) {
            return expressCtx.status(400).json({ error: "Hệ thống đang nghẽn hoặc bạn thao tác quá nhanh. Vui lòng đợi 1 phút!" });
        }

        user.dailyAdsCount += 1;
        user.coins += GAME_CONFIG.ADS_REWARD_COINS;
        user.spins += 1; 
        user.lastAdsTime = now;

        return expressCtx.json(user);
    }

    // LUỒNG TẠO ĐƠN YÊU CẦU RÚT TIỀN
    if (action === 'withdraw_request') {
        const { withdrawMethod, withdrawAddress, withdrawAmount } = expressCtx.body;
        const amount = parseInt(withdrawAmount, 10);

        if (!withdrawAddress || isNaN(amount) || amount <= 0) {
            return expressCtx.status(400).json({ error: "Dữ liệu nhập đơn rút tiền không hợp lệ!" });
        }
        if (amount > user.coins) {
            return expressCtx.status(400).json({ error: "Số dư tài khoản của bạn hiện tại không đủ để rút!" });
        }

        user.coins -= amount;

        bot.telegram.sendMessage(ADMIN_ID, `💵 **ĐƠN YÊU CẦU RÚT TIỀN MỚI PENDING!**\n\n👤 Hội viên: \`@${user.username}\`\n🆔 Telegram ID: \`${user.id}\`\n🏦 Phương thức: *${withdrawMethod.toUpperCase()}*\n💳 Địa chỉ/STK: \`${withdrawAddress}\`\n💰 Số lượng rút: *${amount.toLocaleString()} Xu*\n\n👉 *Hãy kiểm tra đối chiếu file Excel hoặc số dư RAM và chuyển khoản thủ công cho hội viên.*`).catch((e) => console.error("Lỗi gửi tin nhắn duyệt cho Admin:", e.message));

        return expressCtx.json(user);
    }

    return expressCtx.status(400).json({ error: "Hành động cập nhật tài sản không được hỗ trợ!" });
});

// ==========================================
// 5. CƠ CHẾ SAO LƯU TỰ ĐỘNG & KHÔI PHỤC DỮ LIỆU CHỐNG SẬP
// ==========================================
async function triggerAutoBackup() {
    try {
        if (userDatabase.size === 0) return;
        const exportData = Array.from(userDatabase.entries());
        await fs.promises.writeFile(BACKUP_FILE, JSON.stringify(exportData, null, 2), 'utf-8');
    } catch (err) {
        console.error("Lỗi tiến trình ghi file tự động sao lưu dữ liệu RAM:", err.message);
    }
}

function loadDatabaseFromLocalBackup() {
    try {
        if (fs.existsSync(BACKUP_FILE)) {
            const dataRaw = fs.readFileSync(BACKUP_FILE, 'utf-8');
            const importedArray = JSON.parse(dataRaw);
            for (const [key, value] of importedArray) {
                userDatabase.set(key, value);
            }
            console.log(`[Database RAM] Khôi phục thành công dữ liệu của ${userDatabase.size} tài khoản từ tệp tin JSON dự phòng cũ.`);
        } else {
            console.log("[Database RAM] Không phát hiện tệp tin sao lưu cũ. Hệ thống khởi chạy vùng nhớ RAM trống mới.");
        }
    } catch (err) {
        console.error("Lỗi nghiêm trọng khi đọc tệp tin JSON khôi phục dữ liệu đầu:", err.message);
    }
}

loadDatabaseFromLocalBackup();

// ==========================================
// 6. TÍNH NĂNG ADMIN CAO CẤP: EXCEL ON BOT
// ==========================================
function loadRowsIntoDatabase(rows) {
    let successCount = 0;
    rows.forEach(row => {
        const rawId = row['ID telegram'] || row['ID Telegram'] || row['id'] || row['ID'];
        const rawSpins = row['Lượt quay còn lại'] || row['Spins'] || row['lượt quay'];
        const rawCoins = row['số Xu/coin'] || row['Coins'] || row['xu'];
        const rawUsername = row['Tên tài khoản'] || row['Username'] || row['username'];

        if (rawId && !isNaN(rawId)) {
            const uId = parseInt(rawId, 10);
            const coinsCount = !isNaN(rawCoins) ? parseInt(rawCoins, 10) : 0;
            const spinsCount = !isNaN(rawSpins) ? parseInt(rawSpins, 10) : 0;

            let existingUser = userDatabase.get(uId);
            if (!existingUser) {
                existingUser = createNewUserObject(uId, rawUsername || `Imported_${uId}`);
            }
            
            existingUser.coins = coinsCount;
            existingUser.spins = spinsCount;
            if (rawUsername) existingUser.username = rawUsername;

            userDatabase.set(uId, existingUser);
            successCount++;
        }
    });
    return successCount;
}

bot.command('export_excel', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return ctx.reply('❌ Lệnh tối mật này chỉ dành riêng cho Admin tối cao!');
    if (userDatabase.size === 0) return ctx.reply('⚠️ Cơ sở dữ liệu RAM hiện tại đang trống, không thể xuất file!');

    try {
        const excelRows = Array.from(userDatabase.values()).map(user => ({
            'ID telegram': user.id,
            'Tên tài khoản': user.username,
            'số Xu/coin': user.coins,
            'Lượt quay còn lại': user.spins,
            'Lượt Ads trong ngày': user.dailyAdsCount,
            'Lượt quay trong ngày': user.dailySpinsCount
        }));

        const worksheet = XLSX.utils.json_to_sheet(excelRows);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Danh sách Hội viên');

        const tempFilePath = path.join(__dirname, `UserDB_Backup_${Date.now()}.xlsx`);
        XLSX.writeFile(workbook, tempFilePath);

        await ctx.replyWithDocument({ source: tempFilePath, filename: 'Danh_Sach_Hoi_Vien_Cay_Xu.xlsx' }, {
            caption: `📊 **BÁO CÁO CƠ SỞ DỮ LIỆU EXCEL REALTIME**\n\n📈 Tổng số tài khoản trên RAM: *${userDatabase.size}*\n🕒 Xuất file lúc: _${new Date().toLocaleString()}_`
        });

        fs.unlinkSync(tempFilePath); 
    } catch (err) {
        console.error("Lỗi khi xuất file Excel:", err.message);
        ctx.reply('❌ Có lỗi phát sinh trong quá trình biên dịch file Excel!');
    }
});

bot.on('document', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;

    const file = ctx.message.document;
    if (!file.file_name.endsWith('.xlsx')) {
        return ctx.reply('⚠️ Định dạng file không hợp lệ! Admin vui lòng chỉ gửi file có đuôi mở rộng dạng `.xlsx`.');
    }

    try {
        ctx.reply('🔄 Đang xử lý bóc tách file Excel và đồng bộ vào bộ nhớ RAM...');
        const fileLink = await bot.telegram.getFileLink(file.file_id);
        
        const response = await fetch(fileLink.href);
        const arrayBuffer = await response.arrayBuffer();
        
        const workbook = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array' });
        const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
        
        const restoredCount = loadRowsIntoDatabase(rows);

        if (restoredCount > 0) {
            await triggerAutoBackup();
            return ctx.reply(`🎉 **ĐỒNG BỘ THÀNH CÔNG!**\n📊 Hệ thống đã nhận diện cấu trúc và nạp thành công dữ liệu của *${restoredCount}* tài khoản vào bộ nhớ RAM.`);
        } else {
            return ctx.reply('❌ Thao tác thất bại! File Excel gửi lên trống hoặc không chứa tên tiêu đề các cột hợp lệ.');
        }
    } catch (err) {
        console.error("Lỗi khi import file Excel:", err.message);
        ctx.reply(`❌ Quá trình đọc file lỗi: ${err.message}.`);
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
});

process.once('SIGINT', () => {
    bot.stop('SIGINT');
    triggerAutoBackup().then(() => process.exit(0));
});
process.once('SIGTERM', () => {
    bot.stop('SIGTERM');
    triggerAutoBackup().then(() => process.exit(0));
});

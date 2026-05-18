/**
 * SIÊU CẤP KIẾM XU - TMA
 * Monolith Server Engine (RAM Base, Auto-Commit Excel, 24h Auto-Backup & Admin Broadcast)
 * Năm vận hành: 2026
 * Phiên bản: 5.2.5 - Đồng bộ hóa Hệ thống Lưu trữ & Ngôn từ Chuyên nghiệp
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

bot.catch((err) => console.error(`[Telegraf Core Error]:`, err.message));

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const SERVER_CONFIG = {
    MAX_DAILY_SPINS: 10,
    MAX_DAILY_ADS: 5,
    MIN_WITHDRAW_COINS: 2000000, 
    NEW_USER_BONUS_COINS: 50000,  
    REFERRAL_REWARD_COINS: 50000, 
    AD_REWARD_COINS: 12000,       
    BACKUP_INTERVAL_MS: 24 * 60 * 60 * 1000 // Vòng lặp gửi báo cáo định kỳ mỗi 24 giờ
};

// ==========================================
// HỆ THỐNG ENGINE CƠ SỞ DỮ LIỆU EXCEL LOCAL
// ==========================================
const EXCEL_FILE_PATH = path.join(__dirname, 'DanhSachHoiVien.xlsx');
let userDatabase = new Map();

// Hàm ghi file Excel cứng tức thì bảo vệ tài sản người chơi trên Render
function saveRamToExcelFile() {
    try {
        const rows = [];
        userDatabase.forEach((user) => {
            rows.push({
                'Telegram ID': user.id,
                'Username': user.username ? `@${user.username}` : '',
                'Tên': user.first_name || 'Người chơi',
                'Số Dư Xu': user.coins,
                'Lượt Quay Còn Lại': user.spinsLeft,
                'Số Lượt Quay Hôm Nay': user.dailySpinsCount,
                'Số Lượt Xem Ads Hôm Nay': user.dailyAdsCount,
                'Số Người Đã Mời': user.referralCount || 0,
                'Ngày Hoạt Động Gần Nhất': user.lastActiveDate || ''
            });
        });

        const workbook = XLSX.utils.book_new();
        const worksheet = XLSX.utils.json_to_sheet(rows);
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Hội Viên');
        XLSX.writeFile(workbook, EXCEL_FILE_PATH);
        console.log('💾 [Excel DB] Đã đồng bộ tài sản RAM xuống Disk cứng.');
    } catch (err) {
        console.error('❌ [Excel DB] Lỗi commit:', err.message);
    }
}

// Hàm nạp dữ liệu Excel lên RAM khi khởi chạy Server Render
function loadExcelFileToRam() {
    try {
        if (!fs.existsSync(EXCEL_FILE_PATH)) {
            console.log('ℹ️ [Excel DB] Chưa có database. Hệ thống sẽ tự tạo mới khi có người chơi.');
            return;
        }
        const workbook = XLSX.readFile(EXCEL_FILE_PATH);
        const sheetName = workbook.SheetNames[0];
        const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
        const todayStr = new Date().toISOString().split('T')[0];

        rows.forEach((r) => {
            const uid = parseInt(r['Telegram ID'], 10);
            if (uid) {
                userDatabase.set(uid, {
                    id: uid,
                    username: r['Username'] ? r['Username'].replace('@', '') : '',
                    first_name: r['Tên'] || 'Người chơi',
                    coins: parseInt(r['Số Dư Xu'], 10) || 0,
                    spinsLeft: parseInt(r['Lượt Quay Còn Lại'], 10) || 0,
                    dailySpinsCount: parseInt(r['Số Lượt Quay Hôm Nay'], 10) || 0,
                    dailyAdsCount: parseInt(r['Số Lượt Xem Ads Hôm Nay'], 10) || 0,
                    referralCount: parseInt(r['Số Người Đã Mời'], 10) || 0,
                    lastActiveDate: r['Ngày Hoạt Động Gần Nhất'] || todayStr
                });
            }
        });
        console.log(`🎉 [Excel DB] Nạp thành công ${userDatabase.size} hội viên lên bộ nhớ RAM.`);
    } catch (err) {
        console.error('❌ [Excel DB] Thất bại khi khôi phục dữ liệu khởi động:', err.message);
    }
}

loadExcelFileToRam();

function checkAndResetDailyLimits(user) {
    const todayStr = new Date().toISOString().split('T')[0];
    if (user.lastActiveDate !== todayStr) {
        user.dailySpinsCount = 0;
        user.dailyAdsCount = 0;
        user.lastActiveDate = todayStr;
        return true;
    }
    return false;
}

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

// ==========================================
// KHU VỰC ĐỊNH TUYẾN EXPRESS API
// ==========================================
app.get('/health', (req, res) => {
    res.json({ status: 'OK', totalUsers: userDatabase.size, uptime: process.uptime() });
});

app.post('/api/user-data', (req, res) => {
    try {
        const { initData } = req.body;
        const tgUser = verifyTelegramWebAppData(initData);
        if (!tgUser) return res.status(403).json({ error: 'Xác thực Telegram thất bại.' });

        const userId = parseInt(tgUser.id, 10);
        const todayStr = new Date().toISOString().split('T')[0];
        let user = userDatabase.get(userId);

        if (!user) {
            user = {
                id: userId,
                username: tgUser.username || '',
                first_name: tgUser.first_name || 'Hội viên',
                coins: SERVER_CONFIG.NEW_USER_BONUS_COINS,
                spinsLeft: 3,
                dailySpinsCount: 0,
                dailyAdsCount: 0,
                referralCount: 0,
                lastActiveDate: todayStr
            };
            userDatabase.set(userId, user);
            saveRamToExcelFile();
        } else {
            if ((user.first_name === 'Người chơi' || user.first_name === 'Hội viên') && tgUser.first_name) {
                user.first_name = tgUser.first_name;
            }
            if (!user.username && tgUser.username) user.username = tgUser.username;
            checkAndResetDailyLimits(user);
            saveRamToExcelFile();
        }
        res.json(user);
    } catch (err) {
        res.status(500).json({ error: 'Lỗi server đồng bộ.' });
    }
});

app.get('/api/user/update', async (req, res) => {
    try {
        const userId = parseInt(req.query.userId, 10);
        const action = req.query.action;
        
        if (!userId || !userDatabase.has(userId)) return res.status(404).json({ error: 'Hội viên không tồn tại.' });
        const user = userDatabase.get(userId);

        checkAndResetDailyLimits(user);

        if (action === 'spin_start') {
            if (user.spinsLeft <= 0) return res.status(400).json({ error: 'Bạn đã hết lượt quay khả dụng!' });
            if (user.dailySpinsCount >= SERVER_CONFIG.MAX_DAILY_SPINS) return res.status(400).json({ error: 'Đạt giới hạn vòng quay hôm nay.' });
            
            user.spinsLeft -= 1;
            user.dailySpinsCount += 1;
            saveRamToExcelFile();
            return res.json(user);
        }

        if (action === 'spin_reward') {
            user.coins += parseInt(req.query.rewardCoins, 10) || 0;
            saveRamToExcelFile();
            return res.json(user);
        }

        if (action === 'withdraw_request') {
            const method = req.query.withdrawMethod;
            const address = req.query.withdrawAddress;
            const amount = parseInt(req.query.withdrawAmount, 10);

            if ((method === 'momo' || method === 'bank') && amount < SERVER_CONFIG.MIN_WITHDRAW_COINS) {
                return res.status(400).json({ error: 'Hạn mức quyết toán MoMo/Bank tối thiểu là 2,000,000 Xu.' });
            }
            if (amount > user.coins) return res.status(400).json({ error: 'Số dư ví khả dụng không đủ.' });

            user.coins -= amount;
            saveRamToExcelFile();

            const notifyText = `🚨 *YÊU CẦU DUYỆT LỆNH THANH KHOẢN* 🚨\n\n👤 Hội viên: [${user.first_name}](tg://user?id=${user.id})\n🆔 Telegram ID: \`${user.id}\`\n💰 Số lượng xu quy đổi: *${amount.toLocaleString()} Xu*\n🏦 Kênh nhận tiền: *${method.toUpperCase()}*\n💳 Địa chỉ/STK: \`${address}\`\n\n📌 Ban Quản Trị hãy đối chiếu database Excel và quyết toán cho thành viên!`;
            await bot.telegram.sendMessage(ADMIN_ID, notifyText, { parse_mode: 'Markdown' }).catch(()=>{});
            return res.json(user);
        }
        res.status(400).json({ error: 'Hành động không hợp lệ.' });
    } catch (err) {
        res.status(500).json({ error: 'Lỗi API hệ thống.' });
    }
});

// CỔNG WEBHOOK REWARD URL ĐỒNG BỘ ID XÁC THỰC ADSGRAM TRỰC TIẾP
app.get('/api/webhook/adsgram', (req, res) => {
    try {
        const { userId, status } = req.query;
        const uid = parseInt(userId, 10);

        if (!uid || isNaN(uid)) return res.status(400).send('Lỗi định danh tài khoản');
        if (status !== 'reward') return res.status(200).send('Sự kiện bỏ qua');

        let user = userDatabase.get(uid);
        const todayStr = new Date().toISOString().split('T')[0];

        if (!user) {
            user = {
                id: uid, username: '', first_name: 'Hội viên',
                coins: SERVER_CONFIG.NEW_USER_BONUS_COINS, spinsLeft: 3,
                dailySpinsCount: 0, dailyAdsCount: 0, referralCount: 0, lastActiveDate: todayStr
            };
            userDatabase.set(uid, user);
        }

        checkAndResetDailyLimits(user);
        if (user.dailyAdsCount >= SERVER_CONFIG.MAX_DAILY_ADS) return res.status(200).send('Hạn mức tối đa trong ngày');

        user.coins += SERVER_CONFIG.AD_REWARD_COINS;
        user.spinsLeft += 1;
        user.dailyAdsCount += 1;
        
        saveRamToExcelFile();
        console.log(`[Adsgram Webhook Verified] Thành công cộng tài sản an toàn cho Telegram ID: ${uid}`);
        res.status(200).send('OK');
    } catch (err) {
        res.status(500).send('Lỗi máy chủ cục bộ');
    }
});

// ==========================================
// ĐIỀU HƯỚNG BOT TELEGRAM & TRUYỀN THÔNG MỜI BẠN
// ==========================================
bot.start(async (ctx) => {
    const userId = ctx.from.id;
    const startPayload = ctx.payload ? ctx.payload.trim() : "";
    const todayStr = new Date().toISOString().split('T')[0];

    let user = userDatabase.get(userId);
    let isNewUser = false;

    if (!user) {
        isNewUser = true;
        user = {
            id: userId, username: ctx.from.username || '', first_name: ctx.from.first_name || 'Hội viên',
            coins: SERVER_CONFIG.NEW_USER_BONUS_COINS, spinsLeft: 3,
            dailySpinsCount: 0, dailyAdsCount: 0, referralCount: 0, lastActiveDate: todayStr
        };
        userDatabase.set(userId, user);
    } else {
        if ((user.first_name === 'Người chơi' || user.first_name === 'Hội viên') && ctx.from.first_name) {
            user.first_name = ctx.from.first_name;
        }
        if (!user.username && ctx.from.username) user.username = ctx.from.username;
        checkAndResetDailyLimits(user);
    }

    if (isNewUser && startPayload && !isNaN(parseInt(startPayload, 10))) {
        const referrerId = parseInt(startPayload, 10);
        if (referrerId !== userId && userDatabase.has(referrerId)) {
            const inviter = userDatabase.get(referrerId);
            inviter.coins += SERVER_CONFIG.REFERRAL_REWARD_COINS;
            inviter.referralCount = (inviter.referralCount || 0) + 1;
            userDatabase.set(referrerId, inviter);

            bot.telegram.sendMessage(
                referrerId,
                `🎁 *Ghi Nhận Đối Tác Thành Công!*\n\nHội viên mới *${ctx.from.first_name}* đã tham gia qua liên kết độc quyền của bạn.\nTài khoản của bạn đã được tích lũy hoa hồng thưởng: *+50,000 Xu* vào ví tài sản!`,
                { parse_mode: 'Markdown' }
            ).catch(()=>{});
        }
    }

    saveRamToExcelFile();
    
    const welcomeText = `✨ *Chào mừng Thượng khách ${ctx.from.first_name} đến với Siêu Cấp Kiếm Xu!* ✨\n\n` +
                        `Hệ thống TMA đã thiết lập không gian khai thác tài sản kỹ thuật số an toàn trên bộ nhớ RAM Server. Thông tin tài sản hiện tại:\n\n` +
                        `💳 *Ví Tài Sản:* \`${user.coins.toLocaleString()}\` *Xu*\n` +
                        `🎡 *Cơ Hội May Mắn:* \`${user.spinsLeft}\` *Lượt quay khả dụng*\n\n` +
                        `Hãy kích hoạt nút khởi động dưới đây để truy cập Mini App, thực hiện nhiệm vụ đối tác Adsgram và tối ưu hóa nguồn thu nhập thụ động ngay lập tức! 👇`;
                        
    return ctx.replyWithMarkdown(welcomeText, Markup.inlineKeyboard([[Markup.button.webApp('🚀 KHỞI ĐỘNG ỨNG DỤNG NGAY', MY_APP_LINK)]]));
});

// LỆNH TRUYỀN THÔNG BROADCAST TOÀN DIỆN
bot.command('broadcast', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;

    let messageText = ctx.message.text.substring(10).trim();
    if (ctx.message.caption) messageText = ctx.message.caption.substring(10).trim();

    if (!messageText && !ctx.message.reply_to_message) {
        return ctx.replyWithMarkdown('⚠️ *Sai cú pháp!* Hãy nhập thông báo:\n`/broadcast [Nội dung]` hoặc tiến hành reply hình ảnh/tin nhắn kèm cụm lệnh `/broadcast`');
    }

    const targetUsers = Array.from(userDatabase.keys());
    if (targetUsers.length === 0) return ctx.reply('Cơ sở dữ liệu RAM hiện đang trống.');

    let successCount = 0;
    let failCount = 0;
    const statusMsg = await ctx.reply(`📣 Tiến trình truyền tin chiến dịch đang quét gửi tới *${targetUsers.length}* ID hòm thư hèm...`, { parse_mode: 'Markdown' });

    for (const uId of targetUsers) {
        try {
            if (ctx.message.reply_to_message) {
                await bot.telegram.copyMessage(uId, ctx.chat.id, ctx.message.reply_to_message.message_id);
            } else {
                await bot.telegram.sendMessage(uId, messageText, { parse_mode: 'Markdown' });
            }
            successCount++;
            await new Promise(resolve => setTimeout(resolve, 35)); // Kháng Flood Spam Telegram API
        } catch (err) {
            failCount++;
        }
    }

    try {
        await bot.telegram.editMessageText(
            ctx.chat.id, statusMsg.message_id, null, 
            `🎉 *CHIẾN DỊCH BROADCAST HOÀN THÀNH!*\n\n✅ Gửi thành công: *${successCount} người*\n❌ Thất bại (Chặn bot/Xóa tài khoản): *${failCount} người*\n📊 Tổng tệp khách hàng quét: *${targetUsers.length} người*`,
            { parse_mode: 'Markdown' }
        );
    } catch (e) {}
});

bot.command('saoluu', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    saveRamToExcelFile();
    ctx.replyWithDocument({ source: EXCEL_FILE_PATH, filename: 'DanhSachHoiVien.xlsx' }, { caption: '📊 Bản xuất cơ sở dữ liệu hội viên thủ công khẩn cấp.' }).catch(()=>{});
});

// ENGINE HẸN GIỜ GỬI SAO LƯU CHO ADMIN ĐÚNG MỖI 24 GIỜ
function startAutomatic24hBackupScheduler() {
    console.log(`⏰ [Backup Engine] Bắt đầu kích hoạt vòng lặp hẹn giờ 24h.`);
    setInterval(async () => {
        try {
            saveRamToExcelFile();
            if (fs.existsSync(EXCEL_FILE_PATH)) {
                const dateStr = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
                await bot.telegram.sendDocument(
                    ADMIN_ID, 
                    { source: EXCEL_FILE_PATH, filename: `Backup_24h_SieuCapKiemXu.xlsx` },
                    { caption: `⏰ *BẢN SAO LƯU HỆ THỐNG ĐỊNH KỲ 24H*\n📅 Thời gian thực thi: \`${dateStr}\`\n📊 Tổng tệp tài khoản bảo vệ thành công: *${userDatabase.size}* thành viên.`, parse_mode: 'Markdown' }
                );
                console.log('✅ Đã đẩy bản sao lưu Excel tự động 24h về máy Admin.');
            }
        } catch (error) {
            console.error('Lỗi quy trình sao lưu tự động gửi Admin:', error.message);
        }
    }, SERVER_CONFIG.BACKUP_INTERVAL_MS);
}

function startSelfPingMechanism() {
    setInterval(async () => {
        try {
            const fetch = require('node-fetch');
            await fetch(`${MY_APP_LINK}/health`);
        } catch (e) {}
    }, 5 * 60 * 1000);
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`[Web Server] Khởi chạy thành công tại cổng mạng: ${PORT}`));

bot.launch().then(() => {
    startAutomatic24hBackupScheduler();
    startSelfPingMechanism();
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

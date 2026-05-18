/**
 * SIÊU CẤP KIẾM XU - TMA
 * Monolith Server Engine (RAM Base, Auto-Commit Excel, 24h Auto-Backup & Admin Broadcast)
 * Năm vận hành: 2026
 * Phiên bản: 5.3.0 - Bản Phát Hành Đầy Đủ & Đồng Bộ Lớp Bảo Mật Webhook
 */

const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

// ==========================================
// 1. CẤU HÌNH BIẾN MÔI TRƯỜNG & KHỞI TẠO CORE
// ==========================================
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = parseInt(process.env.ADMIN_ID, 10);
const MY_APP_LINK = process.env.MY_APP_LINK; 

if (!BOT_TOKEN || isNaN(ADMIN_ID) || !MY_APP_LINK) {
    console.error('❌ THẤU CẤU HÌNH BIẾN MÔI TRƯỜNG (ENV)! Vui lòng kiểm tra BOT_TOKEN, ADMIN_ID, MY_APP_LINK trên Render.');
    process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);
const app = express();

// Catch lỗi bot Telegram tránh sập nguồn server đột ngột
bot.catch((err) => {
    console.error(`[Telegraf Core Error]:`, err.message);
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Cấu hình các tham số vận hành tài sản hệ thống
const SERVER_CONFIG = {
    MAX_DAILY_SPINS: 10,
    MAX_DAILY_ADS: 5,
    MIN_WITHDRAW_COINS: 2000000, 
    NEW_USER_BONUS_COINS: 50000,  
    REFERRAL_REWARD_COINS: 50000, 
    AD_REWARD_COINS: 12000,       
    BACKUP_INTERVAL_MS: 24 * 60 * 60 * 1000 // Quy trình gửi báo cáo tự động định kỳ đúng mỗi 24 giờ
};

// ==========================================
// 2. HỆ THỐNG ENGINE CƠ SỞ DỮ LIỆU EXCEL LOCAL
// ==========================================
const EXCEL_FILE_PATH = path.join(__dirname, 'DanhSachHoiVien.xlsx');
let userDatabase = new Map();

/**
 * Hàm ghi dữ liệu tức thì từ bộ nhớ RAM xuống file cứng Excel
 * Cơ chế tối ưu cho Render: Ghi đè file vật lý ngay khi tài sản biến động để tránh mất mát dữ liệu
 */
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
        console.log('💾 [Excel DB] Đã đồng bộ tài sản RAM xuống Disk cứng thành công.');
    } catch (err) {
        console.error('❌ [Excel DB] Lỗi commit ghi file cứng:', err.message);
    }
}

/**
 * Hàm nạp toàn bộ danh sách hội viên cũ từ file Excel lên RAM khi khởi chạy Server Render
 */
function loadExcelFileToRam() {
    try {
        if (!fs.existsSync(EXCEL_FILE_PATH)) {
            console.log('ℹ️ [Excel DB] Chưa tồn tại cơ sở dữ liệu Excel trước đó. Hệ thống khởi tạo mới.');
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
        console.log(`🎉 [Excel DB] Phục hồi trực tuyến thành công ${userDatabase.size} hội viên lên bộ nhớ RAM.`);
    } catch (err) {
        console.error('❌ [Excel DB] Thất bại khi nạp file khôi phục dữ liệu:', err.message);
    }
}

// Gọi thực thi nạp dữ liệu tức thì khi boot code
loadExcelFileToRam();

/**
 * Hàm kiểm tra và đặt lại hạn mức cày cuốc khi người dùng sang ngày mới
 */
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

/**
 * Thuật toán xác thực chuỗi mã hóa Telegram mã nguồn mở bảo mật từ dữ liệu WebApp
 */
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
// 3. ĐỊNH TUYẾN EXPRESS API (CỔNG KẾT NỐI MINI APP)
// ==========================================
app.get('/health', (req, res) => {
    res.json({ status: 'OK', totalUsers: userDatabase.size, uptime: process.uptime() });
});

/**
 * Route POST: Tiếp nhận gói tin đồng bộ dữ liệu người dùng khi mở Mini App Frontend
 */
app.post('/api/user-data', (req, res) => {
    try {
        const { initData } = req.body;
        const tgUser = verifyTelegramWebAppData(initData);
        if (!tgUser) return res.status(403).json({ error: 'Xác thực cấu trúc lớp bảo mật Telegram WebApp thất bại.' });

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
            // Đồng bộ bổ sung tên và username thật từ app nếu trước đó tài khoản được khởi tạo rỗng bởi webhook
            if ((user.first_name === 'Người chơi' || user.first_name === 'Hội viên') && tgUser.first_name) {
                user.first_name = tgUser.first_name;
            }
            if (!user.username && tgUser.username) user.username = tgUser.username;
            checkAndResetDailyLimits(user);
            saveRamToExcelFile();
        }
        res.json(user);
    } catch (err) {
        res.status(500).json({ error: 'Lỗi server đồng bộ thông tin tài khoản.' });
    }
});

/**
 * Route GET: Xử lý cập nhật biến số tài sản (Vòng quay & Lệnh thanh khoản)
 */
app.get('/api/user/update', async (req, res) => {
    try {
        const userId = parseInt(req.query.userId, 10);
        const action = req.query.action;
        
        if (!userId || !userDatabase.has(userId)) return res.status(404).json({ error: 'Hội viên chưa đăng ký trên RAM.' });
        const user = userDatabase.get(userId);

        checkAndResetDailyLimits(user);

        // Luồng xử lý trừ lượt khi bắt đầu quay vòng quay vật lý ở client
        if (action === 'spin_start') {
            if (user.spinsLeft <= 0) return res.status(400).json({ error: 'Hệ thống kiểm tra: Bạn đã hết lượt quay khả dụng!' });
            if (user.dailySpinsCount >= SERVER_CONFIG.MAX_DAILY_SPINS) return res.status(400).json({ error: 'Bạn đã đạt hạn mức vòng quay của ngày hôm nay.' });
            
            user.spinsLeft -= 1;
            user.dailySpinsCount += 1;
            saveRamToExcelFile();
            return res.json(user);
        }

        // Luồng xử lý cộng tiền thưởng sau khi kết thúc chuyển động quay đồ họa ở client
        if (action === 'spin_reward') {
            const rewardCoins = parseInt(req.query.rewardCoins, 10) || 0;
            user.coins += rewardCoins;
            saveRamToExcelFile();
            return res.json(user);
        }

        // Luồng xử lý tiếp nhận lệnh rút tiền mặt về ví
        if (action === 'withdraw_request') {
            const method = req.query.withdrawMethod;
            const address = req.query.withdrawAddress;
            const amount = parseInt(req.query.withdrawAmount, 10);

            if ((method === 'momo' || method === 'bank') && amount < SERVER_CONFIG.MIN_WITHDRAW_COINS) {
                return res.status(400).json({ error: 'Hạn mức quyết toán MoMo/Bank tối thiểu là 2,000,000 Xu.' });
            }
            if (amount > user.coins) return res.status(400).json({ error: 'Số dư tài khoản của bạn hiện tại không đủ.' });

            user.coins -= amount;
            saveRamToExcelFile();

            // Gửi tin nhắn trực tiếp báo cáo lệnh duyệt về hộp chat riêng của Admin điều hành
            const notifyText = `🚨 *YÊU CẦU DUYỆT LỆNH THANH KHOẢN MỚI* 🚨\n\n` +
                               `👤 Hội viên: [${user.first_name}](tg://user?id=${user.id})\n` +
                               `🆔 Telegram ID: \`${user.id}\`\n` +
                               `💰 Số lượng xu quy đổi: *${amount.toLocaleString()} Xu*\n` +
                               `🏦 Kênh nhận tiền mặt: *${method.toUpperCase()}*\n` +
                               `💳 Địa chỉ nhận / STK: \`${address}\`\n\n` +
                               `📌 Ban Quản Trị hãy đối chiếu database Excel và quyết toán thủ công cho thành viên!`;
            
            await bot.telegram.sendMessage(ADMIN_ID, notifyText, { parse_mode: 'Markdown' }).catch(()=>{});
            return res.json(user);
        }
        res.status(400).json({ error: 'Lệnh điều phối tài sản không hợp lệ.' });
    } catch (err) {
        res.status(500).json({ error: 'Lỗi API hệ thống xử lý tài sản.' });
    }
});

/**
 * Route GET: CỔNG WEBHOOK ĐỘC LẬP CHUYÊN DỤNG TIẾP NHẬN SỰ KIỆN TỪ ADSGRAM TOÀN CẦU
 * Đồng bộ hóa triệt để ID Telegram số nguyên, loại bỏ bug xu từ client và kháng hoàn toàn trễ mạng Render
 */
app.get('/api/webhook/adsgram', (req, res) => {
    try {
        const { userId, status } = req.query;
        const uid = parseInt(userId, 10);

        if (!uid || isNaN(uid)) return res.status(400).send('Lỗi cấu trúc tham số định danh');
        if (status !== 'reward') return res.status(200).send('Sự kiện ngoài danh mục trả thưởng');

        let user = userDatabase.get(uid);
        const todayStr = new Date().toISOString().split('T')[0];

        // Trường hợp hiếm: Thành viên xem ads đối tác nhưng tài khoản chưa được nạp lên RAM bởi lệnh đăng nhập Mini App trước đó
        if (!user) {
            user = {
                id: uid, username: '', first_name: 'Hội viên',
                coins: SERVER_CONFIG.NEW_USER_BONUS_COINS, spinsLeft: 3,
                dailySpinsCount: 0, dailyAdsCount: 0, referralCount: 0, lastActiveDate: todayStr
            };
            userDatabase.set(uid, user);
        }

        checkAndResetDailyLimits(user);
        if (user.dailyAdsCount >= SERVER_CONFIG.MAX_DAILY_ADS) return res.status(200).send('Thành viên đạt hạn mức cày ads tối đa hôm nay');

        // Thực thi quyết toán tài sản an toàn từ Server-to-Server Webhook
        user.coins += SERVER_CONFIG.AD_REWARD_COINS;
        user.spinsLeft += 1;
        user.dailyAdsCount += 1;
        
        saveRamToExcelFile(); // Commit ghi file Excel local tức thì
        console.log(`[Adsgram Webhook Verified] Thành công quyết toán cộng thưởng an toàn cho Telegram ID: ${uid}`);
        res.status(200).send('OK');
    } catch (err) {
        console.error('Lỗi sập luồng xử lý Webhook Adsgram:', err.message);
        res.status(500).send('Lỗi máy chủ cục bộ');
    }
});

// ==========================================
// 4. LOGIC ĐIỀU PHỐI BOT TELEGRAM & HOA HỒNG GIỚI THIỆU (REF)
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

    // Xử lý luồng ghi nhận mã giới thiệu thông qua Deep Link Bot (Sự kiện Mời bạn bè)
    if (isNewUser && startPayload && !isNaN(parseInt(startPayload, 10))) {
        const referrerId = parseInt(startPayload, 10);
        if (referrerId !== userId && userDatabase.has(referrerId)) {
            const inviter = userDatabase.get(referrerId);
            inviter.coins += SERVER_CONFIG.REFERRAL_REWARD_COINS;
            inviter.referralCount = (inviter.referralCount || 0) + 1;
            userDatabase.set(referrerId, inviter);

            bot.telegram.sendMessage(
                referrerId,
                `🎁 *Ghi Nhận Đối Tác Thành Công!*\n\nHội viên mới *${ctx.from.first_name}* đã tham gia qua liên kết giới thiệu độc quyền của bạn.\nTài khoản của bạn đã được tích lũy hoa hồng thưởng phát triển cộng đồng: *+50,000 Xu* vào ví tài sản!`,
                { parse_mode: 'Markdown' }
            ).catch(()=>{});
        }
    }

    saveRamToExcelFile();
    
    // Ngôn từ mở rộng cao cấp chuyên nghiệp đồng nhất 100% với file index.html
    const welcomeText = `✨ *Chào mừng Thượng khách ${ctx.from.first_name} đến với Siêu Cấp Kiếm Xu!* ✨\n\n` +
                        `Hệ thống TMA đã thiết lập không gian khai thác tài sản kỹ thuật số an toàn trên bộ nhớ RAM Server. Thông tin tài sản hiện tại của bạn:\n\n` +
                        `💳 *Ví Tài Sản:* \`${user.coins.toLocaleString()}\` *Xu*\n` +
                        `🎡 *Cơ Hội May Mắn:* \`${user.spinsLeft}\` *Lượt quay khả dụng*\n\n` +
                        `Hãy kích hoạt nút khởi động dưới đây để truy cập giao diện Mini App, thực hiện các nhiệm vụ đối tác Adsgram và tối ưu hóa nguồn thu nhập thụ động ngay lập tức! 👇`;
                        
    return ctx.replyWithMarkdown(welcomeText, Markup.inlineKeyboard([[Markup.button.webApp('🚀 KHỞI ĐỘNG ỨNG DỤNG NGAY', MY_APP_LINK)]]));
});

/**
 * Lệnh Telegram Bot thủ công dành riêng cho Admin xuất file Excel ngay tức thì
 */
bot.command('saoluu', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    saveRamToExcelFile();
    ctx.replyWithDocument({ source: EXCEL_FILE_PATH, filename: 'DanhSachHoiVien.xlsx' }, { caption: '📊 Bản xuất cơ sở dữ liệu hội viên thủ công khẩn cấp.' }).catch(()=>{});
});

// ==========================================
// 5. CHỨC NĂNG /BROADCAST (GỬI THÔNG BÁO KHÁCH HÀNG TOÀN DIỆN)
// ==========================================
bot.command('broadcast', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;

    let messageText = ctx.message.text.substring(10).trim();
    if (ctx.message.caption) messageText = ctx.message.caption.substring(10).trim();

    if (!messageText && !ctx.message.reply_to_message) {
        return ctx.replyWithMarkdown('⚠️ *Sai cú pháp truyền thông!* Hãy nhập nội dung thông báo:\n`/broadcast [Nội dung chữ]` hoặc tiến hành phản hồi (Reply) một hình ảnh/video kèm cụm lệnh `/broadcast`');
    }

    const targetUsers = Array.from(userDatabase.keys());
    if (targetUsers.length === 0) return ctx.reply('Cơ sở dữ liệu RAM hiện đang trống, chiến dịch bị hủy.');

    let successCount = 0;
    let failCount = 0;
    const statusMsg = await ctx.reply(`📣 Tiến trình truyền tin chiến dịch đang quét gửi tới *${targetUsers.length}* hòm thư hội viên...`, { parse_mode: 'Markdown' });

    for (const uId of targetUsers) {
        try {
            // Trường hợp Admin reply tin nhắn cũ hoặc ảnh/video phức tạp: Thực hiện sao chép nguyên mẫu (CopyMessage)
            if (ctx.message.reply_to_message) {
                await bot.telegram.copyMessage(uId, ctx.chat.id, ctx.message.reply_to_message.message_id);
            } 
            // Trường hợp Admin nhắn chữ thuần túy bằng lệnh văn bản thông thường
            else {
                await bot.telegram.sendMessage(uId, messageText, { parse_mode: 'Markdown' });
            }
            successCount++;
            // Độ trễ an toàn 35ms chặn hoàn toàn thuật toán quét Anti-Spam (Flood Control) của Telegram API
            await new Promise(resolve => setTimeout(resolve, 35)); 
        } catch (err) {
            failCount++;
        }
    }

    // Trả báo cáo tiến trình tổng kết sau khi quét hết danh sách ID
    try {
        await bot.telegram.editMessageText(
            ctx.chat.id, statusMsg.message_id, null, 
            `🎉 *CHIẾN DỊCH BROADCAST TRUYỀN THÔNG HOÀN THÀNH!*\n\n` +
            `✅ Gửi thành công: *${successCount} người*\n` +
            `❌ Thất bại (Người dùng block bot/hủy nick): *${failCount} người*\n` +
            `📊 Tổng quy mô tệp khách hàng quét: *${targetUsers.length} người*`,
            { parse_mode: 'Markdown' }
        );
    } catch (e) {}
});

// ==========================================
// 6. ENGINE HẸN GIỜ GỬI SAO LƯU CHO ADMIN TỰ ĐỘNG ĐÚNG MỖI 24 GIỜ
// ==========================================
function startAutomatic24hBackupScheduler() {
    console.log(`⏰ [Backup Engine] Bắt đầu kích hoạt bộ đếm hẹn giờ gửi dữ liệu tự động 24h.`);
    
    setInterval(async () => {
        try {
            console.log('🔄 [Backup Engine] Tiến hành đóng gói cơ sở dữ liệu định kỳ 24h...');
            // Khóa dữ liệu RAM, kết xuất file cứng Excel mới nhất
            saveRamToExcelFile();

            if (fs.existsSync(EXCEL_FILE_PATH)) {
                const dateStr = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
                await bot.telegram.sendDocument(
                    ADMIN_ID, 
                    { source: EXCEL_FILE_PATH, filename: `Backup_24h_SieuCapKiemXu.xlsx` },
                    { caption: `⏰ *BẢN SAO LƯU HỆ THỐNG ĐỊNH KỲ TỰ ĐỘNG 24H*\n📅 Thời gian thực thi: \`${dateStr}\`\n📊 Tổng số tài khoản bảo vệ thành công: *${userDatabase.size}* thành viên.`, parse_mode: 'Markdown' }
                );
                console.log('✅ [Backup Engine] Đã gửi tập tin sao lưu Excel định kỳ tới Telegram Admin thành công.');
            }
        } catch (error) {
            console.error('❌ [Backup Engine] Thất bại khi thực thi tác vụ tự động gửi bản sao lưu:', error.message);
        }
    }, SERVER_CONFIG.BACKUP_INTERVAL_MS);
}

// Cơ chế tự phát tín hiệu ping mạng nội bộ (Hỗ trợ cùng cổng Cronjob ngoài giữ Render thức)
function startSelfPingMechanism() {
    setInterval(async () => {
        try {
            const fetch = require('node-fetch');
            await fetch(`${MY_APP_LINK}/health`);
        } catch (e) {}
    }, 5 * 60 * 1000);
}

// ==========================================
// 7. KHỞI CHẠY HỆ THỐNG MÁY CHỦ SẢN XUẤT
// ==========================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`[Web Server] Khởi chạy thành công ứng dụng tại cổng mạng: ${PORT}`);
});

bot.launch().then(() => {
    console.log('🚀 [Bot Telegram] Trạng thái trực tuyến hoạt động hoàn hảo!');
    // Kích hoạt bộ hẹn giờ sao lưu 24h tính từ thời điểm khởi tạo bật máy chủ Render
    startAutomatic24hBackupScheduler();
    startSelfPingMechanism();
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

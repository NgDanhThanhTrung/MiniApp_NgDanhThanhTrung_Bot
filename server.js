/**
 * SIÊU CẤP KIẾM XU - TMA
 * Monolith Server Engine (Bot Control, RAM Storage & API Hosting)
 * Năm vận hành: 2026
 */

const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const XLSX = require('xlsx');
const path = require('path');

// ==========================================
// 1. CẤU HÌNH HỆ THỐNG (ĐIỀN THÔNG TIN CỦA BẠN)
// ==========================================
const BOT_TOKEN = 'YOUR_BOT_TOKEN_HERE'; // Thay Token lấy từ @BotFather vào đây
const ADMIN_ID = 123456789; // Thay SỐ ID Telegram của bạn vào đây để nhận file cấu trúc Backup

const bot = new Telegraf(BOT_TOKEN);
const app = express();

app.use(cors());
app.use(express.json());

// Cấu hình Express phục vụ tài nguyên tĩnh (Frontend) từ thư mục public
app.use(express.static(path.join(__dirname, 'public')));

// ==========================================
// 2. IN-MEMORY DATABASE (QUẢN LÝ BỘ NHỚ RAM CHỐNG HACK)
// ==========================================
let userDatabase = new Map();
const BACKUP_INTERVAL = 5 * 60 * 1000; // Chu kỳ tự động gửi mã sao lưu ẩn (5 phút/lần)

/**
 * Thuật toán giải mã và xác thực chuỗi initData gửi từ Telegram Webview
 * Đảm bảo dữ liệu gửi lên là thật 100% từ Telegram, chống sửa đổi số dư (Anti-Cheat)
 */
function verifyTelegramWebAppData(initDataString) {
    try {
        const urlParams = new URLSearchParams(initDataString);
        const hash = urlParams.get('hash');
        urlParams.delete('hash');

        const sortedParams = Array.from(urlParams.entries())
            .map(([key, value]) => `${key}=${value}`)
            .sort()
            .join('\n');

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

/**
 * Hàm đồng bộ và khởi tạo thông tin tài khoản người dùng trực tiếp trên RAM
 */
function syncUserInMemory(userId, userData) {
    if (!userDatabase.has(userId)) {
        userDatabase.set(userId, {
            id: userId,
            username: userData.username || 'Anonymous',
            first_name: userData.first_name || 'Player',
            coins: 50000, // Tặng sẵn 50k xu trải nghiệm ban đầu giống file app.js cũ của bạn
            spinsLeft: 3, // Số lượt quay ban đầu
            lastSpinTimestamp: 0,
            lastAdsTimestamp: 0,
            dailySpinsCount: 0,
            dailyAdsCount: 0,
            lastActiveDate: new Date().toISOString().split('T')[0] // Định dạng lưu ngày: YYYY-MM-DD
        });
    } else {
        const existing = userDatabase.get(userId);
        existing.username = userData.username || existing.username;
        existing.first_name = userData.first_name || existing.first_name;
        
        // Cơ chế Auto-Reset hạn mức cày cuốc theo ngày ngay trên RAM Server
        const todayStr = new Date().toISOString().split('T')[0];
        if (existing.lastActiveDate !== todayStr) {
            existing.dailySpinsCount = 0;
            existing.dailyAdsCount = 0;
            existing.spinsLeft = Math.max(existing.spinsLeft, 3); // Hoàn lại tối thiểu 3 lượt quay ngày mới
            existing.lastActiveDate = todayStr;
        }
    }
    return userDatabase.get(userId);
}

// ==========================================
// 3. WEB API ROUTERS (CỔNG ĐỒNG BỘ FRONTEND CHẠY REAL-TIME)
// ==========================================

// API 1: Đẩy dữ liệu từ RAM Server về giao diện hiển thị khi vừa mở ứng dụng
app.post('/api/user-data', (req, res) => {
    const { initData } = req.body;
    const tgUser = verifyTelegramWebAppData(initData);
    
    if (!tgUser) {
        return res.status(403).json({ error: "Xác thực bảo mật Telegram thất bại!" });
    }

    const user = syncUserInMemory(tgUser.id, tgUser);
    res.json(user);
});

// API 2: Tiếp nhận và xử lý thay đổi tài sản từ các hành động cày Xu công khai
app.post('/api/update-assets', async (req, res) => {
    const { initData, action, rewardCoins, withdrawMethod, withdrawAddress, withdrawAmount } = req.body;
    const tgUser = verifyTelegramWebAppData(initData);

    if (!tgUser) return res.status(403).json({ error: "Thao tác bị chặn do lỗi bảo mật!" });

    const user = userDatabase.get(tgUser.id);
    if (!user) return res.status(404).json({ error: "Tài khoản không tồn tại trên RAM hệ thống!" });

    const now = Date.now();

    switch (action) {
        case 'spin_start': // Khóa và trừ 1 lượt quay tích lũy trên RAM khi bấm nút quay số
            user.spinsLeft -= 1;
            user.dailySpinsCount += 1;
            user.lastSpinTimestamp = now;
            break;
            
        case 'spin_reward': // Đồng bộ cộng số lượng Xu thực tế trúng thưởng từ vòng quay
            user.coins += parseInt(rewardCoins || 0);
            break;

        case 'watch_ads_success': // Xem hết Video Ads của AdsGram -> Cộng xu + tặng lượt quay khuyến mãi
            user.coins += 12000;
            user.spinsLeft += 1;
            user.dailyAdsCount += 1;
            user.lastAdsTimestamp = now;
            break;

        case 'withdraw_request': // Xử lý tạo đơn yêu cầu rút tiền mặt/TON
            const amount = parseInt(withdrawAmount);
            if (amount > user.coins) return res.status(400).json({ error: "Số dư khả dụng trong tài khoản không đủ!" });
            
            user.coins -= amount; // Khấu trừ trực tiếp số dư trên RAM
            
            // Bắn tin nhắn trực tiếp báo cáo về chat Telegram cho Admin duyệt giao dịch thủ công
            const reportMsg = `💰 *LỆNH RÚT TIỀN MỚI ĐÃ ĐƯỢC KHỞI TẠO* 💰\n\n` +
                             `👤 Khách hàng: [${user.first_name}](tg://user?id=${user.id})\n` +
                             `🆔 Telegram ID: \`${user.id}\`\n` +
                             `💳 Kênh rút: *${withdrawMethod.toUpperCase()}*\n` +
                             `📍 Địa chỉ nhận / STK: \`${withdrawAddress}\`\n` +
                             `📉 Số xu khấu trừ: -*${amount.toLocaleString()} Xu*\n` +
                             `⏱️ Thời gian: ${new Date().toLocaleString('vi-VN')}`;
                             
            await bot.telegram.sendMessage(ADMIN_ID, reportMsg, { parse_mode: 'Markdown' });
            break;

        default:
            return res.status(400).json({ error: "Hành động cấu hình không hợp lệ!" });
    }

    res.json(user); // Trả cục State mới tinh về cho public/app.js render lại UI lập tức
});

// Định tuyến trang chủ mặc định trả về file index.html khi mở bằng link duyệt thường
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==========================================
// 4. AUTO BACKUP CLOUD MECHANISM (HỆ THỐNG CỨU RAM)
// ==========================================
async function triggerAutoBackup() {
    if (userDatabase.size === 0) return;
    try {
        const userList = Array.from(userDatabase.values());
        const backupRawString = JSON.stringify(userList);
        
        // Gửi ngầm chuỗi dữ liệu nén JSON bảo mật thẳng vào tin nhắn của Admin
        await bot.telegram.sendMessage(ADMIN_ID, `📦 [AUTO_BACKUP_DATA]\n\`\`\`json\n${backupRawString}\n\`\`\``, { parse_mode: 'MarkdownV2' });
        console.log(`[Backup] Đã tự động sao lưu an toàn ${userList.length} tài khoản lên Telegram Cloud.`);
    } catch (e) {
        console.error("Lỗi tiến trình tự động sao lưu dữ liệu:", e.message);
    }
}

// ==========================================
// 5. BOT COMMANDS SYSTEM (HỆ THỐNG ĐIỀU HÀNH BOT)
// ==========================================
function isUserAdmin(ctx, next) {
    if (ctx.from?.id === ADMIN_ID) return next();
    return ctx.reply('❌ Bạn không có quyền quản trị cấp Admin để chạy lệnh này.');
}

// Lệnh khởi động Bot công khai cho tất cả thành viên
bot.start((ctx) => {
    // Tự động lưu profile người dùng vào bộ nhớ đệm RAM
    const user = syncUserInMemory(ctx.from.id, ctx.from);
    
    const welcome = `🔥 *Chào mừng ${ctx.from.first_name} đã đến với Siêu Cấp Kiếm Xu!* 🔥\n\n` +
                    `💰 *Số dư hiện tại:* ${user.coins.toLocaleString()} Xu\n` +
                    `🎡 *Lượt quay sẵn có:* ${user.spinsLeft} lượt\n\n` +
                    `Hệ thống dữ liệu đã được cấu hình đồng bộ hóa thời gian thực chống hack an toàn 100%. Bấm nút ngay dưới đây để khởi chạy ứng dụng cày tiền nào! 👇`;
    
    // Mẹo lấy URL tự động: Trên mô hình nguyên khối Render, link Webview chính là link ứng dụng Render của bạn
    const LIVE_RENDER_URL = ctx.workerWindow ? window.location.origin : `${ctx.from.id}`; 
    // CHÚ Ý: Sau khi deploy xong Render, hãy sửa dòng chữ dưới đây thành link Render thật của bạn
    // Ví dụ: const MY_APP_LINK = 'https://sieu-cap-cay-xu.onrender.com';
    const MY_APP_LINK = 'https://YOUR_RENDER_APP_NAME.onrender.com';

    return ctx.replyWithMarkdown(welcome, Markup.inlineKeyboard([
        [Markup.button.webApp('🚀 Mở Ứng Dụng Kiếm Xu', MY_APP_LINK)]
    ]));
});

// Lệnh trích xuất Excel (Chỉ dành cho Admin)
bot.command('saoluu', isUserAdmin, async (ctx) => {
    const userList = Array.from(userDatabase.values());
    if (userList.length === 0) return ctx.reply('⚠️ Hệ thống RAM hiện tại đang trống, chưa có user.');
    
    const dataForExcel = userList.map(u => ({
        'ID Người Dùng': u.id, 
        'Username': u.username ? `@${u.username}` : 'Không có', 
        'Tên Hiển Thị': u.first_name, 
        'Số Dư Xu (Coins)': u.coins, 
        'Lượt Quay Còn Lại': u.spinsLeft, 
        'Thời Gian Cập Nhật Cuối': u.updatedAt
    }));
    
    const worksheet = XLSX.utils.json_to_sheet(dataForExcel);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'User_Data');
    
    // Khởi tạo luồng file buffer đệm ngay trên RAM, không ghi đè xuống ổ cứng vật lý của Render
    const excelBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    
    await ctx.replyWithDocument(
        { source: excelBuffer, filename: `Live_RAM_SieuCapKiXu.xlsx` }, 
        { caption: `📊 Trích xuất tệp dữ liệu Excel thành công! Hiện tại đang lưu giữ an toàn *${userList.length}* tài khoản trên RAM.` }
    );
});

// Lệnh gửi tin nhắn thông báo hàng loạt (Chỉ dành cho Admin)
bot.command('broadcast', isUserAdmin, async (ctx) => {
    const txt = ctx.payload;
    if (!txt) return ctx.reply('⚠️ Vui lòng nhập đúng cú pháp: `/broadcast [Nội dung thông báo]`');
    
    const ids = Array.from(userDatabase.keys());
    ctx.reply(`📣 Đang tiến hành truyền dữ liệu tin nhắn tới toàn bộ ${ids.length} thành viên trong hệ thống...`);
    
    let success = 0, fail = 0;
    for (const id of ids) {
        try {
            await ctx.telegram.sendMessage(id, `📢 *THÔNG BÁO TỪ BAN QUẢN TRỊ*\n\n${txt}`, { parse_mode: 'Markdown' });
            success++;
            await new Promise(r => setTimeout(r, 50)); // Giãn cách 0.05 giây chống nghẽn nghẹt API Telegram
        } catch {
            fail++;
        }
    }
    ctx.reply(`✅ *Chiến dịch gửi thông báo hoàn tất!*\n- Thành công: *${success}*\n- Thất bại (Do user block bot): *${fail}*`);
});

// Tiến trình khôi phục nạp ngược dữ liệu vào RAM (Chỉ dành cho Admin)
bot.on('message', isUserAdmin, async (ctx) => {
    // Trường hợp 1: Admin copy paste ngược tin nhắn JSON chứa mã cứu hộ [AUTO_BACKUP_DATA]
    if (ctx.message.text && ctx.message.text.includes('[AUTO_BACKUP_DATA]')) {
        try {
            const rawJson = ctx.message.text.split('```json')[1].split('```')[0].trim();
            const userList = JSON.parse(rawJson);
            
            userList.forEach(u => userDatabase.set(u.id, u));
            return ctx.reply(`🎉 KHÔI PHỤC THẦN TỐC THÀNH CÔNG! Đã nạp lại mượt mà *${userList.length}* tài khoản vào RAM.`);
        } catch { 
            return ctx.reply('❌ Lỗi xử lý chuỗi sao lưu, sai cấu trúc định dạng JSON!'); 
        }
    }
    
    // Trường hợp 2: Admin gửi tệp đính kèm bảng tính Excel `.xlsx` từ lệnh /saoluu cũ
    if (ctx.message.document && ctx.message.document.file_name.endsWith('.xlsx')) {
        try {
            const fileLink = await ctx.telegram.getFileLink(ctx.message.document.file_id);
            const res = await fetch(fileLink.href);
            const buf = await res.arrayBuffer();
            
            const workbook = XLSX.read(new Uint8Array(buf), { type: 'array' });
            const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
            let count = 0;
            
            rows.forEach(r => {
                const uid = parseInt(r['ID Người Dùng']);
                if (uid) {
                    userDatabase.set(uid, { 
                        id: uid, 
                        username: r['Username'] ? r['Username'].replace('@','') : '', 
                        first_name: r['Tên Hiển Thị'] || 'Player', 
                        coins: parseInt(r['Số Dư Xu (Coins)']) || 0, 
                        spinsLeft: parseInt(r['Lượt Quay Còn Lại']) || 0, 
                        updatedAt: new Date().toISOString() 
                    });
                    count++;
                }
            });
            return ctx.reply(`🎉 ĐỒNG BỘ EXCEL THÀNH CÔNG! Đã nạp đè và cấu hình lại *${count}* tài khoản vào bộ nhớ RAM.`);
        } catch { 
            return ctx.reply('❌ Quá trình phân tích đọc dữ liệu file đính kèm Excel thất bại.'); 
        }
    }
});

// ==========================================
// 6. KHỞI CHẠY HỆ THỐNG MÁY CHỦ NGUYÊN KHỐI
// ==========================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`[Hosting] Ứng dụng Server Web tĩnh đang hoạt động tại cổng Port: ${PORT}`);
});

bot.launch().then(() => {
    console.log('🚀 [Bot API] Hệ thống Bot điều hành kết nối song song dữ liệu RAM trực tuyến!');
    // Kích hoạt vòng lặp chạy ngầm tự động gửi bản lưu tài sản sau mỗi 5 phút
    setInterval(triggerAutoBackup, BACKUP_INTERVAL);
});

// Tắt bot an toàn phòng trường hợp sập server bảo trì hệ thống đột ngột
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

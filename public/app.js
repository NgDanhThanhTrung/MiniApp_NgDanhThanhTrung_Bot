/**
 * SIÊU CẤP KIẾM XU - TMA
 * Frontend Logic API Engine (Chạy Nguyên Khối trên Render)
 * Năm vận hành: 2026
 */

// ==========================================
// 1. KHỞI TẠO TELEGRAM SDK VÀ ĐỊNH TUYẾN API
// ==========================================
const tg = window.Telegram ? window.Telegram.WebApp : null;

// Khi chạy mô hình nguyên khối, API URL chính là địa chỉ gốc (Origin) của trang web hiện tại
const BACKEND_API_URL = window.location.origin; 

if (tg) {
    tg.ready();
    tg.expand(); // Kéo dãn ứng dụng tràn màn hình Mobile Webview
    if (tg.disableVerticalSwipes) tg.disableVerticalSwipes(); // Chống tình trạng vuốt trượt lỡ đóng app
}

// Cấu hình các bộ tham số đếm ngược Cooldown và Hạn mức
const CONFIG = {
    COIN_TO_VND_RATE: 1000, // Tỷ lệ quy đổi: 1 VNĐ = 1000 Xu
    SPIN_COOLDOWN: 30,      // Thời gian chờ giữa 2 lần quay (giây)
    ADS_COOLDOWN: 60,       // Thời gian chờ giữa 2 lần xem Ads (giây)
    MAX_DAILY_SPINS: 10,
    MAX_DAILY_ADS: 5,
};

// Trạng thái tài khoản cục bộ (Sẽ được đồng bộ liên tục từ RAM Server về)
let serverUserState = {
    id: 0,
    coins: 0,
    spinsLeft: 0,
    lastSpinTimestamp: 0,
    lastAdsTimestamp: 0,
    dailySpinsCount: 0,
    dailyAdsCount: 0,
    referrerId: null
};

// Mảng phần thưởng khớp chính xác 100% với góc quay CSS và các ô trên index.html
const WHEEL_REWARDS = [
    { text: "1,000 XU",  value: 1000 },
    { text: "5,000 XU",  value: 5000 },
    { text: "MẤT LƯỢT",  value: 0 },
    { text: "10,000 XU", value: 10000 },
    { text: "500 XU",    value: 500 },
    { text: "20,000 XU", value: 20000 },
    { text: "MẤT LƯỢT",  value: 0 },
    { text: "50,000 XU", value: 50000 }
];

let isSpinning = false;

// Hàm kích hoạt phản hồi rung trên thiết bị di động
function triggerHaptic(type = 'light') {
    if (tg && tg.HapticFeedback) {
        switch (type) {
            case 'light': tg.HapticFeedback.impactOccurred('light'); break;
            case 'medium': tg.HapticFeedback.impactOccurred('medium'); break;
            case 'heavy': tg.HapticFeedback.impactOccurred('heavy'); break;
            case 'success': tg.HapticFeedback.notificationOccurred('success'); break;
            case 'error': tg.HapticFeedback.notificationOccurred('warning'); break;
        }
    }
}

// Hàm hiển thị thông báo Toast nhanh góc dưới màn hình
function showToast(message) {
    let toast = document.querySelector('.toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.className = 'toast';
        document.body.appendChild(toast);
    }
    toast.innerText = message;
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(-50%) translateY(0)';
    
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(-50%) translateY(8px)';
    }, 3000);
}

// ==========================================
// 2. KẾT NỐI ĐỒNG BỘ DỮ LIỆU VỚI BACKEND SERVER
// ==========================================

// Lấy thông tin tài khoản an toàn qua phương thức POST (bảo mật Telegram ID)
async function fetchServerProfile() {
    let telegramId = 9999; // ID dự phòng cho môi trường Testing ngoài Telegram
    let username = "Local_Tester";
    let firstName = "Khách vãng lai";

    if (tg && tg.initDataUnsafe && tg.initDataUnsafe.user) {
        telegramId = tg.initDataUnsafe.user.id;
        username = tg.initDataUnsafe.user.username || "";
        firstName = tg.initDataUnsafe.user.first_name || "";
    }

    // Đọc mã giới thiệu từ URL nếu có (?startapp=123456)
    let referrerId = null;
    if (tg && tg.initDataUnsafe && tg.initDataUnsafe.start_param) {
        referrerId = parseInt(tg.initDataUnsafe.start_param, 10) || null;
    }

    try {
        const response = await fetch(`${BACKEND_API_URL}/api/user/profile`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ telegramId, username, firstName, referrerId })
        });
        if (response.ok) {
            serverUserState = await response.json();
            return true;
        }
    } catch (err) {
        console.error("Lỗi đồng bộ cấu trúc dữ liệu từ Server:", err);
    }
    return false;
}

// Đẩy dữ liệu cập nhật tài sản lên API Server
async function postAssetUpdate(action, payload = {}) {
    let telegramId = 9999;
    if (tg && tg.initDataUnsafe && tg.initDataUnsafe.user) {
        telegramId = tg.initDataUnsafe.user.id;
    }

    try {
        const response = await fetch(`${BACKEND_API_URL}/api/user/update`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ telegramId, action, ...payload })
        });
        if (response.ok) {
            serverUserState = await response.json();
            return true;
        } else {
            const errData = await response.json();
            showToast(errData.error || "❌ Lỗi hệ thống phát sinh.");
        }
    } catch (err) {
        showToast("❌ Mất kết nối tới Server.");
    }
    return false;
}

// ==========================================
// 3. RENDER VÀ ĐỒNG BỘ GIAO DIỆN NGƯỜI DÙNG (UI)
// ==========================================
function updateUI() {
    // Đổ dữ liệu định danh
    let usernameDisplay = "Thành viên TMA";
    if (tg && tg.initDataUnsafe && tg.initDataUnsafe.user) {
        usernameDisplay = tg.initDataUnsafe.user.first_name || tg.initDataUnsafe.user.username || "Thành viên TMA";
    }
    document.getElementById('username').innerText = usernameDisplay;

    // Cập nhật số dư và số tiền VNĐ ước lượng trực quan
    const coins = serverUserState.coins || 0;
    document.getElementById('user-points').innerText = coins.toLocaleString();
    
    const vndEstimation = Math.floor(coins / CONFIG.COIN_TO_VND_RATE);
    document.getElementById('vnd-estimation').innerText = vndEstimation.toLocaleString();

    // Cập nhật số lượt quay khả dụng
    document.getElementById('user-spins').innerText = serverUserState.spinsLeft ?? 0;

    // Cập nhật Link mời bạn bè độc quyền tại Tab 2
    let shareTelegramId = tg && tg.initDataUnsafe && tg.initDataUnsafe.user ? tg.initDataUnsafe.user.id : 9999;
    // Link bot chuyển hướng dựa vào tên bot định nghĩa từ biến môi trường thông qua API Profile
    const shareUrl = `${serverUserState.botAppLink || 'https://t.me/SieuCapKiemXuBot'}?startapp=${shareTelegramId}`;
    document.getElementById('share-url-text').value = shareUrl;
}

// ==========================================
// 4. BỘ ĐẾM GIÂY CHẠY NGẦM (COOLDOWN TIMER ENGINE)
// ==========================================
function runCooldownTimers() {
    setInterval(() => {
        const now = Date.now();

        // 1. Quản lý đồng hồ đếm ngược của Vòng quay
        const lastSpin = serverUserState.lastSpinTimestamp || 0;
        const spinDiff = Math.floor((now - lastSpin) / 1000);
        const spinRemaining = CONFIG.SPIN_COOLDOWN - spinDiff;
        const spinTimerEl = document.getElementById('spin-timer');

        if (spinRemaining > 0 && serverUserState.dailySpinsCount >= CONFIG.MAX_DAILY_SPINS) {
            spinTimerEl.classList.remove('hidden');
            spinTimerEl.querySelector('span').innerText = formatTime(spinRemaining);
            document.getElementById('btn-spin').disabled = true;
        } else {
            spinTimerEl.classList.add('hidden');
            if (!isSpinning) document.getElementById('btn-spin').disabled = false;
        }

        // 2. Quản lý đồng hồ đếm ngược của module xem Ads quảng cáo
        const lastAds = serverUserState.lastAdsTimestamp || 0;
        const adsDiff = Math.floor((now - lastAds) / 1000);
        const adsRemaining = CONFIG.ADS_COOLDOWN - adsDiff;
        const adsTimerEl = document.getElementById('ads-timer');

        if (adsRemaining > 0) {
            adsTimerEl.classList.remove('hidden');
            adsTimerEl.querySelector('span').innerText = formatTime(adsRemaining);
            document.getElementById('btn-watch-ads').disabled = true;
        } else {
            adsTimerEl.classList.add('hidden');
            document.getElementById('btn-watch-ads').disabled = false;
        }
    }, 1000);
}

function formatTime(seconds) {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
}

// ==========================================
// 5. MÔ PHỎNG VẬT LÝ VÒNG QUAY MAY MẮN
// ==========================================
async function handleLuckyWheel() {
    if (isSpinning) return;

    if ((serverUserState.spinsLeft ?? 0) <= 0) {
        triggerHaptic('error');
        showToast("❌ Bạn đã hết lượt quay! Hãy xem quảng cáo AdsGram để nhận thêm.");
        return;
    }

    isSpinning = true;
    document.getElementById('btn-spin').disabled = true;
    triggerHaptic('medium');

    // Gọi API xin kết quả ô trúng thưởng được tính toán an toàn từ RAM Server
    let telegramId = tg && tg.initDataUnsafe && tg.initDataUnsafe.user ? tg.initDataUnsafe.user.id : 9999;
    try {
        const response = await fetch(`${BACKEND_API_URL}/api/user/spin`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ telegramId })
        });

        if (!response.ok) {
            const err = await response.json();
            showToast(err.error || "Lỗi vòng quay");
            isSpinning = false;
            return;
        }

        const data = await response.json();
        const targetIndex = data.rewardIndex; // Số ô từ 0 đến 7 nhận về từ server

        const wheel = document.getElementById('wheel');
        
        // Tính toán toán học góc xoay vật lý để kim chỉ đứng đúng vào tâm ô thưởng
        const degreesPerSegment = 360 / 8; 
        const extraRounds = 5 * 360; // Quay 5 vòng tạo hiệu ứng kịch tính
        
        // Công thức tính góc đảo ngược chuẩn theo chiều kim đồng hồ tương ứng mảng WHEEL_REWARDS
        const targetAngle = extraRounds - (targetIndex * degreesPerSegment) - (degreesPerSegment / 2);

        wheel.style.transform = `rotate(${targetAngle}deg)`;

        // Đợi hiệu ứng CSS transition hoàn tất (khớp với thời gian 4s quy định tại style.css)
        setTimeout(() => {
            isSpinning = false;
            // Cập nhật trạng thái người dùng mới nhất được trả về từ Server sau lượt quay
            serverUserState = data.user;
            updateUI();

            const prize = WHEEL_REWARDS[targetIndex];
            if (prize.value > 0) {
                triggerHaptic('success');
                showToast(`🎉 Chúc mừng! Bạn quay trúng +${prize.value.toLocaleString()} Xu!`);
            } else {
                triggerHaptic('error');
                showToast("😢 Rất tiếc, bạn đã quay vào ô Mất Lượt!");
            }
        }, 4000);

    } catch (err) {
        showToast("❌ Lỗi kết nối vòng quay.");
        isSpinning = false;
    }
}

// ==========================================
// 6. TÍCH HỢP SDK ADSGRAM & NHẬN LƯỢT QUAY
// ==========================================
function handleWatchAds() {
    triggerHaptic('light');

    // Khởi tạo khối phân phối AdController từ AdsGram Telegram Widget Block
    // Thay thế 'YOUR_BLOCK_ID' bằng ID thật do AdsGram cung cấp khi bạn được phê duyệt
    const AdController = window.Adsgram ? window.Adsgram.init({ blockId: "YOUR_BLOCK_ID" }) : null;

    if (!AdController) {
        // Khối giả lập phần thưởng chạy thử nghiệm trên máy tính Localhost
        showToast("📺 Giả lập: Đang tải quảng cáo AdsGram...");
        setTimeout(async () => {
            const ok = await postAssetUpdate('watch_ads');
            if (ok) {
                triggerHaptic('success');
                updateUI();
                showToast("🎉 Giả lập: Xem Ads thành công! Nhận +1 Lượt quay.");
            }
        }, 1500);
        return;
    }

    // Thực hiện gọi quảng cáo Video Reward chuẩn từ cổng mạng quảng cáo Telegram
    AdController.show().then(async () => {
        // Người dùng hoàn thành việc xem hết Video Ads thành công
        const ok = await postAssetUpdate('watch_ads');
        if (ok) {
            triggerHaptic('success');
            updateUI();
            showToast("🎉 Xem quảng cáo thành công! Bạn nhận được +1 Lượt quay.");
        }
    }).catch((err) => {
        // Người dùng nhấn bỏ qua hoặc phát sinh lỗi phân phối ads từ SDK
        triggerHaptic('error');
        showToast("⚠️ Quảng cáo chưa hoàn thành hoặc bị lỗi tải.");
    });
}

// ==========================================
// 7. INITIALIZER ENTRY POINT (BẮT ĐẦU CHẠY)
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
    // 1. Đồng bộ tài khoản từ RAM server về máy khách
    await fetchServerProfile();
    
    // 2. Đổ dữ liệu đồng bộ lên giao diện người dùng
    updateUI();
    
    // 3. Kích hoạt bộ đếm thời gian hồi chiêu chạy ngầm
    runCooldownTimers();

    // 4. Ràng buộc các sự kiện click chức năng cốt lõi trên Vòng Quay & Ads
    document.getElementById('btn-spin').addEventListener('click', handleLuckyWheel);
    document.getElementById('btn-watch-ads').addEventListener('click', handleWatchAds);

    // 5. Xử lý sự kiện chia sẻ Link mời bạn bè
    document.getElementById('btn-invite-friend').addEventListener('click', () => {
        triggerHaptic('light');
        const shareUrl = document.getElementById('share-url-text').value;
        const textInvite = encodeURIComponent("🔥 Tham gia vòng quay Siêu Cấp Kiếm Xu nhận tiền mặt MoMo/Bank và Crypto TON miễn phí ngay!");
        const telegramShareLink = `https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${textInvite}`;
        
        if (tg && tg.openTelegramLink) {
            tg.openTelegramLink(telegramShareLink);
        } else {
            window.open(telegramShareLink, '_blank');
        }
    });

    // 6. Xử lý nộp đơn gửi lệnh tạo yêu cầu rút tiền mặt/TON (ĐÃ ĐƯỢC TỐI ƯU HÓA)
    document.getElementById('btn-submit-withdraw').addEventListener('click', async () => {
        const method = document.getElementById('withdraw-method').value;
        const address = document.getElementById('withdraw-address').value.trim();
        const amount = parseInt(document.getElementById('withdraw-amount').value, 10);

        // Hạn mức rút tối thiểu theo ý tưởng mới: 2,000 VNĐ = 2,000,000 Xu (Áp dụng cho Momo và Bank)
        const MIN_COINS_REQUIRED = 2000000; 

        if (!address || isNaN(amount)) {
            triggerHaptic('error');
            showToast("❌ Vui lòng nhập đầy đủ thông tin nhận tiền!");
            return;
        }

        // Nếu rút MoMo hoặc Ngân hàng, kiểm tra hạn mức tối thiểu 2 triệu Xu
        if ((method === 'momo' || method === 'bank') && amount < MIN_COINS_REQUIRED) {
            triggerHaptic('error');
            showToast("❌ Hạn mức rút MoMo/Bank tối thiểu là 2,000,000 Xu (2,000đ)!");
            return;
        }

        if (amount > serverUserState.coins) {
            triggerHaptic('error');
            showToast("❌ Số dư khả dụng trong tài khoản không đủ!");
            return;
        }

        // Đẩy đơn rút tiền an toàn lên hàng chờ Server duyệt
        const ok = await postAssetUpdate('withdraw_request', { 
            withdrawMethod: method, 
            withdrawAddress: address, 
            withdrawAmount: amount 
        });
        
        if (ok) {
            // Reset làm sạch form nhập liệu sau khi gửi thành công
            document.getElementById('withdraw-address').value = "";
            document.getElementById('withdraw-amount').value = "";
            triggerHaptic('success');
            updateUI();
            showToast("🎉 Đơn rút tiền đã gửi lên Admin duyệt thành công!");
        }
    });
});

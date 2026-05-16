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

// Trạng thái tài khoản cục bộ (🌟 Đã mồi sẵn 50,000 Xu và 3 lượt quay đồng bộ với index.html)
let serverUserState = {
    id: 0,
    coins: 50000,
    spinsLeft: 3,
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
    let toast = document.getElementById('toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'toast';
        toast.className = 'toast hidden';
        document.body.appendChild(toast);
    }
    toast.innerText = message;
    toast.classList.remove('hidden');
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(-50%) translateY(0)';
    
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(-50%) translateY(8px)';
        setTimeout(() => toast.classList.add('hidden'), 200);
    }, 3000);
}

// ==========================================
// 2. KẾT NỐI ĐỒNG BỘ DỮ LIỆU VỚI BACKEND SERVER
// ==========================================

// Lấy thông tin tài khoản an toàn từ bộ nhớ RAM của Server
async function fetchUserAccountData() {
    if (!tg || !tg.initData) {
        console.warn("Ứng dụng chưa được kích hoạt trong Telegram Webview.");
        return;
    }
    try {
        const response = await fetch(`${BACKEND_API_URL}/api/user-data`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ initData: tg.initData })
        });
        if (response.ok) {
            serverUserState = await response.json();
            updateUI();
        }
    } catch (e) { 
        console.error("Lỗi tải thông tin từ RAM Server:", e); 
    }
}

// Đẩy dữ liệu cập nhật tài sản lên API Server
async function postAssetUpdate(actionType, extraParams = {}) {
    if (!tg || !tg.initData) return false;
    try {
        const response = await fetch(`${BACKEND_API_URL}/api/update-assets`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ initData: tg.initData, action: actionType, ...extraParams })
        });
        if (response.ok) {
            serverUserState = await response.json();
            updateUI();
            return true;
        } else {
            const err = await response.json();
            showToast(err.error || "Thao tác thất bại");
            return false;
        }
    } catch (e) {
        showToast("❌ Mất kết nối tới Server RAM.");
        return false;
    }
}

// ==========================================
// 3. RENDER VÀ ĐỒNG BỘ GIAO DIỆN NGƯỜI DÙNG (UI)
// ==========================================
function updateUI() {
    // Đổ dữ liệu định danh người dùng
    let usernameDisplay = "Chúa tể Cày Xu";
    if (tg && tg.initDataUnsafe && tg.initDataUnsafe.user) {
        const u = tg.initDataUnsafe.user;
        usernameDisplay = u.first_name + (u.last_name ? " " + u.last_name : "");
        
        // Cập nhật Link mời bạn bè độc quyền tại Tab 2 khớp với Ref cấu trúc mới
        if (u.id) {
            document.getElementById('share-url-text').value = `https://t.me/SieuCapCayXu_NDTTrung_Bot/app?startapp=ref_${u.id}`;
        }
    }
    document.getElementById('username').innerText = usernameDisplay;

    // Cập nhật số dư và số tiền VNĐ ước lượng trực quan công khai
    const coins = serverUserState.coins || 0;
    document.getElementById('user-points').innerText = coins.toLocaleString('en-US');
    
    const vndEstimation = Math.floor(coins / CONFIG.COIN_TO_VND_RATE);
    document.getElementById('vnd-estimation').innerText = vndEstimation.toLocaleString('vi-VN');

    // 🌟 ĐỒNG BỘ ĐỒNG THỜI: Cập nhật số lượt quay khả dụng ở cả 2 thẻ hiển thị mới trên index.html
    const spins = serverUserState.spinsLeft ?? 0;
    document.getElementById('user-spins').innerText = spins;
    if (document.getElementById('user-spins-badge')) {
        document.getElementById('user-spins-badge').innerText = spins;
    }
}

// ==========================================
// 4. BỘ ĐẾM GIÂY CHẠY NGẦM (COOLDOWN TIMER ENGINE)
// ==========================================
function runCooldownTimers() {
    setInterval(() => {
        const now = Date.now();

        // 1. Quản lý trạng thái và bộ đếm chữ nút Vòng quay
        const btnSpin = document.getElementById('btn-spin');
        if (!isSpinning) {
            const spinTime = Math.floor((now - serverUserState.lastSpinTimestamp) / 1000);
            const spinTimerEl = document.getElementById('spin-timer');
            
            if (serverUserState.dailySpinsCount >= CONFIG.MAX_DAILY_SPINS) {
                btnSpin.innerText = `❌ ĐÃ HẾT HẠN MỨC NGÀY`;
                btnSpin.disabled = true;
                spinTimerEl.classList.add('hidden');
            } else if (spinTime < CONFIG.SPIN_COOLDOWN) {
                const remains = CONFIG.SPIN_COOLDOWN - spinTime;
                btnSpin.innerText = `⏳ HỒI CHIÊU: ${remains}s`;
                btnSpin.disabled = true;
                
                // Đồng bộ hiển thị dòng text nhỏ thông báo đếm ngược phía dưới nút bấm
                spinTimerEl.classList.remove('hidden');
                spinTimerEl.querySelector('span').innerText = `00:${remains.toString().padStart(2, '0')}`;
            } else {
                btnSpin.innerText = `🎡 QUAY NGAY`;
                btnSpin.disabled = false;
                spinTimerEl.classList.add('hidden');
            }
        }

        // 2. Quản lý trạng thái và bộ đếm chữ nút Xem Video Ads
        const btnAds = document.getElementById('btn-watch-ads');
        const adsTime = Math.floor((now - serverUserState.lastAdsTimestamp) / 1000);
        const adsTimerEl = document.getElementById('ads-timer');

        if (serverUserState.dailyAdsCount >= CONFIG.MAX_DAILY_ADS) {
            btnAds.innerHTML = `❌ ĐÃ HẾT LƯỢT XEM HÔM NAY`;
            btnAds.disabled = true;
            adsTimerEl.classList.add('hidden');
        } else if (adsTime < CONFIG.ADS_COOLDOWN) {
            const remains = CONFIG.ADS_COOLDOWN - adsTime;
            btnAds.innerHTML = `⏳ CHỜ ADS: ${remains}s`;
            btnAds.disabled = true;
            
            // Đồng bộ hiển thị dòng text nhỏ thông báo đếm ngược phía dưới nút bấm
            adsTimerEl.classList.remove('hidden');
            adsTimerEl.querySelector('span').innerText = `00:${remains.toString().padStart(2, '0')}`;
        } else {
            btnAds.innerHTML = `📺 XEM ADS LẤY LƯỢT`;
            btnAds.disabled = false;
            adsTimerEl.classList.add('hidden');
        }
    }, 1000);
}

// ==========================================
// 5. MÔ PHỎNG VẬT LÝ VÒNG QUAY MAY MẮN
// ==========================================
async function handleLuckyWheel() {
    if (isSpinning) return;

    if ((serverUserState.spinsLeft ?? 0) <= 0) {
        triggerHaptic('error');
        showToast("❌ Bạn đã hết lượt quay! Hãy xem Video để nhận thêm.");
        return;
    }
    if (serverUserState.dailySpinsCount >= CONFIG.MAX_DAILY_SPINS) {
        triggerHaptic('error');
        showToast("❌ Bạn đã đạt giới hạn tối đa số lần quay hôm nay.");
        return;
    }
    const timePassed = Math.floor((Date.now() - serverUserState.lastSpinTimestamp) / 1000);
    if (timePassed < CONFIG.SPIN_COOLDOWN) {
        triggerHaptic('error');
        showToast(`⏳ Vui lòng chờ thêm thời gian hồi chiêu!`);
        return;
    }

    isSpinning = true;
    document.getElementById('btn-spin').disabled = true;
    triggerHaptic('heavy');

    // Gọi API Server RAM để trừ lượt quay và chốt chặn bảo mật trước khi cho xoay đồ họa
    const lockSuccess = await postAssetUpdate('spin_start');
    if (!lockSuccess) { isSpinning = false; return; }

    // Xử lý góc quay ngẫu nhiên từ vị trí Server đồng bộ
    const targetIndex = Math.floor(Math.random() * 8);
    const degreesPerSegment = 360 / 8;
    const extraRounds = 5 * 360; // Xoay gia tốc tít mắt 5 vòng tròn lớn
    
    // Tính toán góc đảo ngược chuẩn theo chiều kim đồng hồ tương ứng mảng WHEEL_REWARDS
    wheelRotation += extraRounds + (360 - (targetIndex * degreesPerSegment)) - (wheelRotation % 360);

    const wheel = document.getElementById('wheel');
    wheel.style.transform = `rotate(${wheelRotation}deg)`;

    // Đợi hiệu ứng CSS hoàn thành trong 4 giây tĩnh
    setTimeout(async () => {
        isSpinning = false;
        const prize = WHEEL_REWARDS[targetIndex];
        
        if (prize.value > 0) {
            // Đẩy đơn cập nhật tài sản thực lĩnh cộng Xu lên bộ nhớ RAM
            await postAssetUpdate('spin_reward', { rewardCoins: prize.value });
            triggerHaptic('success');
            showToast(`🎉 Tuyệt vời! Bạn đã quay trúng +${prize.value.toLocaleString()} Xu!`);
        } else {
            triggerHaptic('medium');
            showToast("😢 Ôi trúng ô Mất Lượt rồi, chúc bạn may mắn lần sau!");
        }
    }, 4000);
}

// ==========================================
// 6. TÍCH HỢP SDK ADSGRAM & NHẬN LƯỢT QUAY
// ==========================================
function handleWatchAds() {
    if (serverUserState.dailyAdsCount >= CONFIG.MAX_DAILY_ADS) {
        triggerHaptic('error');
        showToast("❌ Bạn đã xem hết giới hạn số lượng Ads hôm nay.");
        return;
    }
    const timePassed = Math.floor((Date.now() - serverUserState.lastAdsTimestamp) / 1000);
    if (timePassed < CONFIG.ADS_COOLDOWN) {
        triggerHaptic('error');
        showToast("⏳ Vui lòng chờ thời gian chuẩn bị video kế tiếp.");
        return;
    }

    triggerHaptic('light');

    if (window.Adsgram) {
        // Khởi tạo Video sạc quảng cáo thực tế từ AdsGram Widget Block
        // Hãy cấu hình dán đúng Block ID thật của bạn vào chuỗi bên dưới khi được duyệt
        const AdController = window.Adsgram.createAdController('YOUR_BLOCK_ID');
        showToast("🔄 Đang kết nối luồng AdsGram...");
        
        AdController.show().then(async () => {
            // Người dùng xem trọn vẹn 100% độ dài quảng cáo thành công
            const ok = await postAssetUpdate('watch_ads_success');
            if (ok) {
                triggerHaptic('success');
                showToast("💎 Thành công! Cộng +12,000 Xu & +1 Lượt quay.");
            }
        }).catch((err) => {
            triggerHaptic('error');
            if (err && err.done === false) {
                showToast("⚠️ Bạn đã tắt video quá sớm! Không được nhận thưởng.");
            } else {
                showToast("❌ Lỗi đường truyền tải Video AdsGram.");
            }
        });
    } else {
        // Khối Sandbox dự phòng giả lập chạy thử trên môi trường duyệt Local Web thông thường
        showToast("📺 Chế độ Sandbox: Xem Ads thành công! (+1 Lượt)");
        setTimeout(async () => {
            await postAssetUpdate('watch_ads_success');
            triggerHaptic('success');
        }, 1200);
    }
}

// ==========================================
// 7. INITIALIZER ENTRY POINT (RÀNG BUỘC SỰ KIỆN)
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    // 1. Kéo dữ liệu lưu từ RAM server về đồng bộ giao diện tĩnh mồi sẵn
    fetchUserAccountData();
    
    // 2. Kích hoạt luồng chạy ngầm tính toán Cooldown từng giây liên tục
    runCooldownTimers();

    // Ràng buộc các sự kiện điều hành click chức năng chính
    document.getElementById('btn-spin').addEventListener('click', handleLuckyWheel);
    document.getElementById('btn-watch-ads').addEventListener('click', handleWatchAds);

    // 3. Xử lý sự kiện click gửi link chia sẻ mời bạn bè tại Tab 2
    document.getElementById('btn-invite-friend').addEventListener('click', () => {
        triggerHaptic('light');
        const shareUrl = document.getElementById('share-url-text').value;
        const textInvite = encodeURIComponent("🔥 Vào cày xu đổi tiền mặt và TON với mình cực dễ trên Telegram! Rút tiền uy tín cực kỳ luôn 👇");
        const telegramShareLink = `https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${textInvite}`;
        
        if (tg && tg.openTelegramLink) {
            tg.openTelegramLink(telegramShareLink);
        } else {
            window.open(telegramShareLink, '_blank');
        }
    });

    // 4. Xử lý nộp đơn gửi lệnh tạo yêu cầu rút tiền mặt/TON phân luồng logic mới
    document.getElementById('btn-submit-withdraw').addEventListener('click', async () => {
        const method = document.getElementById('withdraw-method').value;
        const address = document.getElementById('withdraw-address').value.trim();
        const amount = parseInt(document.getElementById('withdraw-amount').value, 10);

        // Hạn mức rút tối thiểu theo logic mới: 2,000 VNĐ = 2,000,000 Xu (Áp dụng riêng cho Momo và Bank)
        const MIN_COINS_REQUIRED = 2000000; 

        if (!address || isNaN(amount) || amount <= 0) {
            triggerHaptic('error');
            showToast("❌ Vui lòng nhập đầy đủ địa chỉ và số xu rút hợp lệ!");
            return;
        }

        // Nếu người chơi chọn rút MoMo hoặc Ngân hàng, Backend + Frontend bắt buộc kiểm tra hạn mức >= 2 triệu xu
        if ((method === 'momo' || method === 'bank') && amount < MIN_COINS_REQUIRED) {
            triggerHaptic('error');
            showToast(`❌ MoMo/Ngân hàng yêu cầu rút tối thiểu từ ${MIN_COINS_REQUIRED.toLocaleString()} Xu!`);
            return;
        }

        if (amount > serverUserState.coins) {
            triggerHaptic('error');
            showToast("❌ Số dư khả dụng trong tài khoản hiện tại không đủ!");
            return;
        }

        // Đẩy đơn rút tiền lên hàng chờ bộ não Server duyệt bắn cảnh báo tin nhắn Telegram
        const ok = await postAssetUpdate('withdraw_request', { 
            withdrawMethod: method, 
            withdrawAddress: address, 
            withdrawAmount: amount 
        });
        
        if (ok) {
            // Xóa sạch bộ form dữ liệu biểu mẫu sau khi đẩy đơn thành công ngầm lên RAM
            document.getElementById('withdraw-address').value = "";
            document.getElementById('withdraw-amount').value = "";
            triggerHaptic('success');
            updateUI();
            showToast("🎉 Lệnh rút tiền đã được gửi lên Chat duyệt của Admin!");
        }
    });
});

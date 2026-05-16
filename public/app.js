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

// Cấu hình các bộ tham số đếm ngược Cooldown và Hạn mức giống hệt file cũ của bạn
const CONFIG = {
    COIN_TO_VND_RATE: 1000,
    SPIN_COOLDOWN: 30,
    ADS_COOLDOWN: 60,
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
    dailyAdsCount: 0
};

// Hàm tạo hiệu ứng rung máy (Haptic Feedback) độc quyền của Telegram SDK
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

// ==========================================
// 2. KẾT NỐI MẠNG ĐỒNG BỘ REAL-TIME (FETCH API)
// ==========================================

// Hàm lấy dữ liệu tài khoản từ RAM của Render khi vừa mở ứng dụng
async function fetchUserAccountData() {
    if (!tg || !tg.initData) {
        console.warn("Ứng dụng chưa được kích hoạt trong Telegram Webview.");
        return;
    }
    try {
        const response = await fetch(`${BACKEND_API_URL}/api/user-data`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ initData: tg.initData }) // Gửi kèm chuỗi mã hóa bảo mật initData
        });
        if (response.ok) {
            serverUserState = await response.json();
            updateUI();
        }
    } catch (e) { 
        console.error("Lỗi tải thông tin từ RAM Server:", e); 
    }
}

// Hàm đẩy các biến động tài sản (Cộng xu, trừ lượt) lên thẳng RAM Server để chấm dứt hack cheat trái phép
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
        showToast("Mất kết nối máy chủ Render RAM!");
        return false;
    }
}

// ==========================================
// 3. ĐỒNG BỘ GIAO DIỆN TÀI SẢN (UI RENDERER)
// ==========================================
function updateUI() {
    // 1. Cập nhật Số dư và Quy đổi VNĐ ước lượng trên Header
    document.getElementById('user-points').innerText = serverUserState.coins.toLocaleString('en-US');
    document.getElementById('vnd-estimation').innerText = Math.floor(serverUserState.coins / CONFIG.COIN_TO_VND_RATE).toLocaleString('vi-VN');
    
    // 2. Cập nhật số lượt quay khả dụng
    document.getElementById('user-spins').innerText = serverUserState.spinsLeft;

    // 3. Xử lý hiển thị thông tin định danh và gán liên kết mời bạn bè (Ref Link)
    const usernameEl = document.getElementById('username');
    if (tg && tg.initDataUnsafe && tg.initDataUnsafe.user) {
        const u = tg.initDataUnsafe.user;
        usernameEl.innerText = u.first_name + (u.last_name ? " " + u.last_name : "");
        if (u.id) {
            // Liên kết tự động trỏ về Bot và truyền kèm mã Ref ID của người dùng
            document.getElementById('ref-link').value = `https://t.me/SieuCapCayXu_NDTTrung_Bot/app?startapp=ref_${u.id}`;
        }
    } else {
        usernameEl.innerText = "Chúa tể Cày Xu";
    }
}

// Hệ thống hiển thị thông báo đẩy Toast độc lập
function showToast(message) {
    const toast = document.getElementById('toast');
    toast.innerText = message;
    toast.classList.remove('hidden');
    toast.style.opacity = "1";
    setTimeout(() => {
        toast.style.opacity = "0";
        setTimeout(() => toast.classList.add('hidden'), 200);
    }, 2500);
}

// ==========================================
// 4. LUCKY WHEEL ENGINE (Logic Vòng Quay)
// ==========================================
const WHEEL_REWARDS = [
    { value: 1000 }, { value: 5000 }, { value: 0 }, { value: 10000 },
    { value: 500 }, { value: 20000 }, { value: 0 }, { value: 50000 }
];
let wheelRotation = 0;
let isSpinning = false;

async function handleLuckyWheel() {
    if (isSpinning) return;

    // Kiểm tra các điều kiện an toàn bề nổi trước khi kích hoạt API
    if (serverUserState.spinsLeft <= 0) {
        triggerHaptic('error');
        showToast("❌ Bạn đã hết lượt quay! Hãy xem Video để nạp thêm.");
        return;
    }
    if (serverUserState.dailySpinsCount >= CONFIG.MAX_DAILY_SPINS) {
        triggerHaptic('error');
        showToast(`❌ Đã đạt giới hạn tối đa quay hôm nay (${CONFIG.MAX_DAILY_SPINS} lần).`);
        return;
    }
    const timePassed = Math.floor((Date.now() - serverUserState.lastSpinTimestamp) / 1000);
    if (timePassed < CONFIG.SPIN_COOLDOWN) {
        triggerHaptic('error');
        showToast(`⏳ Vui lòng chờ thêm ${CONFIG.SPIN_COOLDOWN - timePassed}s.`);
        return;
    }

    isSpinning = true;
    triggerHaptic('heavy');

    // Gọi API thông báo Server khóa/trừ 1 lượt quay trước khi cho bánh xe chuyển động hình ảnh
    const lockSuccess = await postAssetUpdate('spin_start');
    if (!lockSuccess) { isSpinning = false; return; }

    // Thuật toán bốc ngẫu nhiên ô trúng thưởng (0 đến 7)
    const targetIndex = Math.floor(Math.random() * 8);
    const targetAngle = 360 - (targetIndex * 45); // Tính góc khớp vị trí Pointer ở đỉnh kim
    
    // Cộng dồn góc xoay tối thiểu 5 vòng (5 * 360) để tạo hiệu ứng chuyển động mượt mà
    wheelRotation += (5 * 360) + (targetAngle - (wheelRotation % 360));

    const wheel = document.getElementById('wheel');
    wheel.style.transform = `rotate(${wheelRotation}deg)`;

    // Đợi 4 giây cho vòng quay dừng lại theo đúng thiết lập CSS Transition
    setTimeout(async () => {
        isSpinning = false;
        const reward = WHEEL_REWARDS[targetIndex];
        
        if (reward.value > 0) {
            // Đồng bộ cộng tiền thưởng trực tiếp vào RAM Server
            await postAssetUpdate('spin_reward', { rewardCoins: reward.value });
            triggerHaptic('success');
            showToast(`🎉 Tuyệt vời! Bạn đã quay trúng +${reward.value.toLocaleString()} Xu.`);
        } else {
            triggerHaptic('medium');
            showToast("😢 Ôi trúng ô mất lượt rồi, chúc bạn may mắn lần sau!");
        }
    }, 4000);
}

// ==========================================
// 5. ADSGRAM GATEWAY (Mở Quảng Cáo Video)
// ==========================================
function handleWatchAds() {
    if (serverUserState.dailyAdsCount >= CONFIG.MAX_DAILY_ADS) {
        triggerHaptic('error');
        showToast(`❌ Bạn đã xem hết giới hạn Ads hôm nay (${CONFIG.MAX_DAILY_ADS}/${CONFIG.MAX_DAILY_ADS}).`);
        return;
    }
    const timePassed = Math.floor((Date.now() - serverUserState.lastAdsTimestamp) / 1000);
    if (timePassed < CONFIG.ADS_COOLDOWN) {
        triggerHaptic('error');
        showToast(`⏳ Vui lòng chờ ${CONFIG.ADS_COOLDOWN - timePassed}s để nạp luồng video mới.`);
        return;
    }

    if (window.Adsgram) {
        // Lấy bộ điều khiển từ ID khối quảng cáo thực tế của bạn
        // Hãy thay thế chuỗi 'YOUR_BLOCK_ID' bằng Block ID thật từ trang quản trị AdsGram của bạn
        const AdController = window.Adsgram.createAdController('YOUR_BLOCK_ID');
        showToast("🔄 Đang thiết lập kết nối AdsGram...");
        
        AdController.show().then(async () => {
            // Trình xử lý khi người dùng xem hết 100% độ dài video quảng cáo
            const ok = await postAssetUpdate('watch_ads_success');
            if (ok) {
                triggerHaptic('success');
                showToast("💎 Thành công rực rỡ! Cộng +12,000 Xu & +1 Lượt quay.");
            }
        }).catch((err) => {
            triggerHaptic('error');
            if (err && err.done === false) {
                showToast("⚠️ Bạn đã tắt video quá sớm! Không được nhận thưởng.");
            } else {
                showToast("❌ Không thể tải video quảng cáo vào lúc này.");
            }
        });
    } else {
        showToast("Môi trường Sandbox Test (Không tìm thấy thư viện AdsGram)");
    }
}

// ==========================================
// 6. THỜI GIAN THỰC KHÓA/MỞ NÚT (RATE LIMITING)
// ==========================================
function runCooldownTimers() {
    setInterval(() => {
        const now = Date.now();
        
        // --- Xử lý đếm giây Cooldown cho Vòng quay số ---
        const btnSpin = document.getElementById('btn-spin');
        if (!isSpinning) {
            const spinTime = Math.floor((now - serverUserState.lastSpinTimestamp) / 1000);
            if (serverUserState.dailySpinsCount >= CONFIG.MAX_DAILY_SPINS) {
                btnSpin.innerText = `❌ Đã hết hạn mức quay hôm nay`;
                btnSpin.disabled = true;
            } else if (spinTime < CONFIG.SPIN_COOLDOWN) {
                btnSpin.innerText = `⏳ Chờ quay: ${CONFIG.SPIN_COOLDOWN - spinTime}s`;
                btnSpin.disabled = true;
            } else {
                btnSpin.innerText = `🔥 QUAY NGAY (Còn ${serverUserState.spinsLeft} lượt)`;
                btnSpin.disabled = false;
            }
        }

        // --- Xử lý đếm giây Cooldown cho Nút xem quảng cáo Ads ---
        const btnAds = document.getElementById('btn-watch-ads');
        const adsTime = Math.floor((now - serverUserState.lastAdsTimestamp) / 1000);
        if (serverUserState.dailyAdsCount >= CONFIG.MAX_DAILY_ADS) {
            btnAds.innerHTML = `❌ Đã hết hạn mức Ads hôm nay`;
            btnAds.disabled = true;
        } else if (adsTime < CONFIG.ADS_COOLDOWN) {
            btnAds.innerHTML = `⏳ Khóa quảng cáo: ${CONFIG.ADS_COOLDOWN - adsTime}s`;
            btnAds.disabled = true;
        } else {
            btnAds.innerHTML = `<span class="icon">📺</span> Xem Video Ngắn (+12,000 Coins)`;
            btnAds.disabled = false;
        }
    }, 1000);
}

// ==========================================
// 7. RÀNG BUỘC SỰ KIỆN KHI DOM SẴN SÀNG
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    // 1. Kéo dữ liệu từ RAM Server về đồng bộ ngay khi vừa mở app
    fetchUserAccountData();
    
    // 2. Kích hoạt bộ lập lịch chạy ngầm tính giây đếm ngược Cooldown
    runCooldownTimers();

    // Ràng buộc sự kiện click của các Module điều khiển chính
    document.getElementById('btn-spin').addEventListener('click', handleLuckyWheel);
    document.getElementById('btn-watch-ads').addEventListener('click', handleWatchAds);
    
    // ---- Xử lý sao chép Link giới thiệu mời bạn bè ----
    document.getElementById('btn-copy-ref').addEventListener('click', () => {
        const link = document.getElementById('ref-link');
        link.select();
        link.setSelectionRange(0, 99999); // Hỗ trợ tối ưu trên Safari / iOS Mobile
        navigator.clipboard.writeText(link.value);
        triggerHaptic('light');
        showToast("📋 Đã sao chép đường dẫn mời thành công!");
    });

    // ---- Xử lý chia sẻ link mời trực tiếp vào danh bạ Telegram ----
    document.getElementById('btn-share-tg').addEventListener('click', () => {
        const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(document.getElementById('ref-link').value)}&text=${encodeURIComponent("Vào cày xu đổi tiền mặt và TON miễn phí với mình cực kỳ uy tín luôn này nha: 👇")}`;
        triggerHaptic('light');
        if (tg && tg.openTelegramLink) {
            tg.openTelegramLink(shareUrl);
        } else {
            window.open(shareUrl, '_blank');
        }
    });

    // ---- Xử lý nộp đơn gửi lệnh tạo yêu cầu rút tiền mặt/TON ----
    document.getElementById('btn-submit-withdraw').addEventListener('click', async () => {
        const method = document.getElementById('withdraw-method').value;
        const address = document.getElementById('withdraw-address').value.trim();
        const amount = parseInt(document.getElementById('withdraw-amount').value, 10);

        if (!address || isNaN(amount) || amount < 50000000) {
            triggerHaptic('error');
            showToast("❌ Thông tin nhập không đúng hoặc số xu dưới hạn mức 50M!");
            return;
        }
        if (amount > serverUserState.coins) {
            triggerHaptic('error');
            showToast("❌ Số dư khả dụng trong ví không đủ để rút!");
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
            showToast("🎉 Lệnh rút tiền đã được đẩy lên Chat duyệt của Admin!");
        }
    });
});

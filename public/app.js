/**
 * SIÊU CẤP KIẾM XU - TMA
 * Frontend Logic API Engine (Chạy Nguyên Khối trên Render)
 * Năm vận hành: 2026
 */

// ==========================================
// 1. KHỞI TẠO TELEGRAM SDK VÀ ĐỊNH TUYẾN API
// ==========================================
const tg = window.Telegram ? window.Telegram.WebApp : null;
const BACKEND_API_URL = window.location.origin; 

if (tg) {
    tg.ready();
    tg.expand(); // Kéo dãn ứng dụng tràn màn hình Mobile Webview
    if (tg.disableVerticalSwipes) tg.disableVerticalSwipes(); // Khóa thao tác vuốt trượt lỡ đóng app
}

const CONFIG = {
    COIN_TO_VND_RATE: 1000, // Tỷ lệ quy đổi tài sản: 1 VNĐ = 1000 Xu
    SPIN_COOLDOWN: 30,      // Thời gian chờ hồi chiêu vòng quay (giây)
    ADS_COOLDOWN: 60,       // Thời gian chờ xem lượt quảng cáo kế tiếp (giây)
    MAX_DAILY_SPINS: 10,
    MAX_DAILY_ADS: 5,
};

let serverUserState = {
    id: 0,
    coins: 50000, // Mồi sẵn 50,000 Xu tài khoản trải nghiệm ban đầu
    spinsLeft: 3,  // Mồi sẵn 3 lượt quay ban đầu tránh giật màn hình
    lastSpinTimestamp: 0,
    lastAdsTimestamp: 0,
    dailySpinsCount: 0,
    dailyAdsCount: 0,
    referrerId: null
};

// Mảng cấu trúc phần thưởng khớp chuẩn xác 100% với file index.html và server.js
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

let wheelRotation = 0; // Biến tích lũy góc quay vật lý
let isSpinning = false;

// ---- Hàm tiện ích hiển thị hộp thông báo nổi Toast ----
function showToast(message) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    container.innerText = message;
    container.style.opacity = '1';
    container.style.transform = 'translateX(-50%) translateY(-5px)';
    
    setTimeout(() => {
        container.style.opacity = '0';
        container.style.transform = 'translateX(-50%) translateY(0)';
    }, 2800);
}

// ---- Phản hồi rung phần cứng điện thoại (Haptic Feedback) ----
function triggerHaptic(type = 'light') {
    if (tg && tg.HapticFeedback) {
        if (type === 'success') tg.HapticFeedback.notificationOccurred('success');
        else if (type === 'error') tg.HapticFeedback.notificationOccurred('error');
        else tg.HapticFeedback.impactOccurred(type);
    }
}

// ---- Định dạng hiển thị chuỗi số phân tách dấu phẩy ----
function formatNumber(num) {
    return Number(num).toLocaleString('vi-VN');
}

// ==========================================
// 2. RENDER VÀ ĐỒNG BỘ GIAO DIỆN NGƯỜI DÙNG (UI)
// ==========================================
function updateUI() {
    // 1. Đồng bộ số dư Xu và VNĐ ước lượng trực quan công khai
    if (document.getElementById('user-points')) {
        document.getElementById('user-points').innerText = formatNumber(serverUserState.coins);
    }
    if (document.getElementById('vnd-estimation')) {
        document.getElementById('vnd-estimation').innerText = formatNumber(Math.floor(serverUserState.coins / CONFIG.COIN_TO_VND_RATE));
    }
    
    // 2. Cập nhật nhãn tên hiển thị người dùng
    if (document.getElementById('username')) {
        if (tg && tg.initDataUnsafe && tg.initDataUnsafe.user) {
            const u = tg.initDataUnsafe.user;
            document.getElementById('username').innerText = u.first_name + (u.last_name ? " " + u.last_name : "");
        } else if (serverUserState.username) {
            document.getElementById('username').innerText = `@${serverUserState.username}`;
        } else {
            document.getElementById('username').innerText = serverUserState.first_name || "Người chơi";
        }
    }

    // 3. Cập nhật trạng thái hiển thị bên Tab Vòng Quay
    if (document.getElementById('user-spins')) {
        document.getElementById('user-spins').innerText = serverUserState.spinsLeft ?? 0;
    }
    if (document.getElementById('daily-spin-count')) {
        document.getElementById('daily-spin-count').innerText = `${serverUserState.dailySpinsCount || 0}/${CONFIG.MAX_DAILY_SPINS}`;
    }
    if (document.getElementById('daily-ads-count')) {
        document.getElementById('daily-ads-count').innerText = `${serverUserState.dailyAdsCount || 0}/${CONFIG.MAX_DAILY_ADS} hôm nay`;
    }

    // 4. Cập nhật Link mời bạn bè độc quyền tại Tab 2
    if (document.getElementById('share-link')) {
        let shareId = (tg && tg.initDataUnsafe && tg.initDataUnsafe.user) ? tg.initDataUnsafe.user.id : serverUserState.id;
        document.getElementById('share-link').value = `https://t.me/SieuCapCayXu_NDTTrung_Bot/app?startapp=ref_${shareId}`;
    }
}

// ==========================================
// 3. BỘ ĐẾM GIÂY CHẠY NGẦM (COOLDOWN TIMER ENGINE)
// ==========================================
function runCooldownTimers() {
    setInterval(() => {
        const now = Date.now();

        // 1. Quản lý đồng hồ trạng thái nút bấm Vòng quay
        const btnSpin = document.getElementById('btn-spin');
        const spinCooldownEl = document.getElementById('spin-cooldown');
        
        if (btnSpin && spinCooldownEl) {
            if (!isSpinning) {
                const spinTime = Math.floor((now - serverUserState.lastSpinTimestamp) / 1000);
                
                if (serverUserState.dailySpinsCount >= CONFIG.MAX_DAILY_SPINS) {
                    btnSpin.innerText = `❌ HẾT HẠN MỨC NGÀY`;
                    btnSpin.disabled = true;
                    spinCooldownEl.classList.add('hidden');
                } else if (spinTime < CONFIG.SPIN_COOLDOWN) {
                    const remains = CONFIG.SPIN_COOLDOWN - spinTime;
                    btnSpin.innerText = `⏳ ĐANG HỒI NĂNG LƯỢNG`;
                    btnSpin.disabled = true;
                    
                    spinCooldownEl.classList.remove('hidden');
                    spinCooldownEl.querySelector('span').innerText = remains;
                } else {
                    btnSpin.innerText = `🎡 QUAY NGAY`;
                    btnSpin.disabled = (serverUserState.spinsLeft <= 0);
                    spinCooldownEl.classList.add('hidden');
                }
            }
        }

        // 2. Quản lý đồng hồ trạng thái nút bấm Xem Video Ads
        const btnAds = document.getElementById('btn-watch-ad');
        const adCooldownEl = document.getElementById('ad-cooldown');
        
        if (btnAds && adCooldownEl) {
            const adsTime = Math.floor((now - serverUserState.lastAdsTimestamp) / 1000);

            if (serverUserState.dailyAdsCount >= CONFIG.MAX_DAILY_ADS) {
                btnAds.innerText = `❌ ĐÃ HẾT LƯỢT XEM HÔM NAY`;
                btnAds.disabled = true;
                adCooldownEl.classList.add('hidden');
            } else if (adsTime < CONFIG.ADS_COOLDOWN) {
                const remains = CONFIG.ADS_COOLDOWN - adsTime;
                btnAds.innerText = `⏳ CHỜ ADS: ${remains}s`;
                btnAds.disabled = true;
                
                adCooldownEl.classList.remove('hidden');
                adCooldownEl.querySelector('span').innerText = remains;
            } else {
                btnAds.innerText = `▶ Xem Video Quảng Cáo`;
                btnAds.disabled = false;
                adCooldownEl.classList.add('hidden');
            }
        }
    }, 1000);
}

// ==========================================
// 4. KẾT NỐI ĐỒNG BỘ DỮ LIỆU VỚI BACKEND SERVER
// ==========================================
async function fetchUserAccountData() {
    if (!tg || !tg.initData) return;
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

    // Khóa trừ lượt và ghi nhận mốc thời gian an toàn ngầm từ xa trên RAM
    const lockSuccess = await postAssetUpdate('spin_start');
    if (!lockSuccess) { isSpinning = false; return; }

    // Xử lý góc quay ngẫu nhiên tập trung khớp nhãn cung đồ họa CSS
    const targetIndex = Math.floor(Math.random() * 8);
    const degreesPerSegment = 360 / 8;
    const extraRounds = 5 * 360; // Quay gia tốc tít mắt 5 vòng lớn tạo độ kịch tính
    
    wheelRotation += extraRounds + (360 - (targetIndex * degreesPerSegment)) - (wheelRotation % 360);

    const wheel = document.getElementById('wheel');
    if (wheel) {
        wheel.style.transform = `rotate(${wheelRotation}deg)`;
    }

    // Đợi hiệu ứng CSS transition hoàn tất trong 4 giây tĩnh
    setTimeout(async () => {
        isSpinning = false;
        const prize = WHEEL_REWARDS[targetIndex];
        
        // Đẩy đơn cập nhật cộng Xu thực lĩnh lên bộ nhớ RAM Server
        await postAssetUpdate('spin_reward', { rewardCoins: prize.value });
        triggerHaptic('success');
        showToast(`🎉 Tuyệt vời! Bạn đã quay trúng +${prize.value.toLocaleString()} Xu!`);
    }, 4000);
}

// ==========================================
// 6. TÍCH HỢP SDK ADSGRAM LIVE & NHẬN LƯỢT QUAY
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
        // 🌟 CẤU HÌNH LIVE: Đã tích hợp Block ID thực tế 30379 của bạn
        const AdController = window.Adsgram.createAdController('30379');
        showToast("🔄 Đang kết nối luồng AdsGram...");
        
        AdController.show().then(async () => {
            // Trình phát Video chạy hoàn thành trọn vẹn 15 giây thành công
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
    if (document.getElementById('btn-spin')) {
        document.getElementById('btn-spin').addEventListener('click', handleLuckyWheel);
    }
    if (document.getElementById('btn-watch-ad')) {
        document.getElementById('btn-watch-ad').addEventListener('click', handleWatchAds);
    }

    // 3. Xử lý sao chép link mời nhanh ở Tab 2
    if (document.getElementById('btn-copy-link')) {
        document.getElementById('btn-copy-link').addEventListener('click', () => {
            triggerHaptic('light');
            const shareUrlText = document.getElementById('share-link');
            if (shareUrlText) {
                shareUrlText.select();
                shareUrlText.setSelectionRange(0, 99999);
                navigator.clipboard.writeText(shareUrlText.value);
                showToast("📋 Đã sao chép liên kết mời thành công!");
            }
        });
    }

    // 4. Xử lý sự kiện click gửi link chia sẻ mời bạn bè tại Tab 2
    if (document.getElementById('btn-share-tg')) {
        document.getElementById('btn-share-tg').addEventListener('click', () => {
            triggerHaptic('light');
            const shareUrl = document.getElementById('share-link').value;
            const textInvite = encodeURIComponent("🔥 Vào cày xu đổi tiền mặt và TON với mình cực dễ trên Telegram! Rút tiền uy tín cực kỳ luôn 👇");
            const telegramShareLink = `https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${textInvite}`;
            
            if (tg && tg.openTelegramLink) {
                tg.openTelegramLink(telegramShareLink);
            } else {
                window.open(telegramShareLink, '_blank');
            }
        });
    }

    // 5. Xử lý nộp đơn gửi lệnh tạo yêu cầu rút tiền mặt/TON phân luồng logic mới
    if (document.getElementById('btn-submit-withdraw')) {
        document.getElementById('btn-submit-withdraw').addEventListener('click', async () => {
            const method = document.getElementById('withdraw-method').value;
            const address = document.getElementById('withdraw-address').value.trim();
            const amount = parseInt(document.getElementById('withdraw-amount').value, 10);
            const MIN_COINS_REQUIRED = 2000000; 

            if (!address || isNaN(amount) || amount <= 0) {
                triggerHaptic('error');
                showToast("❌ Vui lòng nhập đầy đủ địa chỉ và số xu rút hợp lệ!");
                return;
            }

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

            // Gửi lệnh tạo đơn an toàn lên bộ não Server RAM duyệt
            const ok = await postAssetUpdate('withdraw_request', { 
                withdrawMethod: method, 
                withdrawAddress: address, 
                withdrawAmount: amount 
            });
            
            if (ok) {
                document.getElementById('withdraw-address').value = "";
                document.getElementById('withdraw-amount').value = "";
                triggerHaptic('success');
                updateUI();
                showToast("🎉 Lệnh rút tiền đã được gửi lên Chat duyệt của Admin!");
            }
        });
    }
});

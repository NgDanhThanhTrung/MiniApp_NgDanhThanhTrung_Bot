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
    { text: "10K XU",   value: 10000 },
    { text: "MẤT LƯỢT", value: 0 },
    { text: "50K XU",   value: 50000 },
    { text: "THÊM LƯỢT", value: 0 }, // Logic xử lý thêm lượt quay được quản lý riêng
    { text: "5K XU",    value: 5000 },
    { text: "CHIA ĐÔI",  value: 0 },
    { text: "100K XU",  value: 100000 },
    { text: "X2 XU",     value: 0 }
];

// 🌟 VÁ LỖI CỐT LÕI: Khai báo biến toàn cục tích lũy góc xoay vật lý để vòng quay hoạt động
let wheelRotation = 0; 
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
    let toast = document.getElementById('toast-container');
    if (!toast) return;
    
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
        
        // Cập nhật Link mời bạn bè độc quyền tại Tab 2 khớp với cấu trúc index.html mới
        if (u.id && document.getElementById('share-link')) {
            document.getElementById('share-link').value = `https://t.me/SieuCapCayXu_NDTTrung_Bot/app?startapp=ref_${u.id}`;
        }
    }
    if (document.getElementById('username')) {
        document.getElementById('username').innerText = usernameDisplay;
    }

    // Cập nhật số dư và số tiền VNĐ ước lượng trực quan công khai
    const coins = serverUserState.coins || 0;
    if (document.getElementById('user-points')) {
        document.getElementById('user-points').innerText = coins.toLocaleString('en-US');
    }
    
    if (document.getElementById('vnd-estimation')) {
        const vndEstimation = Math.floor(coins / CONFIG.COIN_TO_VND_RATE);
        document.getElementById('vnd-estimation').innerText = vndEstimation.toLocaleString('vi-VN');
    }

    // Cập nhật số lượt quay khả dụng và bộ đếm mốc giới hạn ngày
    if (document.getElementById('user-spins')) {
        document.getElementById('user-spins').innerText = serverUserState.spinsLeft ?? 0;
    }
    if (document.getElementById('daily-spin-count')) {
        document.getElementById('daily-spin-count').innerText = `${serverUserState.dailySpinsCount || 0}/${CONFIG.MAX_DAILY_SPINS}`;
    }
    if (document.getElementById('daily-ads-count')) {
        document.getElementById('daily-ads-count').innerText = `${serverUserState.dailyAdsCount || 0}/${CONFIG.MAX_DAILY_ADS} hôm nay`;
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
                    btnSpin.disabled = false;
                    spinCooldownEl.classList.add('hidden');
                }
            }
        }

        // 2. Quản lý trạng thái và bộ đếm chữ nút Xem Video Ads
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
    
    // Tính toán góc xoay vật lý lũy tiến chuẩn xác hướng tâm khớp với index.html mới
    wheelRotation += extraRounds + (360 - (targetIndex * degreesPerSegment)) - (wheelRotation % 360);

    // Đồng bộ gọi chuẩn ID "wheel" bọc các segment trong index.html
    const wheel = document.getElementById('wheel');
    if (wheel) {
        wheel.style.transform = `rotate(${wheelRotation}deg)`;
    }

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
            showToast(`😢 Ôi trúng ô ${prize.text} rồi, chúc bạn may mắn lần sau!`);
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
        // Hãy cấu hình dán đúng Block ID thật của bạn vào chuỗi bên dưới khi được duyệt từ Adsgram
        const AdController = window.Adsgram.createAdController('YOUR_BLOCK_ID');
        showToast("🔄 Đang kết nối luồng AdsGram...");
        
        AdController.show().then(async () => {
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

    // Ràng buộc các sự kiện điều hành click chức năng chính khớp ID mới
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

            // Hạn mức rút tối thiểu theo logic mới: 2,000 VNĐ = 2,000,000 Xu (Áp dụng riêng cho Momo và Bank)
            const MIN_COINS_REQUIRED = 2000000; 

            if (!address || isNaN(amount) || amount <= 0) {
                triggerHaptic('error');
                showToast("❌ Vui lòng nhập đầy đủ địa chỉ và số xu rút hợp lệ!");
                return;
            }

            // Kiểm tra hạn mức tối thiểu mốc 2 triệu xu cho Momo/Bank
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
                document.getElementById('withdraw-address').value = "";
                document.getElementById('withdraw-amount').value = "";
                triggerHaptic('success');
                updateUI();
                showToast("🎉 Lệnh rút tiền đã được gửi lên Chat duyệt của Admin!");
            }
        });
    }
});

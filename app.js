/**
 * SIÊU CẤP KIẾM XU - TMA
 * Core Logic Engine (Event-Driven & Mobile-First)
 * Năm vận hành: 2026
 */

// ==========================================
// 1. TELEGRAM CORE INITIALIZATION
// ==========================================
const tg = window.Telegram ? window.Telegram.WebApp : null;

if (tg) {
    tg.ready();
    tg.expand(); // Kéo dãn ứng dụng tràn màn hình Mobile
    // Kích hoạt tính năng vuốt để đóng nếu cần, hoặc giữ ứng dụng cố định
    if (tg.disableVerticalSwipes) tg.disableVerticalSwipes();
}

// Hàm tiện ích kích hoạt phản hồi rung (Haptic Feedback)
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
// 2. STATE & STORAGE ENGINE
// ==========================================
const CONFIG = {
    COIN_TO_VND_RATE: 1000,      // 1đ = 1,000 Xu
    TON_PRICE_VND: 140000,       // Giả định tỷ giá 1 TON = 140.000 VNĐ năm 2026
    MIN_WITHDRAW_VND: 2000,      // Rút tối thiểu 2.000đ
    MIN_WITHDRAW_TON: 0.0003,    // Rút tối thiểu 0.0003 TON
    SPIN_COOLDOWN: 30,           // 30 giây giữa các lần quay
    ADS_COOLDOWN: 60,            // 60 giây giữa các lần xem Ads
    MAX_DAILY_SPINS: 10,         // Giới hạn 10 lần quay / ngày
    MAX_DAILY_ADS: 5,            // Giới hạn 5 lần xem Ads / ngày
    ADS_REWARD_COINS: 12000,     // Thưởng xem Ads
};

// Khởi tạo trạng thái mặc định của người dùng
let userState = {
    coins: 50000,                // Tặng sẵn 50k xu trải nghiệm ban đầu
    spinsLeft: 3,                // Số lượt quay khả dụng hiện tại
    lastSpinTimestamp: 0,        // Mốc thời gian (ms) click quay cuối
    lastAdsTimestamp: 0,         // Mốc thời gian (ms) click xem ads cuối
    dailySpinsCount: 0,          // Số lần đã quay trong ngày
    dailyAdsCount: 0,            // Số lần đã xem Ads trong ngày
    lastActiveDate: ""           // Định dạng lưu ngày: YYYY-MM-DD
};

// Tải dữ liệu từ LocalStorage và xử lý Auto-Reset theo ngày
function loadAndSyncState() {
    const savedState = localStorage.getItem('tma_user_state');
    const todayStr = new Date().toISOString().split('T')[0]; // Lấy chuỗi YYYY-MM-DD

    if (savedState) {
        try {
            const parsed = JSON.parse(savedState);
            userState = { ...userState, ...parsed };
        } catch (e) {
            console.error("Lỗi parse LocalStorage, dùng state mặc định", e);
        }
    }

    // Cơ chế Auto-Reset: Nếu qua ngày mới, làm mới hạn mức cày cuốc
    if (userState.lastActiveDate !== todayStr) {
        userState.dailySpinsCount = 0;
        userState.dailyAdsCount = 0;
        userState.spinsLeft = Math.max(userState.spinsLeft, 3); // Hoàn lại tối thiểu 3 lượt quay
        userState.lastActiveDate = todayStr;
        saveState();
    }
}

function saveState() {
    localStorage.setItem('tma_user_state', JSON.stringify(userState));
}

// ==========================================
// 3. DATA SYNCHRONIZATION UI
// ==========================================
// Danh sách các phần thưởng trên Vòng quay theo thứ tự phân mảnh (1-8)
const WHEEL_REWARDS = [
    { type: 'coin', value: 1000 },
    { type: 'coin', value: 5000 },
    { type: 'lose', value: 0 },
    { type: 'coin', value: 10000 },
    { type: 'coin', value: 550 },
    { type: 'coin', value: 20000 },
    { type: 'lose', value: 0 },
    { type: 'coin', value: 50000 }
];

let currentWheelRotation = 0; 
let isWheelSpinning = false;

function updateUI() {
    // 1. Cập nhật Header & Số dư
    document.getElementById('user-points').innerText = userState.coins.toLocaleString('en-US');
    
    const vndEstimation = Math.floor(userState.coins / CONFIG.COIN_TO_VND_RATE);
    document.getElementById('vnd-estimation').innerText = vndEstimation.toLocaleString('vi-VN');

    // 2. Cập nhật thông tin định danh Telegram
    const usernameEl = document.getElementById('username');
    if (tg && tg.initDataUnsafe && tg.initDataUnsafe.user) {
        const user = tg.initDataUnsafe.user;
        usernameEl.innerText = user.first_name + (user.last_name ? " " + user.last_name : "");
        if (user.username) {
            document.getElementById('ref-link').value = `https://t.me/SieuCapCayXu_NDTTrung_Bot/app?startapp=ref_${user.id}`;
        }
    } else {
        usernameEl.innerText = "Chúa tể Cày Xu";
    }

    // 3. Cập nhật Trạng thái hiển thị lượt quay khả dụng
    document.getElementById('user-spins').innerText = userState.spinsLeft;

    // 4. Tính toán số xu tương đương tối thiểu cho TON Network trong bảng đổi thưởng
    const tonMinCoins = CONFIG.MIN_WITHDRAW_TON * CONFIG.TON_PRICE_VND * CONFIG.COIN_TO_VND_RATE;
    document.getElementById('ton-min-coins').innerText = tonMinCoins.toLocaleString('en-US') + " Xu";
}

// Hệ thống hiển thị thông báo Toast nhanh
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
// 4. LUCKY WHEEL ENGINE (Logic Đòn bẩy thời gian)
// ==========================================
function handleLuckyWheel() {
    const btnSpin = document.getElementById('btn-spin');
    
    if (isWheelSpinning) return;

    // Kiểm tra số lượt quay khả dụng
    if (userState.spinsLeft <= 0) {
        triggerHaptic('error');
        showToast("❌ Bạn đã hết lượt quay! Vui lòng xem Video để nạp thêm.");
        return;
    }

    // Kiểm tra giới hạn tối đa trong ngày
    if (userState.dailySpinsCount >= CONFIG.MAX_DAILY_SPINS) {
        triggerHaptic('error');
        showToast(`❌ Đã đạt giới hạn quay hôm nay (${CONFIG.MAX_DAILY_SPINS}/${CONFIG.MAX_DAILY_SPINS} lần).`);
        return;
    }

    // Kiểm tra Cooldown thời gian giữa các lượt quay (30 giây)
    const now = Date.now();
    const timePassed = Math.floor((now - userState.lastSpinTimestamp) / 1000);
    if (timePassed < CONFIG.SPIN_COOLDOWN) {
        triggerHaptic('error');
        showToast(`⏳ Thao tác quá nhanh! Vui lòng đợi ${CONFIG.SPIN_COOLDOWN - timePassed}s.`);
        return;
    }

    // Đạt điều kiện -> Tiến hành quay
    isWheelSpinning = true;
    userState.spinsLeft -= 1;
    userState.dailySpinsCount += 1;
    userState.lastSpinTimestamp = now;
    saveState();
    updateUI();
    triggerHaptic('heavy');

    // Thuật toán tính góc quay ngẫu nhiên từ 1 đến 8 ô
    const totalSegments = 8;
    const targetSegmentIndex = Math.floor(Math.random() * totalSegments); // Ô trúng thưởng (0 đến 7)
    
    // Đảo ngược hướng quay vật lý cho đúng chiều kim đồng hồ tương ứng góc CSS pointer đặt ở đỉnh (top)
    // Mỗi ô chiếm góc 45 độ (360 / 8)
    const targetAngle = 360 - (targetSegmentIndex * 45); 
    const extraRounds = 5 * 360; // Quay ít nhất 5 vòng tạo hiệu ứng kịch tính
    currentWheelRotation += extraRounds + (targetAngle - (currentWheelRotation % 360));

    const wheel = document.getElementById('wheel');
    wheel.style.transform = `rotate(${currentWheelRotation}deg)`;

    // Xử lý sự kiện kết thúc chuyển động quay sau 4 giây (theo CSS transition)
    setTimeout(() => {
        isWheelSpinning = false;
        const reward = WHEEL_REWARDS[targetSegmentIndex];

        if (reward.type === 'coin') {
            userState.coins += reward.value;
            triggerHaptic('success');
            showToast(`🎉 Chúc mừng! Bạn trúng +${reward.value.toLocaleString()} Xu.`);
        } else {
            triggerHaptic('medium');
            showToast("😢 Ôi tiếc quá! Lần này chưa trúng rồi, thử lại nhé!");
        }

        saveState();
        updateUI();
    }, 4000);
}

// Vòng lặp thời gian thực khóa/mở nút dựa trên Cooldown (Rate Limiting)
function runCooldownTimers() {
    setInterval(() => {
        const now = Date.now();
        
        // Cooldown cho nút Quay số
        const btnSpin = document.getElementById('btn-spin');
        if (!isWheelSpinning) {
            const spinTimePassed = Math.floor((now - userState.lastSpinTimestamp) / 1000);
            if (userState.dailySpinsCount >= CONFIG.MAX_DAILY_SPINS) {
                btnSpin.innerText = `❌ Đã quay hết ${CONFIG.MAX_DAILY_SPINS}/${CONFIG.MAX_DAILY_SPINS} lần`;
                btnSpin.disabled = true;
            } else if (spinTimePassed < CONFIG.SPIN_COOLDOWN) {
                btnSpin.innerText = `⏳ Chờ quay lại: ${CONFIG.SPIN_COOLDOWN - spinTimePassed}s`;
                btnSpin.disabled = true;
            } else {
                btnSpin.innerText = `🔥 QUAY NGAY (Còn ${userState.spinsLeft} lượt)`;
                btnSpin.disabled = false;
            }
        }

        // Cooldown cho nút Xem Ads
        const btnAds = document.getElementById('btn-watch-ads');
        const adsTimePassed = Math.floor((now - userState.lastAdsTimestamp) / 1000);
        if (userState.dailyAdsCount >= CONFIG.MAX_DAILY_ADS) {
            btnAds.innerHTML = `❌ Đã xem hết hạn mức hôm nay (${CONFIG.MAX_DAILY_ADS}/${CONFIG.MAX_DAILY_ADS})`;
            btnAds.disabled = true;
        } else if (adsTimePassed < CONFIG.ADS_COOLDOWN) {
            btnAds.innerHTML = `⏳ Block quảng cáo: ${CONFIG.ADS_COOLDOWN - adsTimePassed}s`;
            btnAds.disabled = true;
        } else {
            btnAds.innerHTML = `<span class="icon">📺</span> Xem Video Ngắn (+12,000 Coins)`;
            btnAds.disabled = false;
        }

    }, 1000);
}

// ==========================================
// 5. ADSGRAM GATEWAY (Rewarded Video Handler)
// ==========================================
function handleWatchAds() {
    // 1. Kiểm tra giới hạn số lần xem trong ngày
    if (userState.dailyAdsCount >= CONFIG.MAX_DAILY_ADS) {
        triggerHaptic('error');
        showToast(`❌ Bạn đã xem hết ${CONFIG.MAX_DAILY_ADS} video cho hôm nay.`);
        return;
    }

    // 2. Kiểm tra Cooldown thời gian (1 phút)
    const now = Date.now();
    const timePassed = Math.floor((now - userState.lastAdsTimestamp) / 1000);
    if (timePassed < CONFIG.ADS_COOLDOWN) {
        triggerHaptic('error');
        showToast(`⏳ Vui lòng chờ ${CONFIG.ADS_COOLDOWN - timePassed} giây để chuẩn bị video tiếp theo.`);
        return;
    }

    // 3. Khởi tạo và gọi trình phân phối AdsGram thông qua SDK định nghĩa sẵn trong Window
    if (window.Adsgram) {
        // Thay 'YOUR_BLOCK_ID' bằng ID khối quảng cáo thực tế do AdsGram cấp khi đăng ký app
        const AdController = window.Adsgram.createAdController('YOUR_BLOCK_ID'); 
        
        showToast("🔄 Đang kết nối máy chủ AdsGram...");
        
        AdController.show().then((result) => {
            // Trường hợp: Người dùng xem hết toàn bộ video thành công
            userState.coins += CONFIG.ADS_REWARD_COINS;
            userState.spinsLeft += 1; // Khuyến mãi tặng thêm 1 lượt quay
            userState.dailyAdsCount += 1;
            userState.lastAdsTimestamp = Date.now();
            
            saveState();
            updateUI();
            triggerHaptic('success');
            showToast(`💎 Thập toàn đại mỹ! Cộng +${CONFIG.ADS_REWARD_COINS.toLocaleString()} Xu & +1 Lượt quay.`);
        }).catch((err) => {
            // Trường hợp: Người dùng tắt ngang hoặc lỗi tải luồng video quảng cáo
            triggerHaptic('error');
            if (err && err.done === false) {
                showToast("⚠️ Bạn đã bỏ qua video quá sớm! Không thể nhận thưởng.");
            } else {
                showToast("❌ Lỗi mạng hoặc AdsGram không thể tải quảng cáo lúc này.");
            }
        });
    } else {
        // Giả lập Fallback nếu test trên trình duyệt PC không chạy SDK Telegram/Adsgram
        console.warn("Không tìm thấy SDK AdsGram. Tiến hành kích hoạt Sandbox Thử nghiệm.");
        userState.coins += CONFIG.ADS_REWARD_COINS;
        userState.spinsLeft += 1;
        userState.dailyAdsCount += 1;
        userState.lastAdsTimestamp = Date.now();
        saveState();
        updateUI();
        showToast("[Sandbox] Đã nhận +12,000 Xu (Môi trường Test)");
    }
}

// ==========================================
// 6. VIRAL & WITHDRAWAL ACTIONS
// ==========================================
function setupViralAndWithdraw() {
    // ---- Xử lý Copy Link Giới Thiệu ----
    document.getElementById('btn-copy-ref').addEventListener('click', () => {
        const copyText = document.getElementById('ref-link');
        copyText.select();
        copyText.setSelectionRange(0, 99999); // Hỗ trợ thiết bị di động
        
        try {
            navigator.clipboard.writeText(copyText.value);
            triggerHaptic('light');
            showToast("📋 Đã sao chép liên kết giới thiệu của bạn!");
        } catch (err) {
            showToast("❌ Trình duyệt không hỗ trợ sao chép tự động.");
        }
    });

    // ---- Xử lý Chia Sẻ Link Trực Tiếp Lên Telegram Chat ----
    document.getElementById('btn-share-tg').addEventListener('click', () => {
        const refLink = document.getElementById('ref-link').value;
        const shareText = encodeURIComponent("🔥 Cày xu đổi tiền thật cực uy tín trên Telegram! Nhận ngay 12k Xu tân thủ tại đây:");
        const tgShareUrl = `https://t.me/share/url?url=${encodeURIComponent(refLink)}&text=${shareText}`;
        
        triggerHaptic('light');
        if (tg && tg.openTelegramLink) {
            tg.openTelegramLink(tgShareUrl);
        } else {
            window.open(tgShareUrl, '_blank');
        }
    });

    // ---- Xử lý Lệnh Tạo Yêu Cầu Rút Tiền ----
    document.getElementById('btn-submit-withdraw').addEventListener('click', () => {
        const method = document.getElementById('withdraw-method').value;
        const address = document.getElementById('withdraw-address').value.trim();
        const amountInput = document.getElementById('withdraw-amount').value;
        const amount = parseInt(amountInput, 10);

        // Kiểm tra dữ liệu đầu vào cơ bản
        if (!address) {
            triggerHaptic('error');
            showToast("❌ Vui lòng nhập địa chỉ ví nhận tiền hoặc STK ngân hàng!");
            return;
        }

        if (isNaN(amount) || amount <= 0) {
            triggerHaptic('error');
            showToast("❌ Số Xu muốn rút không hợp lệ!");
            return;
        }

        if (amount > userState.coins) {
            triggerHaptic('error');
            showToast("❌ Số dư tài khoản không đủ để thực hiện giao dịch này.");
            return;
        }

        // Kiểm tra điều kiện rút tối thiểu (Hạn mức sàn)
        if (method === 'ton') {
            const minTonCoins = CONFIG.MIN_WITHDRAW_TON * CONFIG.TON_PRICE_VND * CONFIG.COIN_TO_VND_RATE;
            if (amount < minTonCoins) {
                triggerHaptic('error');
                showToast(`❌ Ví TON yêu cầu rút tối thiểu từ ${minTonCoins.toLocaleString()} Xu.`);
                return;
            }
        } else { // Phương thức momo hoặc bank (VNĐ)
            if (amount < (CONFIG.MIN_WITHDRAW_VND * CONFIG.COIN_TO_VND_RATE)) {
                triggerHaptic('error');
                showToast(`❌ VNĐ/MoMo yêu cầu rút tối thiểu từ ${(CONFIG.MIN_WITHDRAW_VND * CONFIG.COIN_TO_VND_RATE).toLocaleString()} Xu.`);
                return;
            }
        }

        // Chấp thuận điều kiện và trừ tiền (Simulation Approved)
        userState.coins -= amount;
        saveState();
        updateUI();
        
        // Reset form
        document.getElementById('withdraw-address').value = "";
        document.getElementById('withdraw-amount').value = "";

        triggerHaptic('success');
        
        // Hiển thị hộp thoại xác nhận gốc của Telegram nếu có
        if (tg && tg.showPopup) {
            tg.showPopup({
                title: '🎉 Khởi Tạo Lệnh Thành Công',
                message: `Yêu cầu rút ${amount.toLocaleString()} Xu đã được gửi vào hàng đợi duyệt tự động. Dự kiến tiền về trong 5-15 phút.`,
                buttons: [{ type: 'ok' }]
            });
        } else {
            alert(`🎉 Khởi Tạo Lệnh Thành Công!\nHệ thống tự động duyệt yêu cầu rút ${amount.toLocaleString()} Xu của bạn.`);
        }
    });
}

// ==========================================
// 7. INITIALIZER ENTRY POINT
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    // Nạp dữ liệu cũ và đồng bộ reset ngày mới
    loadAndSyncState();
    
    // Đổ dữ liệu lên giao diện
    updateUI();
    
    // Chạy ngầm các bộ đếm giây
    runCooldownTimers();

    // Ràng buộc sự kiện click của các Module hành động
    document.getElementById('btn-spin').addEventListener('click', handleLuckyWheel);
    document.getElementById('btn-watch-ads').addEventListener('click', handleWatchAds);
    
    // Cài đặt sự kiện Viral & Rút tiền
    setupViralAndWithdraw();
});
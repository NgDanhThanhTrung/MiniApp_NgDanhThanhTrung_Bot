/**
 * SIÊU CẤP KIẾM XU - TMA
 * Frontend Logic API Engine (Chạy Nguyên Khối kết nối Realtime với RAM Server)
 * Năm vận hành: 2026
 * Phiên bản: 3.0.0 (Đồng nhất cấu trúc API Tham số userId chuẩn toàn hệ thống)
 */

// ==========================================
// 1. KHỞI TẠO TELEGRAM SDK VÀ ĐỊNH TUYẾN API
// ==========================================
const tg = window.Telegram ? window.Telegram.WebApp : null;
const BACKEND_API_URL = window.location.origin; 

if (tg) {
    tg.ready();
    tg.expand(); 
    if (tg.disableVerticalSwipes) tg.disableVerticalSwipes(); 
}

// Cấu hình các tham số đồng bộ khớp 100% với Server cấu hình
const CONFIG = {
    COIN_TO_VND_RATE: 1000, 
    SPIN_COOLDOWN: 30,      
    ADS_COOLDOWN: 60,       
    MAX_DAILY_SPINS: 10,
    MAX_DAILY_ADS: 5,       
};

// State lưu trữ cục bộ để render UI đồng bộ
let serverUserState = {
    id: 0,
    coins: 0,
    spins: 0,
    dailySpinsCount: 0,
    dailyAdsCount: 0,
    lastSpinTime: 0,
    lastAdsTime: 0,
    username: "Người dùng Telegram"
};

function showToast(message) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    container.textContent = message;
    container.style.opacity = '1';
    container.style.transform = 'translate(-50%, 0)';
    
    setTimeout(() => {
        container.style.opacity = '0';
        container.style.transform = 'translate(-50%, 20px)';
    }, 3000);
}

function triggerHaptic(type) {
    if (tg && tg.HapticFeedback) {
        if (type === 'success') tg.HapticFeedback.notificationOccurred('success');
        else if (type === 'error') tg.HapticFeedback.notificationOccurred('error');
        else if (type === 'light') tg.HapticFeedback.impactOccurred('light');
    }
}

// ==========================================
// 2. KẾT NỐI ĐỒNG BỘ DỮ LIỆU VỚI SERVER
// ==========================================
async function fetchUserStatus() {
    try {
        const userId = tg && tg.initDataUnsafe && tg.initDataUnsafe.user ? tg.initDataUnsafe.user.id : 123456789; 
        const username = tg && tg.initDataUnsafe && tg.initDataUnsafe.user ? tg.initDataUnsafe.user.username : "Ẩn danh";

        const response = await fetch(`${BACKEND_API_URL}/api/user/status?userId=${userId}&username=${encodeURIComponent(username)}`);
        if (response.ok) {
            serverUserState = await response.json();
            renderUI();
        } else {
            showToast("❌ Không thể đồng bộ trạng thái từ RAM Server!");
        }
    } catch (err) {
        console.error("Lỗi đồng bộ dữ liệu đầu:", err);
        showToast("❌ Máy chủ đang bận, vui lòng thử lại sau!");
    }
}

// Gửi yêu cầu cập nhật tài sản lên Server RAM (ĐÃ ĐỒNG NHẤT userId)
async function postAssetUpdate(action, extraData = {}) {
    try {
        // Đồng nhất tham số viết sạch dưới dạng ?userId= giống với link ref và status
        const response = await fetch(`${BACKEND_API_URL}/api/user/update?userId=${serverUserState.id}&action=${action}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(extraData)
        });

        if (response.ok) {
            serverUserState = await response.json();
            renderUI();
            return true;
        } else {
            const errData = await response.json();
            showToast(`⚠️ Từ chối: ${errData.error || 'Thao tác không hợp lệ!'}`);
            return false;
        }
    } catch (err) {
        console.error("Lỗi cập nhật tài sản:", err);
        showToast("❌ Lỗi kết nối mạng Server!");
        return false;
    }
}

// ==========================================
// 3. VẼ VÀ CẬP NHẬT GIAO DIỆN NGƯỜI DÙNG (RENDER)
// ==========================================
function renderUI() {
    document.getElementById('username').textContent = serverUserState.username || "Hội viên";
    document.getElementById('user-points').textContent = serverUserState.coins.toLocaleString();
    document.getElementById('vnd-estimation').textContent = (serverUserState.coins * CONFIG.COIN_TO_VND_RATE).toLocaleString();

    document.getElementById('spin-count-status').textContent = serverUserState.spins;
    document.getElementById('daily-spin-progress').textContent = `${serverUserState.dailySpinsCount}/${CONFIG.MAX_DAILY_SPINS}`;
    document.getElementById('daily-ads-progress').textContent = `${serverUserState.dailyAdsCount}/${CONFIG.MAX_DAILY_ADS}`;

    // Đường dẫn chuẩn hóa đồng nhất tham số
    const refUrlInput = document.getElementById('referral-url');
    if (refUrlInput) {
        refUrlInput.value = `https://t.me/SieuCapCayXu_NDTTrung_Bot?start=${serverUserState.id}`;
    }
}

// ==========================================
// 4. XỬ LÝ SỰ KIỆN CLICK CÁC CHỨC NĂNG CHÍNH
// ==========================================

// --- CHỨC NĂNG VÒNG QUAY MAY MẮN ---
document.getElementById('btn-spin').addEventListener('click', async () => {
    if (serverUserState.spins <= 0) {
        triggerHaptic('error');
        showToast("❌ Bạn đã hết Lượt quay! Vui lòng xem Quảng cáo để nhận thêm.");
        return;
    }
    if (serverUserState.dailySpinsCount >= CONFIG.MAX_DAILY_SPINS) {
        triggerHaptic('error');
        showToast("❌ Bạn đã đạt giới hạn 10 lượt quay tối đa trong hôm nay!");
        return;
    }

    const spinBtn = document.getElementById('btn-spin');
    spinBtn.disabled = true; 

    const ok = await postAssetUpdate('lucky_spin');
    if (ok) {
        triggerHaptic('success');
        showToast("🎡 Vòng quay đang hoạt động... Chúc mừng bạn đã nhận thưởng thành công!");
    }
    
    setTimeout(() => { spinBtn.disabled = false; }, 1000);
});

// --- CHỨC NĂNG XEM VIDEO QUẢNG CÁO (ADSGRAM - BẢO MẬT TUẦN TỰ) ---
document.getElementById('btn-watch-ads').addEventListener('click', async () => {
    if (!window.Adsgram) {
        showToast("❌ Lỗi: Không thể kết nối tới SDK Adsgram. Vui lòng tải lại trang!");
        return;
    }

    if (serverUserState.dailyAdsCount >= CONFIG.MAX_DAILY_ADS) {
        triggerHaptic('error');
        showToast("❌ Bạn đã xem hết 5 video giới hạn của ngày hôm nay!");
        return;
    }

    const watchBtn = document.getElementById('btn-watch-ads');
    watchBtn.disabled = true;
    showToast("🔄 Đang tải luồng dữ liệu video Adsgram...");

    const AdController = window.Adsgram.createAdController('30379'); 

    try {
        // BƯỚC 1: Gọi xem quảng cáo thực tế
        await AdController.show();
        
        // BƯỚC 2: Chỉ khi xem hết thành công mới gọi Server bằng endpoint đồng nhất mới
        showToast("⏳ Đang xác thực phần thưởng lên RAM Server...");
        const ok = await postAssetUpdate('watch_ads_success');
        
        if (ok) {
            triggerHaptic('success'); 
            showToast("🎉 Tuyệt vời! Bạn đã xem hết quảng cáo và nhận +12,000 Xu & +1 Lượt quay!");
        }

    } catch (error) {
        triggerHaptic('error'); 
        if (error && error.done === false) {
            showToast("❌ Bạn đã tắt video quá sớm! Phải xem hết quảng cáo mới được nhận xu.");
        } else {
            showToast("⚠️ Hiện tại không có video quảng cáo khả dụng hoặc hệ thống đang chờ duyệt. Bạn KHÔNG được nhận xu!");
        }
        console.error("Luồng Adsgram bị chặn hoặc lỗi tải:", error);
    } finally {
        watchBtn.disabled = false;
    }
});

// --- CHỨC NĂNG RÚT TIỀN (WITHDRAWAL) ---
document.getElementById('btn-withdraw').addEventListener('click', async () => {
    const method = document.getElementById('withdraw-method').value;
    const address = document.getElementById('withdraw-address').value.trim();
    const amount = parseInt(document.getElementById('withdraw-amount').value, 10);
    const MIN_COINS_REQUIRED = 50000;

    if (!address || isNaN(amount) || amount <= 0) {
        triggerHaptic('error');
        showToast("❌ Vui lòng điền đầy đủ và chính xác thông tin nhận tiền!");
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

    const ok = await postAssetUpdate('withdraw_request', { 
        withdrawMethod: method, 
        withdrawAddress: address, 
        withdrawAmount: amount 
    });
    
    if (ok) {
        document.getElementById('withdraw-address').value = "";
        document.getElementById('withdraw-amount').value = "";
        triggerHaptic('success');
        showToast("🎉 Lệnh rút tiền đã được gửi lên Chat duyệt của Admin!");
    }
});

// --- CHỨC NĂNG SAO CHÉP ĐƯỜNG DẪN GIỚI THIỆU ---
document.getElementById('btn-copy-ref').addEventListener('click', () => {
    const copyText = document.getElementById('referral-url');
    if (!copyText || !copyText.value) return;

    copyText.select();
    copyText.setSelectionRange(0, 99999); 
    
    navigator.clipboard.writeText(copyText.value)
        .then(() => {
            triggerHaptic('light'); 
            showToast("📋 Đã sao chép link mời Bot Telegram thành công!");
        })
        .catch(err => {
            console.error("Lỗi Clipboard API:", err);
            showToast("❌ Trình duyệt chặn tự động sao chép, hãy tự bôi đen văn bản!");
        });
});

window.addEventListener('DOMContentLoaded', fetchUserStatus);

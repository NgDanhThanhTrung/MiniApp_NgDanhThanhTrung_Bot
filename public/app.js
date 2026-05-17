/**
 * SIÊU CẤP KIẾM XU - TMA
 * Frontend Logic API Engine (Chạy Nguyên Khối kết nối Realtime với RAM Server)
 * Năm vận hành: 2026
 * Phiên bản: 2.8.0 (Đồng bộ hóa 100% hạn mức và luồng tính toán Quảng cáo còn lại)
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

// Cấu hình các tham số đồng bộ khớp 100% với Server cấu hình
const CONFIG = {
    COIN_TO_VND_RATE: 1000, 
    SPIN_COOLDOWN: 30,      // Thời gian hồi chiêu vòng quay (giây)
    ADS_COOLDOWN: 60,       // Thời gian hồi chiêu xem ads tiếp theo (giây)
    MAX_DAILY_SPINS: 10,
    MAX_DAILY_ADS: 5,       // Giới hạn 5 quảng cáo 1 ngày
};

// State lưu trữ cục bộ để render UI đồng bộ
let serverUserState = {
    id: 0,
    coins: 0,
    spinsLeft: 0,
    lastSpinTimestamp: 0,
    lastAdsTimestamp: 0,
    dailySpinsCount: 0,
    dailyAdsCount: 0
};

let isWheelSpinning = false;

// Mảng phần thưởng tương ứng 100% với góc quay сегмент và logic server
const REWARDS_MAPPING = [10000, 200, 5000, 1000, 50000, 2000, 20000, 5000];

// ==========================================
// 2. TIẾN TRÌNH GIAO TIẾP BACKEND (FETCH/POST API)
// ==========================================

// Hàm gọi nạp thông tin tài khoản realtime khi vừa mở Mini App
async function fetchUserAccountData() {
    try {
        const initDataRaw = tg ? tg.initData : "";
        
        // Luồng giả lập cho DEV test trên môi trường Localhost Web không có Telegram
        if (!initDataRaw) {
            console.warn("⚠️ Đang chạy ngoài Telegram. Kích hoạt thông số tài khoản thử nghiệm.");
            serverUserState = { id: 99999, first_name: "Dev Local", coins: 75000, spinsLeft: 5, dailySpinsCount: 2, dailyAdsCount: 1 };
            updateUI();
            return;
        }

        const response = await fetch(`${BACKEND_API_URL}/api/user-data`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ initData: initDataRaw })
        });

        if (response.ok) {
            serverUserState = await response.json();
            updateUI();
        } else {
            showToast("❌ Lỗi mạng: Không thể đồng bộ tài khoản từ RAM Server.");
        }
    } catch (err) {
        console.error("Lỗi fetchUserAccountData:", err);
    }
}

// Hàm gửi các lệnh cập nhật tài sản tập trung an toàn lên Server xử lý
async function postAssetUpdate(actionName, extraPayload = {}) {
    try {
        const initDataRaw = tg ? tg.initData : "";
        if (!initDataRaw) {
            // Môi trường Sandbox xử lý cục bộ ngay lập tức cho môi trường DEV
            handleDevSandboxFallback(actionName, extraPayload);
            return true;
        }

        const response = await fetch(`${BACKEND_API_URL}/api/update-assets`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ initData: initDataRaw, action: actionName, ...extraPayload })
        });

        if (response.ok) {
            serverUserState = await response.json();
            updateUI();
            return true;
        } else {
            const errorObj = await response.json().catch(() => ({ error: "Hành động bị từ chối." }));
            showToast(errorObj.error);
            return false;
        }
    } catch (err) {
        showToast("❌ Cổng mạng nghẽn, không thể kết nối tới Server.");
        return false;
    }
}

// Xử lý các lệnh cộng tiền ảo khi chạy off-line chế độ Sandbox Dev
function handleDevSandboxFallback(action, payload) {
    if (action === 'spin_start') {
        serverUserState.spinsLeft -= 1;
        serverUserState.dailySpinsCount += 1;
    } else if (action === 'spin_reward') {
        serverUserState.coins += parseInt(payload.rewardCoins, 10);
    } else if (action === 'watch_ads_success') {
        serverUserState.coins += 12000;
        serverUserState.spinsLeft += 1;
        serverUserState.dailyAdsCount += 1;
    } else if (action === 'withdraw_request') {
        serverUserState.coins -= parseInt(payload.withdrawAmount, 10);
    }
    updateUI();
}

// ==========================================
// 3. ĐỒNG BỘ GIAO DIỆN NGƯỜI DÙNG (RE-RENDER UI)
// ==========================================
function updateUI() {
    document.getElementById('username').innerText = serverUserState.username ? `@${serverUserState.username}` : (serverUserState.first_name || "Hội viên");
    document.getElementById('user-points').innerText = serverUserState.coins.toLocaleString();
    
    // Tính toán ước lượng VNĐ theo đúng tỷ lệ: 1000 xu = 1 VNĐ
    const vndEstimation = Math.floor(serverUserState.coins / CONFIG.COIN_TO_VND_RATE);
    document.getElementById('vnd-estimation').innerText = vndEstimation.toLocaleString();

    document.getElementById('txt-spins-left').innerText = serverUserState.spinsLeft;
    document.getElementById('txt-daily-spins').innerText = `${serverUserState.dailySpinsCount}/${CONFIG.MAX_DAILY_SPINS}`;
    
    // TÍNH TOÁN SỐ LƯỢNG QUẢNG CÁO CÒN LẠI TRONG NGÀY (Khớp tuyệt đối logic file Excel của Server)
    const adsRemaining = Math.max(0, CONFIG.MAX_DAILY_ADS - serverUserState.dailyAdsCount);
    document.getElementById('txt-daily-ads').innerText = `${adsRemaining}/${CONFIG.MAX_DAILY_ADS}`;

    // Tạo link mời bạn bè động chứa đúng ID Telegram của Hội viên
    const shareLink = `https://t.me/miniapp_ngdanhthanhtrung_bot/app?startapp=${serverUserState.id}`;
    document.getElementById('referral-url').value = shareLink;
}

// Hàm phát tín hiệu rung phản hồi xúc giác cho máy di động (Haptic Feedback)
function triggerHaptic(type) {
    if (tg && tg.HapticFeedback) {
        if (type === 'success') tg.HapticFeedback.notificationOccurred('success');
        else if (type === 'error') tg.HapticFeedback.notificationOccurred('error');
        else if (type === 'light') tg.HapticFeedback.impactOccurred('light');
    }
}

function showToast(message) {
    const container = document.getElementById('toast-container');
    container.innerText = message;
    container.style.opacity = '1';
    container.style.transform = 'translate(-50%, 0)';
    setTimeout(() => {
        container.style.opacity = '0';
        container.style.transform = 'translate(-50%, 20px)';
    }, 3000);
}

// ==========================================
// 4. LOGIC VẬN HÀNH VÒNG QUAY MAY MẮN
// ==========================================
document.getElementById('btn-spin').addEventListener('click', async () => {
    if (isWheelSpinning) return;

    // Kiểm tra nhanh Cooldown ở client để tiết kiệm tài nguyên mạng
    const now = Date.now();
    if (serverUserState.lastSpinTimestamp && (now - serverUserState.lastSpinTimestamp < CONFIG.SPIN_COOLDOWN * 1000)) {
        const secWait = Math.ceil((CONFIG.SPIN_COOLDOWN * 1000 - (now - serverUserState.lastSpinTimestamp)) / 1000);
        triggerHaptic('error');
        showToast(`⏳ Vòng quay đang nạp lại năng lượng! Vui lòng chờ ${secWait} giây.`);
        return;
    }

    // Bước 1: Gửi lệnh đóng băng trừ lượt quay trên RAM Server
    const approved = await postAssetUpdate('spin_start');
    if (!approved) return;

    isWheelSpinning = true;
    triggerHaptic('light');

    // Thuật toán chọn ngẫu nhiên 1 trong 8 ô phần thưởng khớp mảng cấu trúc
    const randomIndex = Math.floor(Math.random() * 8);
    const chosenReward = REWARDS_MAPPING[randomIndex];

    // Tính toán góc quay đồ họa (Quay tối thiểu 5 vòng + bù góc tương ứng ô trúng)
    const segmentDegrees = 360 / 8;
    const targetDegrees = (360 * 5) + (randomIndex * segmentDegrees);

    const wheel = document.getElementById('lucky-wheel');
    wheel.style.transition = 'transform 4s cubic-bezier(0.1, 0.8, 0.3, 1)';
    wheel.style.transform = `rotate(${targetDegrees}deg)`;

    // Chờ 4 giây cho tới khi hiệu ứng xoay kết thúc tĩnh
    setTimeout(async () => {
        // Bước 2: Gửi lệnh thực lĩnh phần thưởng lên Server RAM
        const success = await postAssetUpdate('spin_reward', { rewardCoins: chosenReward });
        
        if (success) {
            triggerHaptic('success');
            showToast(`🎉 Chúc mừng! Bạn quay trúng thưởng: +${chosenReward.toLocaleString()} Xu.`);
        }

        // Reset lại góc quay tĩnh chuẩn bị cho lần bấm tiếp theo
        wheel.style.transition = 'none';
        wheel.style.transform = `rotate(${targetDegrees % 360}deg)`;
        isWheelSpinning = false;
    }, 4100);
});

// ==========================================
// 5. TÍCH HỢP ADSGRAM VIDEO LIVE 100% CHUẨN CHỈ
// ==========================================
document.getElementById('btn-watch-ad').addEventListener('click', async () => {
    const now = Date.now();
    
    // Kiểm tra Cooldown Ads ở client tránh spam API
    if (serverUserState.lastAdsTimestamp && (now - serverUserState.lastAdsTimestamp < CONFIG.ADS_COOLDOWN * 1000)) {
        const secWait = Math.ceil((CONFIG.ADS_COOLDOWN * 1000 - (now - serverUserState.lastAdsTimestamp)) / 1000);
        triggerHaptic('error');
        showToast(`⏳ Quảng cáo đang được chuẩn bị! Vui lòng quay lại sau ${secWait} giây.`);
        return;
    }

    if (serverUserState.dailyAdsCount >= CONFIG.MAX_DAILY_ADS) {
        triggerHaptic('error');
        showToast("❌ Bạn đã cày hết sạch giới hạn quảng cáo của ngày hôm nay.");
        return;
    }

    // Kiểm tra xem SDK Adsgram đã tải thành công chưa
    if (window.Adsgram) {
        showToast("🔄 Đang kết nối luồng Adsgram Live...");
        
        // Khởi tạo luồng điều khiển với Block ID thực tế 30379 của bạn
        const AdController = window.Adsgram.createAdController('30379');
        
        AdController.show().then(async () => {
            // Trường hợp 1: Người dùng xem trọn vẹn 15 giây video thành công
            const ok = await postAssetUpdate('watch_ads_success');
            if (ok) {
                triggerHaptic('success');
                showToast("💎 Thành công! Cộng +12,000 Xu & tặng +1 Lượt quay may mắn.");
            }
        }).catch((err) => {
            // Trường hợp 2: Người dùng tắt ngang hoặc hết kho quảng cáo khả dụng
            triggerHaptic('error');
            if (err && err.done === false) {
                showToast("⚠️ Bạn đã tắt quảng cáo quá sớm nên không nhận được thưởng!");
            } else {
                showToast("❌ Kho quảng cáo hiện tại của nhà tài trợ đang tạm hết.");
            }
        });
    } else {
        // Luồng Sandbox dự phòng giả lập khi test off-line ngoài Telegram
        showToast("📡 Chế độ Sandbox: Đang giả lập tải quảng cáo 1.2s...");
        setTimeout(async () => {
            const ok = await postAssetUpdate('watch_ads_success');
            if (ok) {
                triggerHaptic('success');
                showToast("[Dev Sandbox] +12,000 Xu & +1 Lượt quay.");
            }
        }, 1200);
    }
});

// ==========================================
// 6. XỬ LÝ SỰ KIỆN TẠO ĐƠN RÚT TIỀN MẶT
// ==========================================

// Thay đổi Dynamic Label nhãn biểu mẫu tùy theo phương thức thanh toán người dùng lựa chọn
document.getElementById('withdraw-method').addEventListener('change', (e) => {
    const val = e.target.value;
    const lbl = document.getElementById('lbl-address');
    const input = document.getElementById('withdraw-address');

    if (val === 'momo') {
        lbl.innerText = "Số điện thoại Ví MoMo:";
        input.placeholder = "Ví dụ: 0987654321";
    } else if (val === 'bank') {
        lbl.innerText = "Thông tin Ngân hàng (Tên Bank + STK + Tên chủ thẻ):";
        input.placeholder = "Ví dụ: Vietcombank - 1023456789 - NGUYEN VAN A";
    } else if (val === 'ton') {
        lbl.innerText = "Địa chỉ ví TON Network Wallet (Hoặc Memo kèm theo nếu có):";
        input.placeholder = "Ví dụ: UQAA...x9zP";
    }
});

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
        showToast("🎉 Lệnh rút tiền đã được gửi lên Chat duyệt của Admin!");
    }
});

// Sao chép nhanh đường dẫn giới hạn Referral URL vào bộ nhớ đệm
document.getElementById('btn-copy-ref').addEventListener('click', () => {
    const copyText = document.getElementById('referral-url');
    copyText.select();
    copyText.setSelectionRange(0, 99999); 
    navigator.clipboard.writeText(copyText.value);
    
    triggerHaptic('light');
    showToast("📋 Đã sao chép link mời thành công vào bộ nhớ đệm!");
});

// Khởi động tiến trình đồng bộ dữ liệu ngay khi Mini App được tải xong trọn vẹn
window.addEventListener('DOMContentLoaded', fetchUserAccountData);

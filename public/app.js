/**
 * SIÊU CẤP KIẾM XU - TMA
 * Frontend Logic API Engine (Chạy Nguyên Khối kết nối Realtime với RAM Server)
 * Năm vận hành: 2026
 * Phiên bản: 3.4.5 (Khắc phục lỗi nạp chậm Adsgram & Đồng bộ spinsLeft cứng)
 */

const tg = window.Telegram ? window.Telegram.WebApp : null;
const BACKEND_API_URL = window.location.origin; 

if (tg) {
    tg.ready();
    tg.expand(); 
    if (tg.disableVerticalSwipes) tg.disableVerticalSwipes(); 
}

const CONFIG = {
    COIN_TO_VND_RATE: 1000, 
    SPIN_COOLDOWN: 30,      
    ADS_COOLDOWN: 60,       
    MAX_DAILY_SPINS: 10,
    MAX_DAILY_ADS: 5,       
};

// ĐỒNG BỘ 100%: Khởi tạo chính xác trường spinsLeft giống hệt bộ não Server RAM
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
const REWARDS_MAPPING = [10000, 200, 5000, 1000, 50000, 2000, 20000, 500];

async function fetchUserAccountData() {
    try {
        const initDataRaw = tg ? tg.initData : "";
        if (!initDataRaw) {
            console.warn("📡 Môi trường ngoài Telegram. Kích hoạt thông số Sandbox.");
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
            showToast("❌ Lỗi mạng: Không thể kết nối tới RAM Server.");
        }
    } catch (err) {
        console.error(err);
    }
}

async function postAssetUpdate(actionName, extraPayload = {}) {
    try {
        const initDataRaw = tg ? tg.initData : "";
        
        // Đóng gói cẩn thận cờ báo hiệu nếu đang chạy Sandbox test ngoài Telegram
        const requestBody = { 
            initData: initDataRaw, 
            action: actionName, 
            isSandboxDev: !initDataRaw,
            ...extraPayload 
        };

        const response = await fetch(`${BACKEND_API_URL}/api/update-assets`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
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

function updateUI() {
    document.getElementById('username').innerText = serverUserState.username ? `@${serverUserState.username}` : (serverUserState.first_name || "Hội viên");
    document.getElementById('user-points').innerText = serverUserState.coins.toLocaleString();
    
    const vndEstimation = Math.floor(serverUserState.coins / CONFIG.COIN_TO_VND_RATE);
    document.getElementById('vnd-estimation').innerText = vndEstimation.toLocaleString();

    // SỬA LỖI ĐỒNG BỘ: Điền chuẩn xác spinsLeft hiển thị lên thẻ tiến trình game
    document.getElementById('txt-spins-left').innerText = serverUserState.spinsLeft;
    document.getElementById('txt-daily-spins').innerText = `${serverUserState.dailySpinsCount}/${CONFIG.MAX_DAILY_SPINS}`;
    
    const adsRemaining = Math.max(0, CONFIG.MAX_DAILY_ADS - serverUserState.dailyAdsCount);
    document.getElementById('txt-daily-ads').innerText = `${adsRemaining}/${CONFIG.MAX_DAILY_ADS}`;

    document.getElementById('referral-url').value = `https://t.me/SieuCapCayXu_NDTTrung_Bot?start=${serverUserState.id}`;
}

function triggerHaptic(type) {
    if (tg && tg.HapticFeedback) {
        if (type === 'success') tg.HapticFeedback.notificationOccurred('success');
        else if (type === 'error') tg.HapticFeedback.notificationOccurred('error');
        else if (type === 'light') tg.HapticFeedback.impactOccurred('light');
    }
}

function showToast(message) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    container.innerText = message;
    container.style.opacity = '1';
    container.style.transform = 'translate(-50%, 0)';
    setTimeout(() => {
        container.style.opacity = '0';
        container.style.transform = 'translate(-50%, 20px)';
    }, 3000);
}

// CORES LOGIC VÒNG QUAY MAY MẮN
document.getElementById('btn-spin').addEventListener('click', async () => {
    if (isWheelSpinning) return;

    const now = Date.now();
    if (serverUserState.lastSpinTimestamp && (now - serverUserState.lastSpinTimestamp < CONFIG.SPIN_COOLDOWN * 1000)) {
        const secWait = Math.ceil((CONFIG.SPIN_COOLDOWN * 1000 - (now - serverUserState.lastSpinTimestamp)) / 1000);
        triggerHaptic('error');
        showToast(`⏳ Vòng quay đang hồi năng lượng! Vui lòng chờ ${secWait} giây.`);
        return;
    }

    if (serverUserState.spinsLeft <= 0) {
        triggerHaptic('error');
        showToast("❌ Bạn đã hết lượt quay khả dụng! Hãy xem Ads để nạp thêm.");
        return;
    }

    const approved = await postAssetUpdate('spin_start');
    if (!approved) return;

    isWheelSpinning = true;
    triggerHaptic('light');

    const randomIndex = Math.floor(Math.random() * 8);
    const chosenReward = REWARDS_MAPPING[randomIndex];

    const segmentDegrees = 360 / 8;
    const targetDegrees = (360 * 5) + (randomIndex * segmentDegrees);

    const wheel = document.getElementById('lucky-wheel');
    wheel.style.transition = 'transform 4s cubic-bezier(0.1, 0.8, 0.3, 1)';
    wheel.style.transform = `rotate(${targetDegrees}deg)`;

    setTimeout(async () => {
        const success = await postAssetUpdate('spin_reward', { rewardCoins: chosenReward });
        if (success) {
            triggerHaptic('success');
            showToast(`🎉 Chúc mừng! Bạn quay trúng thưởng: +${chosenReward.toLocaleString()} Xu.`);
        }
        wheel.style.transition = 'none';
        wheel.style.transform = `rotate(${targetDegrees % 360}deg)`;
        isWheelSpinning = false;
    }, 4100);
});

// LOGIC XEM QUẢNG CÁO ADSGRAM (ĐÃ FIX KHÓA LUỒNG SĂN LÙNG BIẾN WINDOW CHUẨN 100%)
document.getElementById('btn-watch-ad').addEventListener('click', async () => {
    const now = Date.now();
    if (serverUserState.lastAdsTimestamp && (now - serverUserState.lastAdsTimestamp < CONFIG.ADS_COOLDOWN * 1000)) {
        const secWait = Math.ceil((CONFIG.ADS_COOLDOWN * 1000 - (now - serverUserState.lastAdsTimestamp)) / 1000);
        triggerHaptic('error');
        showToast(`⏳ Vui lòng chờ thời gian chuẩn bị video kế tiếp sau ${secWait} giây.`);
        return;
    }

    if (serverUserState.dailyAdsCount >= CONFIG.MAX_DAILY_ADS) {
        triggerHaptic('error');
        showToast("❌ Bạn đã cày hết sạch giới hạn quảng cáo của ngày hôm nay.");
        return;
    }

    const watchBtn = document.getElementById('btn-watch-ad');
    watchBtn.disabled = true;

    // GIẢI PHÁP THÔNG MINH: Nếu đang chạy trên Telegram thật (có initData), ép luồng đợi SDK nạp trong 1.5 giây nếu cần
    const isTelegramEnvironment = tg && tg.initData !== "";
    if (isTelegramEnvironment && !window.Adsgram) {
        showToast("⏳ Đang tối ưu hóa kết nối SDK Adsgram...");
        await new Promise(resolve => setTimeout(resolve, 1500));
    }

    // LUỒNG CHẠY KIẾM TIỀN THẬT (Khi biến window đã sẵn sàng trên Telegram)
    if (window.Adsgram) {
        showToast("🔄 Đang kết nối luồng quảng cáo Adsgram...");
        const AdController = window.Adsgram.createAdController('30388'); // Khớp mã Active chính chủ

        try {
            await AdController.show();
            showToast("⏳ Đang đồng bộ phần thưởng lên RAM...");
            const ok = await postAssetUpdate('watch_ads_success');
            if (ok) {
                triggerHaptic('success');
                showToast("💎 Thành công! Cộng +12,000 Xu & +1 Lượt quay.");
            }
        } catch (error) {
            triggerHaptic('error');
            if (error && error.done === false) {
                showToast("❌ Bạn đã tắt video quá sớm! Không nhận được thưởng.");
            } else {
                showToast("⚠️ Đối tác Adsgram đang phê duyệt hoặc hết video khả dụng. Bạn không được nhận xu!");
            }
        } finally {
            watchBtn.disabled = false;
        }
    } 
    // LUỒNG GIẢ LẬP AN TOÀN TRÊN TRÌNH DUYỆT NGOÀI CHỐNG SẬP 
    else {
        showToast("📡 Phát hiện chạy ngoài Telegram. Kích hoạt trình giả lập Adsgram 2s...");
        setTimeout(async () => {
            showToast("⏳ Đang giả lập đồng bộ phần thưởng lên RAM...");
            const ok = await postAssetUpdate('watch_ads_success');
            if (ok) {
                triggerHaptic('success');
                showToast("💎 [Chế độ Test Web] Giả lập cộng +12,000 Xu & +1 Lượt quay thành công!");
            }
            watchBtn.disabled = false;
        }, 2000);
    }
});

// RÚT TIỀN THU NHẬP
document.getElementById('withdraw-method').addEventListener('change', (e) => {
    const val = e.target.value;
    const lbl = document.getElementById('lbl-address');
    const input = document.getElementById('withdraw-address');
    if (val === 'momo') { lbl.innerText = "Số điện thoại Ví MoMo:"; input.placeholder = "Ví dụ: 0987654321"; }
    else if (val === 'bank') { lbl.innerText = "Thông tin Ngân hàng (Tên Bank + STK + Tên chủ thẻ):"; input.placeholder = "Ví dụ: VCB - 1023456789 - NGUYEN VAN A"; }
    else if (val === 'ton') { lbl.innerText = "Địa chỉ ví TON Network Wallet:"; input.placeholder = "Ví dụ: UQAA...x9zP"; }
});

document.getElementById('btn-submit-withdraw').addEventListener('click', async () => {
    const method = document.getElementById('withdraw-method').value;
    const address = document.getElementById('withdraw-address').value.trim();
    const amount = parseInt(document.getElementById('withdraw-amount').value, 10);
    const MIN_COINS_REQUIRED = 2000000; 

    if (!address || isNaN(amount) || amount <= 0) {
        triggerHaptic('error'); showToast("❌ Vui lòng nhập đầy đủ thông tin hợp lệ!"); return;
    }
    if ((method === 'momo' || method === 'bank') && amount < MIN_COINS_REQUIRED) {
        triggerHaptic('error'); showToast(`❌ Yêu cầu rút tối thiểu từ ${MIN_COINS_REQUIRED.toLocaleString()} Xu!`); return;
    }
    if (amount > serverUserState.coins) {
        triggerHaptic('error'); showToast("❌ Số dư tài khoản không đủ!"); return;
    }

    const ok = await postAssetUpdate('withdraw_request', { withdrawMethod: method, withdrawAddress: address, withdrawAmount: amount });
    if (ok) {
        document.getElementById('withdraw-address').value = "";
        document.getElementById('withdraw-amount').value = "";
        triggerHaptic('success');
        showToast("🎉 Lệnh rút tiền đã gửi tới Admin phê duyệt!");
    }
});

window.addEventListener('DOMContentLoaded', fetchUserAccountData);

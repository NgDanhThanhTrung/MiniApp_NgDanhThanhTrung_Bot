/**
 * SIÊU CẤP KIẾM XU - TMA
 * Frontend Logic API Engine (Ép mã hóa URL mã hóa sâu chống lỗi nhận diện)
 * Năm vận hành: 2026
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
    MAX_DAILY_SPINS: 10,
    MAX_DAILY_ADS: 5,       
};

let serverUserState = {
    id: 0,
    coins: 0,
    spinsLeft: 0, 
    dailySpinsCount: 0,
    dailyAdsCount: 0,
    referralCount: 0 
};

let isWheelSpinning = false;
const REWARDS_MAPPING = [10000, 200, 5000, 1000, 50000, 2000, 20000, 500];

// [VÁ LỖI NHẬN DIỆN]: Sử dụng encodeURIComponent để tránh lỗi rớt ký tự đặc biệt khi truyền tải lên Render
async function fetchUserAccountData() {
    try {
        const initDataRaw = tg ? tg.initData : "";
        if (!initDataRaw) {
            console.warn("📡 Môi trường Sandbox Local.");
            serverUserState = { id: 99999, first_name: "Dev Local", coins: 75000, spinsLeft: 5, dailySpinsCount: 2, dailyAdsCount: 1, referralCount: 3 };
            updateUI();
            return null;
        }

        const response = await fetch(`${BACKEND_API_URL}/api/user-data`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            // Ép mã hóa ký tự URL an toàn tuyệt đối
            body: JSON.stringify({ initData: encodeURIComponent(initDataRaw) })
        });

        if (response.ok) {
            serverUserState = await response.json();
            updateUI();
            return serverUserState;
        } else {
            console.error("Server từ chối gói tin định danh.");
            showToast("❌ Không thể kết nối đồng bộ danh tính.");
        }
    } catch (err) {
        console.error("Lỗi Fetch:", err);
        showToast("❌ Lỗi đường truyền mạng lên Render.");
    }
    return null;
}

// GỬI CẬP NHẬT TÀI SẢN (Vòng quay & Rút tiền)
async function postAssetUpdate(actionName, extraPayload = {}) {
    try {
        const initDataRaw = tg ? tg.initData : "";
        const queryParams = new URLSearchParams({
            userId: serverUserState.id || 99999,
            action: actionName,
            isSandboxDev: !initDataRaw,
            ...extraPayload
        });

        const response = await fetch(`${BACKEND_API_URL}/api/user/update?${queryParams.toString()}`);

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
        showToast("❌ Mất kết nối tới RAM Server!");
        return false;
    }
}

function updateUI() {
    document.getElementById('username').innerText = serverUserState.username ? `@${serverUserState.username}` : (serverUserState.first_name || "Hội viên");
    document.getElementById('user-points').innerText = serverUserState.coins.toLocaleString();
    
    const vndEstimation = Math.floor(serverUserState.coins / CONFIG.COIN_TO_VND_RATE);
    document.getElementById('vnd-estimation').innerText = vndEstimation.toLocaleString();

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

// BỘ LỌC ĐỒNG BỘ KHÁNG TRỄ (POLLING SYSTEM)
async function pollForAdReward(previousCoins, maxAttempts = 6) {
    let attempts = 0;
    showToast("⏳ Hệ thống đang kiểm tra xác thực phần thưởng Ads...");

    const interval = setInterval(async () => {
        attempts++;
        const updatedData = await fetchUserAccountData();
        
        if (updatedData && updatedData.coins > previousCoins) {
            clearInterval(interval);
            triggerHaptic('success');
            showToast("💎 Thành công! Đã nhận +12,000 Xu & +1 Lượt quay.");
            document.getElementById('btn-watch-ad').disabled = false;
        } 
        else if (attempts >= maxAttempts) {
            clearInterval(interval);
            showToast("⚠️ Mạng Render trễ, số dư của bạn sẽ tự cập nhật sau ít giây nữa.");
            document.getElementById('btn-watch-ad').disabled = false;
        }
    }, 1500); 
}

// LOGIC VÒNG QUAY MAY MẮN
document.getElementById('btn-spin').addEventListener('click', async () => {
    if (isWheelSpinning) return;

    if (serverUserState.spinsLeft <= 0) {
        triggerHaptic('error');
        showToast("❌ Bạn đã hết lượt quay khả dụng! Hãy xem Ads.");
        return;
    }

    if (serverUserState.dailySpinsCount >= CONFIG.MAX_DAILY_SPINS) {
        triggerHaptic('error');
        showToast("❌ Bạn đã đạt giới hạn vòng quay của ngày hôm nay.");
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

// LOGIC XEM QUẢNG CÁO ADSGRAM (ĐỒNG BỘ WEBHOOK WEB)
document.getElementById('btn-watch-ad').addEventListener('click', async () => {
    if (serverUserState.dailyAdsCount >= CONFIG.MAX_DAILY_ADS) {
        triggerHaptic('error');
        showToast("❌ Bạn đã cày hết sạch giới hạn quảng cáo của ngày hôm nay.");
        return;
    }

    const watchBtn = document.getElementById('btn-watch-ad');
    watchBtn.disabled = true;

    if (window.Adsgram) {
        showToast("🔄 Đang tải luồng video Adsgram...");
        const AdController = window.Adsgram.createAdController('30388'); 

        try {
            await AdController.show();
            const currentCoins = serverUserState.coins;
            pollForAdReward(currentCoins);
        } catch (error) {
            triggerHaptic('error');
            if (error && error.done === false) {
                showToast("❌ Bạn đã tắt video quá sớm! Không nhận được thưởng.");
            } else {
                showToast("⚠️ Hiện tại không có quảng cáo khả dụng. Thử lại sau!");
            }
            watchBtn.disabled = false;
        }
    } else {
        triggerHaptic('error');
        showToast("❌ Vui lòng chạy trên ứng dụng Telegram thật để xem Ads kiếm tiền.");
        watchBtn.disabled = false;
    }
});

// QUẢN LÝ FORM RÚT TIỀN 
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

    const ok = await postAssetUpdate('withdraw_request', { 
        withdrawMethod: method, 
        withdrawAddress: address, 
        withdrawAmount: amount 
    });
    
    if (ok) {
        document.getElementById('withdraw-address').value = "";
        document.getElementById('withdraw-amount').value = "";
        triggerHaptic('success');
        showToast("🎉 Lệnh rút tiền đã gửi tới Admin phê duyệt!");
    }
});

// COPY LINK GIỚI THIỆU MỜI BẠN
document.getElementById('btn-copy-ref').addEventListener('click', () => {
    const copyText = document.getElementById('referral-url');
    copyText.removeAttribute('readonly');
    copyText.select();
    try {
        document.execCommand('copy');
        copyText.setAttribute('readonly', 'readonly');
        triggerHaptic('light');
        showToast("📋 Đã sao chép link mời thành công!");
    } catch (err) {
        navigator.clipboard.writeText(copyText.value).then(() => {
            triggerHaptic('light');
            showToast("📋 Đã sao chép link mời thành công!");
        });
    }
});

document.getElementById('btn-share-ref').addEventListener('click', () => {
    const refLink = document.getElementById('referral-url').value;
    const inviteMessage = encodeURIComponent("Vào cày xu với tớ đi! Nhận ngay 50,000 Xu tân thủ cực hot tại đây: ");
    if (tg && tg.initData !== "") {
        triggerHaptic('light');
        tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(refLink)}&text=${inviteMessage}`);
    } else {
        showToast("📡 Vui lòng chạy trên Telegram thật để chia sẻ!");
    }
});

window.addEventListener('DOMContentLoaded', fetchUserAccountData);

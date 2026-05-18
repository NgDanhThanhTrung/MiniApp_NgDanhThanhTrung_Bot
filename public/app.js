/**
 * SIÊU CẤP KIẾM XU - TMA
 * Frontend Logic API Engine (Chạy Nguyên Khối trên Render)
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
    SPIN_COOLDOWN: 30,      
    ADS_COOLDOWN: 60,       
    MAX_DAILY_SPINS: 10,
    MAX_DAILY_ADS: 5,
};

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
let wheelRotation = 0;

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

// [CẬP NHẬT ĐỂ NHẬN DIỆN]: Đóng gói chuỗi an toàn dưới dạng URI Component trước khi POST
async function fetchUserAccountData() {
    if (!tg || !tg.initData) {
        console.warn("Ứng dụng chưa được kích hoạt trong Telegram Webview.");
        return;
    }
    try {
        const response = await fetch(`${BACKEND_API_URL}/api/user-data`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            // Tiến hành mã hóa bảo vệ chuỗi tránh rụng gãy thực thể đặc biệt
            body: JSON.stringify({ initData: encodeURIComponent(tg.initData) })
        });
        if (response.ok) {
            serverUserState = await response.json();
            updateUI();
        } else {
            console.error("Server từ chối nhận diện.");
        }
    } catch (e) { 
        console.error("Lỗi đồng bộ dữ liệu với RAM Server:", e); 
    }
}

async function postAssetUpdate(actionType, extraParams = {}) {
    if (!tg || !tg.initData) return false;
    try {
        const response = await fetch(`${BACKEND_API_URL}/api/update-assets`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({ 
                initData: encodeURIComponent(tg.initData), 
                action: actionType, 
                ...extraParams 
            })
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

function updateUI() {
    let usernameDisplay = "Thượng khách Khai Thác";
    if (tg && tg.initDataUnsafe && tg.initDataUnsafe.user) {
        const u = tg.initDataUnsafe.user;
        usernameDisplay = u.first_name + (u.last_name ? " " + u.last_name : "");
        if (u.id) {
            document.getElementById('share-url-text').value = `https://t.me/SieuCapCayXu_NDTTrung_Bot/app?startapp=ref_${u.id}`;
        }
    }
    document.getElementById('username').innerText = usernameDisplay;

    const coins = serverUserState.coins || 0;
    document.getElementById('user-points').innerText = coins.toLocaleString('en-US');
    
    const vndEstimation = Math.floor(coins / CONFIG.COIN_TO_VND_RATE);
    document.getElementById('vnd-estimation').innerText = vndEstimation.toLocaleString('vi-VN');

    const spins = serverUserState.spinsLeft ?? 0;
    document.getElementById('user-spins').innerText = spins;
    if (document.getElementById('user-spins-badge')) {
        document.getElementById('user-spins-badge').innerText = spins;
    }
}

function runCooldownTimers() {
    setInterval(() => {
        const now = Date.now();

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
                spinTimerEl.classList.remove('hidden');
                spinTimerEl.querySelector('span').innerText = `00:${remains.toString().padStart(2, '0')}`;
            } else {
                btnSpin.innerText = `🎡 QUAY NGAY`;
                btnSpin.disabled = false;
                spinTimerEl.classList.add('hidden');
            }
        }

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
            adsTimerEl.classList.remove('hidden');
            adsTimerEl.querySelector('span').innerText = `00:${remains.toString().padStart(2, '0')}`;
        } else {
            btnAds.innerHTML = `📺 XEM ADS LẤY LƯỢT`;
            btnAds.disabled = false;
            adsTimerEl.classList.add('hidden');
        }
    }, 1000);
}

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

    // Gọi API để Backend thực hiện trừ lượt quay từ xa
    try {
        const response = await fetch(`${BACKEND_API_URL}/api/user/spin`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ telegramId: tg && tg.initDataUnsafe?.user?.id ? tg.initDataUnsafe.user.id : 0 })
        });

        if (!response.ok) {
            const errData = await response.json();
            showToast(errData.error || "Lỗi hệ thống");
            isSpinning = false;
            return;
        }

        const spinResult = await response.json();
        const targetIndex = spinResult.rewardIndex;
        
        const degreesPerSegment = 360 / 8;
        const extraRounds = 5 * 360; 
        
        wheelRotation += extraRounds + (360 - (targetIndex * degreesPerSegment)) - (wheelRotation % 360);
        const wheel = document.getElementById('wheel');
        wheel.style.transform = `rotate(${wheelRotation}deg)`;

        setTimeout(async () => {
            isSpinning = false;
            serverUserState = spinResult.user; // Đồng bộ trực tiếp kết quả tài sản từ xa
            updateUI();

            const prize = WHEEL_REWARDS[targetIndex];
            if (prize.value > 0) {
                triggerHaptic('success');
                showToast(`🎉 Tuyệt vời! Bạn đã quay trúng +${prize.value.toLocaleString()} Xu!`);
            } else {
                triggerHaptic('medium');
                showToast("😢 Ôi trúng ô Mất Lượt rồi, chúc bạn may mắn lần sau!");
            }
        }, 4000);

    } catch (e) {
        showToast("❌ Không thể kết nối cổng quay thưởng.");
        isSpinning = false;
    }
}

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
        const AdController = window.Adsgram.createAdController('30388'); // UnitID thật của bạn
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
                showToast("❌ Lỗi mạng hoặc block quảng cáo không khả dụng.");
            }
        });
    } else {
        showToast("📺 Chế độ Sandbox: Xem Ads thành công! (+1 Lượt)");
        setTimeout(async () => {
            await postAssetUpdate('watch_ads_success');
            triggerHaptic('success');
        }, 1200);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    fetchUserAccountData();
    runCooldownTimers();

    document.getElementById('btn-spin').addEventListener('click', handleLuckyWheel);
    document.getElementById('btn-watch-ads').addEventListener('click', handleWatchAds);

    document.getElementById('btn-invite-friend').addEventListener('click', () => {
        triggerHaptic('light');
        const shareUrl = document.getElementById('share-url-text').value;
        const textInvite = encodeURIComponent("🔥 Vào cày xu đổi tiền mặt và TON với mình cực dễ trên Telegram! Hệ thống rút tiền tự động cực kỳ uy tín 👇");
        const telegramShareLink = `https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${textInvite}`;
        
        if (tg && tg.openTelegramLink) {
            tg.openTelegramLink(telegramShareLink);
        } else {
            window.open(telegramShareLink, '_blank');
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
});

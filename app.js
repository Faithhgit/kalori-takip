import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getFirestore, collection, addDoc, query, where, getDocs, deleteDoc, doc, setDoc, updateDoc, serverTimestamp, orderBy } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';
import { foods } from './data/foods.js';
import { drinks } from './data/drinks.js';

// Constants - Load from localStorage or defaults
const TARGETS_KEY = 'calorieTargets';
let TARGETS = loadTargets();

function loadTargets() {
    try {
        const stored = JSON.parse(localStorage.getItem(TARGETS_KEY));
        return stored || {
            kcal: 2200,
            protein: 150,
            carb: 250,
            fat: 70
        };
    } catch (error) {
        return {
            kcal: 2200,
            protein: 150,
            carb: 250,
            fat: 70
        };
    }
}

function saveTargets(targets) {
    TARGETS = targets;
    localStorage.setItem(TARGETS_KEY, JSON.stringify(targets));
    updateSummary();
    renderChart();
}

// --- Profile & Weight Tracking ---
const PROFILE_KEY = 'userProfile';
const WEIGHT_LOG_KEY = 'weightLog';

function loadProfile() {
    try {
        return JSON.parse(localStorage.getItem(PROFILE_KEY)) || {};
    } catch { return {}; }
}

function saveProfile(profile) {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
}

function loadWeightLog() {
    try {
        const data = JSON.parse(localStorage.getItem(WEIGHT_LOG_KEY));
        return Array.isArray(data) ? data : [];
    } catch { return []; }
}

function saveWeightLog(log) {
    localStorage.setItem(WEIGHT_LOG_KEY, JSON.stringify(log));
}

// Mifflin-St Jeor BMR
function calcBMR(gender, weightKg, heightCm, age) {
    const base = (10 * weightKg) + (6.25 * heightCm) - (5 * age);
    return gender === 'male' ? base + 5 : base - 161;
}

// TDEE hesaplama
function calcTDEE(bmr, activityMultiplier, trainingDays) {
    let tdee = bmr * activityMultiplier;
    // Antrenman günü başına küçük düzeltme (+150 kcal/gün ortalama)
    if (trainingDays && trainingDays > 0) {
        tdee += (trainingDays * 150) / 7;
    }
    return Math.round(tdee);
}

// Hedef moduna göre kalori
function applyGoalMode(tdee, mode) {
    const modifiers = {
        cut_moderate: 0.85,
        cut_aggressive: 0.75,
        maintain: 1.0,
        bulk: 1.10
    };
    return Math.round(tdee * (modifiers[mode] || 1.0));
}

// Protein önerisi (g/kg)
function suggestProtein(weightKg, mode) {
    const ranges = {
        cut_moderate: [1.8, 2.2],
        cut_aggressive: [1.8, 2.2],
        maintain: [1.6, 2.0],
        bulk: [1.6, 2.0]
    };
    const [low, high] = ranges[mode] || [1.6, 2.0];
    const mid = (low + high) / 2;
    return Math.round(weightKg * mid);
}

// Yağ önerisi
function suggestFat(weightKg) {
    return Math.round(weightKg * 0.8); // 0.6 minimum ama 0.8 daha iyi default
}

// Karbonhidrat = kalan kalori
function suggestCarb(targetKcal, proteinG, fatG) {
    const remaining = targetKcal - (proteinG * 4) - (fatG * 9);
    return Math.max(0, Math.round(remaining / 4));
}

// Hesapla ve göster
function calculateAndShowGoals() {
    const gender = document.getElementById('profileGender').value;
    const age = parseInt(document.getElementById('profileAge').value);
    const height = parseFloat(document.getElementById('profileHeight').value);
    const weight = parseFloat(document.getElementById('profileWeight').value);
    const activity = parseFloat(document.getElementById('profileActivity').value);
    const trainingDays = parseInt(document.getElementById('profileTrainingDays').value) || 0;
    const goalMode = document.getElementById('profileGoalMode').value;

    if (!gender || !age || !height || !weight) {
        alert('Lütfen cinsiyet, yaş, boy ve kilo bilgilerini girin.');
        return;
    }

    // Profili kaydet
    const profile = { gender, age, height, weight, activity, trainingDays, goalMode,
        steps: parseInt(document.getElementById('profileSteps').value) || 0 };
    saveProfile(profile);

    const bmr = calcBMR(gender, weight, height, age);
    const tdee = calcTDEE(bmr, activity, trainingDays);
    const targetKcal = applyGoalMode(tdee, goalMode);
    const protein = suggestProtein(weight, goalMode);
    const fat = suggestFat(weight);
    const carb = suggestCarb(targetKcal, protein, fat);

    // Hedef alanlarına doldur
    document.getElementById('targetKcal').value = targetKcal;
    document.getElementById('targetProtein').value = protein;
    document.getElementById('targetFat').value = fat;
    document.getElementById('targetCarb').value = carb;

    // Öneri kutusunu göster
    const modeLabels = {
        cut_moderate: 'Yağ Yakım (Sürdürülebilir)',
        cut_aggressive: 'Yağ Yakım (Agresif)',
        maintain: 'Koruma',
        bulk: 'Kas Artışı'
    };

    const recEl = document.getElementById('goalRecommendation');
    const recContent = document.getElementById('goalRecContent');
    recContent.innerHTML = `
        BMR: <strong>${Math.round(bmr)} kcal</strong> |
        TDEE: <strong>${tdee} kcal</strong><br>
        Mod: <strong>${modeLabels[goalMode]}</strong><br>
        Kalori: <strong>${targetKcal} kcal</strong> ·
        Protein: <strong>${protein}g</strong> ·
        Yağ: <strong>${fat}g</strong> ·
        Karb: <strong>${carb}g</strong>
    `;
    recEl.style.display = 'block';
}

// 7 günlük hareketli ortalama hesapla
function calcMovingAverage(entries, days) {
    if (entries.length < days) return null;
    const recent = entries.slice(-days);
    const sum = recent.reduce((a, e) => a + e.weight, 0);
    return sum / days;
}

// Adaptive TDEE hesaplama
function calcAdaptiveTDEE(weightEntries, calorieLogs) {
    if (weightEntries.length < 10) return null; // Yetersiz veri

    // Son 14 gün (en az 10)
    const sorted = [...weightEntries].sort((a, b) => a.date.localeCompare(b.date));
    const last14 = sorted.slice(-14);
    if (last14.length < 10) return null;

    // 7 günlük ortalamalarla başlangıç-bitiş farkı
    const firstWeek = last14.slice(0, 7);
    const lastWeek = last14.slice(-7);
    const avgFirst = firstWeek.reduce((s, e) => s + e.weight, 0) / firstWeek.length;
    const avgLast = lastWeek.reduce((s, e) => s + e.weight, 0) / lastWeek.length;
    const deltaKg = avgLast - avgFirst;
    const daySpan = last14.length;

    // Haftalık kilo değişimi
    const weeklyChange = (deltaKg / daySpan) * 7;

    // Enerji farkı: 1 kg yağ ~ 7700 kcal
    const weeklyEnergyDiff = weeklyChange * 7700;
    const dailyEnergyDiff = weeklyEnergyDiff / 7;

    // Son 14 gün ortalama kalori alımı
    const dateRange = last14.map(e => e.date);
    const startDate = dateRange[0];
    const endDate = dateRange[dateRange.length - 1];

    let totalIntake = 0;
    let intakeDays = 0;
    // calorieLogs: weekLogs gibi [{date, kcal, ...}] formatında
    const dateSet = new Set(dateRange);
    const dailyIntake = {};
    calorieLogs.forEach(log => {
        if (log.date >= startDate && log.date <= endDate) {
            dailyIntake[log.date] = (dailyIntake[log.date] || 0) + log.kcal;
        }
    });

    for (const d of dateSet) {
        if (dailyIntake[d] !== undefined && dailyIntake[d] > 0) {
            totalIntake += dailyIntake[d];
            intakeDays++;
        }
    }

    if (intakeDays < 7) return null; // Yetersiz kalori verisi

    const avgIntake = totalIntake / intakeDays;
    let adaptiveTDEE = Math.round(avgIntake + dailyEnergyDiff);

    // Güvenlik: BMR altına düşmesin
    const profile = loadProfile();
    if (profile.gender && profile.weight && profile.height && profile.age) {
        const bmr = calcBMR(profile.gender, profile.weight, profile.height, profile.age);
        adaptiveTDEE = Math.max(adaptiveTDEE, Math.round(bmr));
        // Çok uç çıkmasın (BMR * 2.5 üstü olmasın)
        adaptiveTDEE = Math.min(adaptiveTDEE, Math.round(bmr * 2.5));
    }

    return { adaptiveTDEE, weeklyChange, avgIntake: Math.round(avgIntake) };
}

// Kilo takibi UI güncelleme
function renderWeightSection() {
    const entries = loadWeightLog().sort((a, b) => b.date.localeCompare(a.date));
    const listEl = document.getElementById('weightLogList');
    const statsEl = document.getElementById('weightStats');
    const adaptiveBtn = document.getElementById('updateGoalsAdaptive');

    // Son 14 gün listesi
    const recent14 = entries.slice(0, 14);
    if (recent14.length === 0) {
        listEl.innerHTML = '<div class="weight-no-data">Henüz kilo kaydı yok.</div>';
        statsEl.style.display = 'none';
        adaptiveBtn.style.display = 'none';
        return;
    }

    listEl.innerHTML = recent14.map(e => `
        <div class="weight-log-item">
            <span class="weight-log-date">${formatDate(e.date)}</span>
            <span class="weight-log-value">${e.weight} kg</span>
            <button class="weight-log-delete" data-date="${e.date}" title="Sil">✕</button>
        </div>
    `).join('');

    // Silme butonları
    listEl.querySelectorAll('.weight-log-delete').forEach(btn => {
        btn.addEventListener('click', () => {
            const date = btn.dataset.date;
            const log = loadWeightLog().filter(e => e.date !== date);
            saveWeightLog(log);
            renderWeightSection();
        });
    });

    // İstatistikler
    const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));

    // 7 günlük ortalama
    const avg7 = calcMovingAverage(sorted, Math.min(7, sorted.length));
    document.getElementById('weightAvg7').textContent = avg7 ? `${avg7.toFixed(1)} kg` : '-';

    // Haftalık değişim
    if (sorted.length >= 7) {
        const first7 = sorted.slice(0, Math.min(7, Math.floor(sorted.length / 2)));
        const last7 = sorted.slice(-7);
        const avgF = first7.reduce((s, e) => s + e.weight, 0) / first7.length;
        const avgL = last7.reduce((s, e) => s + e.weight, 0) / last7.length;
        const delta = avgL - avgF;
        const daysBetween = sorted.length;
        const weeklyDelta = (delta / daysBetween) * 7;
        const sign = weeklyDelta >= 0 ? '+' : '';
        document.getElementById('weightChange').textContent = `${sign}${weeklyDelta.toFixed(2)} kg/hafta`;
    } else {
        document.getElementById('weightChange').textContent = '-';
    }

    statsEl.style.display = 'grid';

    // Adaptive TDEE
    loadExtendedLogsForAdaptive(sorted);
}

// Genişletilmiş logları yükle (14 gün) ve adaptive TDEE hesapla
async function loadExtendedLogsForAdaptive(weightEntries) {
    const tdeeEl = document.getElementById('adaptiveTdee');
    const adaptiveBtn = document.getElementById('updateGoalsAdaptive');

    if (weightEntries.length < 10) {
        tdeeEl.textContent = 'Yetersiz veri';
        adaptiveBtn.style.display = 'none';
        return;
    }

    try {
        // Son 14 günlük kalori verisi
        const sorted = [...weightEntries].sort((a, b) => a.date.localeCompare(b.date));
        const startDate = sorted[Math.max(0, sorted.length - 14)].date;

        const q = query(
            collection(db, 'daily_logs'),
            where('date', '>=', startDate),
            orderBy('date')
        );
        const snap = await getDocs(q);
        const logs = [];
        snap.forEach(d => logs.push(d.data()));

        const result = calcAdaptiveTDEE(weightEntries, logs);
        if (!result) {
            tdeeEl.textContent = 'Yetersiz veri';
            adaptiveBtn.style.display = 'none';
            return;
        }

        tdeeEl.textContent = `${result.adaptiveTDEE} kcal`;
        adaptiveBtn.style.display = 'block';

        // "Hedefleri Güncelle" butonu
        adaptiveBtn.onclick = () => {
            const profile = loadProfile();
            const mode = profile.goalMode || 'maintain';
            const newKcal = applyGoalMode(result.adaptiveTDEE, mode);
            const protein = suggestProtein(profile.weight || 75, mode);
            const fat = suggestFat(profile.weight || 75);
            const carb = suggestCarb(newKcal, protein, fat);

            saveTargets({ kcal: newKcal, protein, carb, fat });
            document.getElementById('targetKcalDisplay').textContent = newKcal;
            alert(`Hedefler güncellendi! Adaptive TDEE: ${result.adaptiveTDEE} kcal → Hedef: ${newKcal} kcal`);
            renderWeightSection();
        };
    } catch (error) {
        console.warn('Adaptive TDEE hesaplanamadı:', error);
        tdeeEl.textContent = '-';
        adaptiveBtn.style.display = 'none';
    }
}

// Global state
let db;
let selectedItem = null;
let todayLogs = [];
let weekLogs = [];

// Initialize Firebase
try {
    const app = initializeApp(firebaseConfig);
    db = getFirestore(app);
} catch (error) {
    showError('Firebase bağlantısı kurulamadı. Lütfen firebase-config.js dosyasını kontrol edin.');
    console.error('Firebase init error:', error);
}

// Utility Functions
function getToday() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function formatDate(dateStr) {
    const [year, month, day] = dateStr.split('-');
    return `${day}/${month}/${year}`;
}

function getTurkishDayName(dateStr) {
    const date = new Date(dateStr + 'T00:00:00');
    const days = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
    return days[date.getDay()];
}

function getLast7Days() {
    const dates = [];
    for (let i = 6; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        dates.push(`${year}-${month}-${day}`);
    }
    return dates;
}

function showError(message) {
    const errorEl = document.getElementById('errorMessage');
    errorEl.textContent = message;
    errorEl.style.display = 'block';
}

function hideLoading() {
    document.getElementById('loadingOverlay').classList.add('hidden');
}

// Data Functions
async function loadTodayLogs() {
    try {
        const today = getToday();
        const q = query(collection(db, 'daily_logs'), where('date', '==', today));
        const querySnapshot = await getDocs(q);
        
        todayLogs = [];
        querySnapshot.forEach((doc) => {
            todayLogs.push({ id: doc.id, ...doc.data() });
        });
        
        renderLogs();
        updateSummary();
    } catch (error) {
        console.error('Error loading today logs:', error);
        showError('Bugünün kayıtları yüklenirken hata oluştu.');
    }
}

async function loadWeekLogs() {
    try {
        const dates = getLast7Days();
        const startDate = dates[0];
        
        const q = query(
            collection(db, 'daily_logs'),
            where('date', '>=', startDate),
            orderBy('date')
        );
        const querySnapshot = await getDocs(q);
        
        weekLogs = [];
        querySnapshot.forEach((doc) => {
            weekLogs.push(doc.data());
        });
        
        renderChart();
        updateMotivation();
        updateGoalStreak();
    } catch (error) {
        console.error('Error loading week logs:', error);
        // Chart will show empty state
        renderChart();
    }
}

function updateGoalStreak() {
    const dates = getLast7Days().reverse(); // Most recent first
    let streak = 0;

    for (const date of dates) {
        const dayLogs = weekLogs.filter(log => log.date === date);
        const dayTotal = dayLogs.reduce((sum, log) => sum + log.kcal, 0);

        // Check if goal was met (within 90-110% range)
        const goalMet = dayTotal >= TARGETS.kcal * 0.9 && dayTotal <= TARGETS.kcal * 1.1;

        if (goalMet) {
            streak++;
        } else {
            break; // Streak ends
        }
    }

    const goalCountEl = document.getElementById('goalCount');
    if (streak > 0) {
        goalCountEl.textContent = `${streak} gün 🔥`;
        goalCountEl.style.display = 'block';
    } else {
        goalCountEl.style.display = 'none';
    }
}

async function addLog(item, grams) {
    try {
        const today = getToday();
        const multiplier = grams / 100;
        
        const logData = {
            date: today,
            item_id: item.id,
            item_name: item.name,
            grams: grams,
            kcal: Math.round(item.kcal_100 * multiplier),
            protein: Math.round(item.protein_100 * multiplier * 10) / 10,
            carb: Math.round(item.carb_100 * multiplier * 10) / 10,
            fat: Math.round(item.fat_100 * multiplier * 10) / 10,
            created_at: serverTimestamp()
        };
        
        await addDoc(collection(db, 'daily_logs'), logData);
        await loadTodayLogs();
        await loadWeekLogs();
        
        // Reset form
        document.getElementById('searchInput').value = '';
        document.getElementById('gramsInput').value = '';
        document.getElementById('calculationPreview').style.display = 'none';
        selectedItem = null;
        
    } catch (error) {
        console.error('Error adding log:', error);
        showError('Kayıt eklenirken hata oluştu.');
    }
}

async function deleteLog(logId) {
    try {
        await deleteDoc(doc(db, 'daily_logs', logId));
        await loadTodayLogs();
        await loadWeekLogs();
    } catch (error) {
        console.error('Error deleting log:', error);
        showError('Kayıt silinirken hata oluştu.');
    }
}

async function editLog(logId) {
    const log = todayLogs.find(l => l.id === logId);
    if (!log) return;

    const newAmount = prompt(`${log.item_name} için yeni miktar (gram/ml):`, log.grams);
    if (!newAmount || isNaN(newAmount) || newAmount <= 0) return;

    const amount = parseInt(newAmount);
    const ratio = amount / 100;

    try {
        await updateDoc(doc(db, 'daily_logs', logId), {
            grams: amount,
            kcal: Math.round(log.kcal_100 * ratio),
            protein: Math.round(log.protein_100 * ratio),
            carb: Math.round(log.carb_100 * ratio),
            fat: Math.round(log.fat_100 * ratio)
        });
        await loadTodayLogs();
        await loadWeekLogs();
    } catch (error) {
        console.error('Error updating log:', error);
        showError('Kayıt güncellenirken hata oluştu.');
    }
}

async function deleteCustomItem(itemId) {
    try {
        // Delete from Firestore
        await deleteDoc(doc(db, 'custom_items', itemId));

        // Remove from local arrays
        const foodIndex = foods.findIndex(f => f.id === itemId);
        if (foodIndex !== -1) {
            foods.splice(foodIndex, 1);
        }

        const drinkIndex = drinks.findIndex(d => d.id === itemId);
        if (drinkIndex !== -1) {
            drinks.splice(drinkIndex, 1);
        }

        // Update dropdown with current search term
        const searchInput = document.getElementById('searchInput');
        const currentSearch = searchInput.value.trim();
        const itemType = document.querySelector('input[name="itemType"]:checked').value;

        if (currentSearch) {
            // Re-render dropdown with current search
            const filtered = filterItems(currentSearch, itemType);
            renderDropdown(filtered, { searchTerm: currentSearch });
        } else {
            // Show recent items
            const recentItems = getRecentItemsByType(itemType);
            renderDropdown(recentItems, { showHeader: true });
        }

        // Clear selection
        selectedItem = null;
        document.getElementById('calculationPreview').style.display = 'none';

        showError('Ürün başarıyla silindi.', 'success');
    } catch (error) {
        console.error('Error deleting custom item:', error);
        showError('Ürün silinirken hata oluştu.');
    }
}

// Render Functions
function renderLogs() {
    const container = document.getElementById('logsContainer');

    if (todayLogs.length === 0) {
        container.innerHTML = '<div class="no-logs">Henüz kayıt yok. Yeni kayıt ekleyerek başlayın!</div>';
        return;
    }

    container.innerHTML = todayLogs.map(log => `
        <div class="log-item" data-id="${log.id}">
            <div class="log-info">
                <div class="log-name">${log.item_name}</div>
                <div class="log-details">
                    ${log.grams}g ·
                    <span class="badge-kcal">${log.kcal} kcal</span> ·
                    <span class="badge-protein">Protein ${log.protein}g</span>
                    <span class="badge-carb">Karb ${log.carb}g</span>
                    <span class="badge-fat">Yağ ${log.fat}g</span>
                </div>
            </div>
            <div class="log-actions">
                <button class="log-edit" data-id="${log.id}" title="Düzenle">✏️</button>
                <button class="log-delete" data-id="${log.id}" title="Sil">🗑️</button>
            </div>
        </div>
    `).join('');

    // Add edit event listeners
    container.querySelectorAll('.log-edit').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            editLog(btn.dataset.id);
        });
    });

    // Add delete event listeners
    container.querySelectorAll('.log-delete').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (confirm('Bu kaydı silmek istediğinize emin misiniz?')) {
                deleteLog(btn.dataset.id);
            }
        });
    });
}

function updateSummary() {
    const totals = todayLogs.reduce((acc, log) => {
        acc.kcal += log.kcal;
        acc.protein += log.protein;
        acc.carb += log.carb;
        acc.fat += log.fat;
        return acc;
    }, { kcal: 0, protein: 0, carb: 0, fat: 0 });

    // Update calorie display
    document.getElementById('currentKcal').textContent = totals.kcal;
    const percentage = Math.min((totals.kcal / TARGETS.kcal) * 100, 100);

    // Update simple progress bar
    const calorieBar = document.getElementById('calorieBar');
    calorieBar.style.width = `${percentage}%`;

    const remaining = TARGETS.kcal - totals.kcal;
    document.getElementById('remainingKcal').textContent =
        remaining > 0 ? `Kalan: ${remaining} kcal` : `Hedef aşıldı: +${Math.abs(remaining)} kcal`;

    // Update macro bars
    updateMacroBar('protein', totals.protein, TARGETS.protein);
    updateMacroBar('carb', totals.carb, TARGETS.carb);
    updateMacroBar('fat', totals.fat, TARGETS.fat);
}

function updateMacroBar(type, current, target) {
    const percentage = Math.min((current / target) * 100, 100);
    document.getElementById(`${type}Bar`).style.width = `${percentage}%`;
    document.getElementById(`${type}Value`).textContent = `${Math.round(current)} / ${target}g`;
}

function renderChart() {
    const container = document.getElementById('chartContainer');
    const dates = getLast7Days();
    
    // Group logs by date
    const dailyTotals = {};
    dates.forEach(date => {
        dailyTotals[date] = 0;
    });
    
    weekLogs.forEach(log => {
        if (dailyTotals.hasOwnProperty(log.date)) {
            dailyTotals[log.date] += log.kcal;
        }
    });
    
    const maxKcal = Math.max(...Object.values(dailyTotals), TARGETS.kcal);
    
    container.innerHTML = dates.map(date => {
        const kcal = dailyTotals[date];
        const height = maxKcal > 0 ? (kcal / maxKcal) * 100 : 0;
        const dayName = getTurkishDayName(date);
        const isToday = date === getToday();
        
        return `
            <div class="chart-bar" style="height: ${height}%;" title="${kcal} kcal">
                ${kcal > 0 ? `<div class="chart-bar-value">${kcal}</div>` : ''}
                <div class="chart-bar-label">${isToday ? '<b>' + dayName + '</b>' : dayName}</div>
            </div>
        `;
    }).join('');
}

function updateMotivation() {
    const totals = todayLogs.reduce((acc, log) => {
        acc.kcal += log.kcal;
        return acc;
    }, { kcal: 0 });
    
    const remaining = TARGETS.kcal - totals.kcal;
    
    // Calculate 7-day average
    const dates = getLast7Days();
    const dailyTotals = {};
    dates.forEach(date => dailyTotals[date] = 0);
    weekLogs.forEach(log => {
        if (dailyTotals.hasOwnProperty(log.date)) {
            dailyTotals[log.date] += log.kcal;
        }
    });
    const weekAvg = Math.round(Object.values(dailyTotals).reduce((a, b) => a + b, 0) / 7);
    
    let message = '';
    
    if (totals.kcal === 0) {
        message = '🌟 Güne başlamak için harika bir zaman! İlk kaydını ekle.';
    } else if (remaining > 500) {
        message = `💪 Bugün için ${remaining} kcal daha alabilirsin. Devam et!`;
    } else if (remaining > 0) {
        message = `🎯 Hedefe çok yakınsın! Sadece ${remaining} kcal kaldı.`;
    } else if (remaining === 0) {
        message = '🎉 Mükemmel! Hedefine tam olarak ulaştın!';
    } else {
        message = `⚠️ Hedefi ${Math.abs(remaining)} kcal aştın. Yarın daha dikkatli olabilirsin.`;
    }
    
    message += ` Son 7 günlük ortalamanız: ${weekAvg} kcal.`;
    
    document.getElementById('motivationText').textContent = message;
}

// Search and Add Functions
const RECENT_ITEMS_KEY = 'recentItems';
const MAX_RESULTS = 30;
const MAX_RECENTS = 5;
let currentDropdownItems = [];
let currentDropdownIndex = -1;

function getItemsByType(itemType) {
    return itemType === 'food' ? foods : drinks;
}

function filterItems(searchTerm, itemType) {
    const items = getItemsByType(itemType);
    if (!searchTerm) return items;

    const term = searchTerm.toLowerCase();
    return items
        .filter(item => item.name.toLowerCase().includes(term))
        .slice(0, MAX_RESULTS);
}

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[char]));
}

function highlightMatch(text, term) {
    if (!term) return escapeHtml(text);

    const lowerText = text.toLowerCase();
    const lowerTerm = term.toLowerCase();
    let result = '';
    let index = 0;

    while (true) {
        const matchIndex = lowerText.indexOf(lowerTerm, index);
        if (matchIndex === -1) {
            result += escapeHtml(text.slice(index));
            break;
        }

        result += escapeHtml(text.slice(index, matchIndex));
        result += `<span class="match">${escapeHtml(text.slice(matchIndex, matchIndex + term.length))}</span>`;
        index = matchIndex + term.length;
    }

    return result;
}

function loadRecentItems() {
    try {
        const stored = JSON.parse(localStorage.getItem(RECENT_ITEMS_KEY));
        return Array.isArray(stored) ? stored : [];
    } catch (error) {
        return [];
    }
}

function saveRecentItems(items) {
    localStorage.setItem(RECENT_ITEMS_KEY, JSON.stringify(items));
}

function addRecentItem(item, itemType) {
    const existing = loadRecentItems().filter(entry => entry.id !== item.id || entry.type !== itemType);
    const nextItems = [{ id: item.id, type: itemType }, ...existing].slice(0, MAX_RECENTS);
    saveRecentItems(nextItems);
}

function getRecentItemsByType(itemType) {
    const stored = loadRecentItems().filter(entry => entry.type === itemType).slice(0, MAX_RECENTS);
    const items = getItemsByType(itemType);

    return stored
        .map(entry => items.find(item => item.id === entry.id))
        .filter(Boolean);
}

function closeDropdown() {
    const dropdown = document.getElementById('dropdown');
    dropdown.classList.remove('active');
    currentDropdownItems = [];
    currentDropdownIndex = -1;
}

function setActiveIndex(nextIndex) {
    if (currentDropdownItems.length === 0) {
        currentDropdownIndex = -1;
        return;
    }

    const dropdown = document.getElementById('dropdown');
    const itemEls = dropdown.querySelectorAll('.dropdown-item[data-index]');
    if (itemEls.length === 0) return;

    if (nextIndex < 0) {
        nextIndex = currentDropdownItems.length - 1;
    } else if (nextIndex >= currentDropdownItems.length) {
        nextIndex = 0;
    }

    currentDropdownIndex = nextIndex;
    itemEls.forEach(el => el.classList.remove('active'));
    const activeEl = itemEls[currentDropdownIndex];
    if (activeEl) {
        activeEl.classList.add('active');
        activeEl.scrollIntoView({ block: 'nearest' });
    }
}

function selectItem(item, itemType) {
    const searchInput = document.getElementById('searchInput');
    const gramsInput = document.getElementById('gramsInput');
    const dropdown = document.getElementById('dropdown');

    selectedItem = item;
    searchInput.value = item.name;
    dropdown.classList.remove('active');
    addRecentItem(item, itemType);
    updatePreview();
    gramsInput.focus();
    gramsInput.select();
}

function renderDropdown(items, options = {}) {
    const dropdown = document.getElementById('dropdown');
    const { searchTerm = '', showHeader = false } = options;

    currentDropdownItems = items;
    currentDropdownIndex = items.length > 0 ? 0 : -1;

    if (items.length === 0) {
        const emptyText = showHeader ? 'Son kullanılan ürün yok.' : 'Sonuç bulunamadı';
        dropdown.innerHTML = showHeader
            ? `<div class="dropdown-header">Son kullanılanlar</div><div class="dropdown-item">${emptyText}</div>`
            : `<div class="dropdown-item">${emptyText}</div>`;
        dropdown.classList.add('active');
        return;
    }

    const header = showHeader ? '<div class="dropdown-header">Son kullanılanlar</div>' : '';
    dropdown.innerHTML = header + items.map((item, index) => `
        <div class="dropdown-item${index === currentDropdownIndex ? ' active' : ''}" data-index="${index}">
            <div class="dropdown-item-content">
                <div>
                    <div class="dropdown-item-name">${highlightMatch(item.name, searchTerm)}</div>
                    <div class="dropdown-item-info">
                        <span class="macro-badge badge-kcal">🔥 ${item.kcal_100} kcal</span>
                        <span class="macro-badge badge-protein">Protein ${item.protein_100}g</span>
                        <span class="macro-badge badge-carb">Karb ${item.carb_100}g</span>
                        <span class="macro-badge badge-fat">Yağ ${item.fat_100}g</span>
                    </div>
                </div>
                ${item.id.startsWith('custom_') ? `<button class="dropdown-delete" data-item-id="${item.id}" title="Sil">🗑️</button>` : ''}
            </div>
        </div>
    `).join('');

    dropdown.classList.add('active');

    // Add click event listeners
    dropdown.querySelectorAll('.dropdown-item[data-index]').forEach(item => {
        item.addEventListener('click', (e) => {
            // Don't select if clicking delete button
            if (e.target.classList.contains('dropdown-delete')) return;

            const index = parseInt(item.dataset.index, 10);
            const selected = Number.isNaN(index) ? null : currentDropdownItems[index];
            const itemType = document.querySelector('input[name="itemType"]:checked').value;

            if (selected) {
                selectItem(selected, itemType);
            }
        });
    });

    // Add delete event listeners for custom items
    dropdown.querySelectorAll('.dropdown-delete').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const itemId = btn.dataset.itemId;
            const item = currentDropdownItems.find(i => i.id === itemId);

            if (!item) return;

            if (confirm(`"${item.name}" ürününü silmek istediğinize emin misiniz? Bu ürün kalıcı olarak silinecektir.`)) {
                await deleteCustomItem(itemId);
            }
        });
    });
}

function updatePreview() {
    const grams = parseInt(document.getElementById('gramsInput').value) || 0;
    const preview = document.getElementById('calculationPreview');

    if (!selectedItem || grams === 0) {
        preview.style.display = 'none';
        return;
    }

    const multiplier = grams / 100;
    const kcal = Math.round(selectedItem.kcal_100 * multiplier);
    const protein = Math.round(selectedItem.protein_100 * multiplier * 10) / 10;
    const carb = Math.round(selectedItem.carb_100 * multiplier * 10) / 10;
    const fat = Math.round(selectedItem.fat_100 * multiplier * 10) / 10;

    document.getElementById('previewKcal').textContent = `${kcal} kcal`;
    document.getElementById('previewProtein').textContent = `${protein}g`;
    document.getElementById('previewCarb').textContent = `${carb}g`;
    document.getElementById('previewFat').textContent = `${fat}g`;

    preview.style.display = 'block';
}

function openDropdownForInput(searchTerm, itemType) {
    if (!searchTerm) {
        const recentItems = getRecentItemsByType(itemType);
        renderDropdown(recentItems, { showHeader: true });
        return;
    }

    const filtered = filterItems(searchTerm, itemType);
    renderDropdown(filtered, { searchTerm });
}
// Load custom items from Firestore
async function loadCustomItems() {
    try {
        const querySnapshot = await getDocs(collection(db, 'custom_items'));
        querySnapshot.forEach((docSnap) => {
            const item = docSnap.data();
            if (item.type === 'food') {
                foods.push({ ...item, id: docSnap.id });
            } else {
                drinks.push({ ...item, id: docSnap.id });
            }
        });
    } catch (error) {
        console.warn('Could not load custom items:', error);
    }
}

// Event Listeners
document.addEventListener('DOMContentLoaded', async () => {
    // Set date display
    const today = getToday();
    document.getElementById('dateDisplay').textContent = formatDate(today);

    // Load data
    await loadCustomItems();
    await loadTodayLogs();
    await loadWeekLogs();
    hideLoading();
    
    // Item type change
    document.querySelectorAll('input[name="itemType"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            selectedItem = null;
            document.getElementById('searchInput').value = '';
            document.getElementById('calculationPreview').style.display = 'none';
            closeDropdown();

            const itemType = e.target.value;
            const presetSection = document.getElementById('preset-section');
            const customSection = document.getElementById('custom-section');
            const amountLabel = document.getElementById('amountLabel');
            const gramsInput = document.getElementById('gramsInput');

            // Show/hide sections based on type
            if (itemType === 'custom') {
                presetSection.style.display = 'none';
                customSection.style.display = 'block';
                amountLabel.textContent = 'Miktar (gram)';
                gramsInput.placeholder = '1';
            } else {
                presetSection.style.display = 'block';
                customSection.style.display = 'none';

                // Update label and placeholder based on type
                if (itemType === 'drink') {
                    amountLabel.textContent = 'Miktar (ml)';
                    gramsInput.placeholder = '250';
                } else {
                    amountLabel.textContent = 'Miktar (gram)';
                    gramsInput.placeholder = '100';
                }
            }

            // Clear custom inputs
            document.getElementById('customName').value = '';
            document.getElementById('customKcal').value = '';
            document.getElementById('customProtein').value = '';
            document.getElementById('customCarb').value = '';
            document.getElementById('customFat').value = '';
        });
    });

    // Custom type change - update amount label
    document.getElementById('customType').addEventListener('change', (e) => {
        const amountLabel = document.getElementById('amountLabel');
        const gramsInput = document.getElementById('gramsInput');

        if (e.target.value === 'drink') {
            amountLabel.textContent = 'Miktar (ml)';
            gramsInput.placeholder = '250';
        } else {
            amountLabel.textContent = 'Miktar (gram)';
            gramsInput.placeholder = '100';
        }
    });

    // Search input
    const searchInput = document.getElementById('searchInput');
    searchInput.addEventListener('input', (e) => {
        const itemType = document.querySelector('input[name="itemType"]:checked').value;
        const term = e.target.value.trim();
        selectedItem = null;
        document.getElementById('calculationPreview').style.display = 'none';
        openDropdownForInput(term, itemType);
    });

    // Removed focus event - dropdown only opens when user types

    searchInput.addEventListener('keydown', (e) => {
        const dropdown = document.getElementById('dropdown');
        const itemType = document.querySelector('input[name="itemType"]:checked').value;
        const term = e.target.value.trim();
        const isOpen = dropdown.classList.contains('active');

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (!isOpen) {
                openDropdownForInput(term, itemType);
                setActiveIndex(0);
                return;
            }
            setActiveIndex(currentDropdownIndex + 1);
        }

        if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (!isOpen) {
                openDropdownForInput(term, itemType);
            }
            setActiveIndex(currentDropdownIndex - 1);
        }

        if (e.key === 'Enter' && isOpen) {
            e.preventDefault();
            if (currentDropdownItems[currentDropdownIndex]) {
                selectItem(currentDropdownItems[currentDropdownIndex], itemType);
            }
        }

        if (e.key === 'Escape' && isOpen) {
            e.preventDefault();
            closeDropdown();
        }
    });

    // Grams input
    const gramsInput = document.getElementById('gramsInput');
    gramsInput.addEventListener('input', updatePreview);
    gramsInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            document.getElementById('addButton').click();
        }
    });
    
    // Add button
    document.getElementById('addButton').addEventListener('click', async () => {
        const itemType = document.querySelector('input[name="itemType"]:checked').value;
        const grams = parseInt(document.getElementById('gramsInput').value);

        if (itemType === 'custom') {
            // Handle custom item
            const customName = document.getElementById('customName').value.trim();
            const customType = document.getElementById('customType').value;
            const customKcal = parseFloat(document.getElementById('customKcal').value) || 0;
            const customProtein = parseFloat(document.getElementById('customProtein').value) || 0;
            const customCarb = parseFloat(document.getElementById('customCarb').value) || 0;
            const customFat = parseFloat(document.getElementById('customFat').value) || 0;

            if (!customName) {
                alert('Lütfen ürün adı girin.');
                return;
            }

            if (!grams || grams <= 0) {
                alert('Lütfen geçerli bir miktar girin.');
                return;
            }

            // Create custom item object
            const customItem = {
                id: 'custom_' + Date.now(),
                name: customName,
                kcal_100: customKcal,
                protein_100: customProtein,
                carb_100: customCarb,
                fat_100: customFat
            };

            // Add to local data arrays
            if (customType === 'food') {
                foods.push(customItem);
            } else {
                drinks.push(customItem);
            }

            // Save to Firestore for persistence
            try {
                await setDoc(doc(db, 'custom_items', customItem.id), {
                    ...customItem,
                    type: customType,
                    created_at: serverTimestamp()
                });
            } catch (error) {
                console.warn('Custom item not saved to Firestore:', error);
            }

            addLog(customItem, grams);

            // Clear custom form
            document.getElementById('customName').value = '';
            document.getElementById('customKcal').value = '';
            document.getElementById('customProtein').value = '';
            document.getElementById('customCarb').value = '';
            document.getElementById('customFat').value = '';
        } else {
            // Handle preset item
            if (!selectedItem) {
                alert('Lütfen bir ürün seçin.');
                return;
            }

            if (!grams || grams <= 0) {
                alert('Lütfen geçerli bir miktar girin.');
                return;
            }

            addLog(selectedItem, grams);
        }
    });
    
    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.form-group')) {
            closeDropdown();
        }
    });

    // Settings Modal
    const settingsModal = document.getElementById('settingsModal');
    const settingsBtn = document.getElementById('settingsBtn');
    const closeSettings = document.getElementById('closeSettings');
    const cancelSettings = document.getElementById('cancelSettings');
    const saveSettingsBtn = document.getElementById('saveSettings');

    settingsBtn.addEventListener('click', () => {
        // Load current targets
        document.getElementById('targetKcal').value = TARGETS.kcal;
        document.getElementById('targetProtein').value = TARGETS.protein;
        document.getElementById('targetCarb').value = TARGETS.carb;
        document.getElementById('targetFat').value = TARGETS.fat;

        // Load profile values
        const prof = loadProfile();
        if (prof.gender) document.getElementById('profileGender').value = prof.gender;
        if (prof.age) document.getElementById('profileAge').value = prof.age;
        if (prof.height) document.getElementById('profileHeight').value = prof.height;
        if (prof.weight) document.getElementById('profileWeight').value = prof.weight;
        if (prof.activity) document.getElementById('profileActivity').value = prof.activity;
        if (prof.trainingDays) document.getElementById('profileTrainingDays').value = prof.trainingDays;
        if (prof.steps) document.getElementById('profileSteps').value = prof.steps;
        if (prof.goalMode) document.getElementById('profileGoalMode').value = prof.goalMode;

        // Öneri kutusunu gizle (yeniden hesaplanması gerekir)
        document.getElementById('goalRecommendation').style.display = 'none';

        settingsModal.classList.add('active');
    });

    closeSettings.addEventListener('click', () => {
        settingsModal.classList.remove('active');
    });

    cancelSettings.addEventListener('click', () => {
        settingsModal.classList.remove('active');
    });

    saveSettingsBtn.addEventListener('click', () => {
        const newTargets = {
            kcal: parseInt(document.getElementById('targetKcal').value),
            protein: parseInt(document.getElementById('targetProtein').value),
            carb: parseInt(document.getElementById('targetCarb').value),
            fat: parseInt(document.getElementById('targetFat').value)
        };

        saveTargets(newTargets);

        // Profil bilgilerini de kaydet
        const gender = document.getElementById('profileGender').value;
        if (gender) {
            const prof = {
                gender,
                age: parseInt(document.getElementById('profileAge').value) || 0,
                height: parseFloat(document.getElementById('profileHeight').value) || 0,
                weight: parseFloat(document.getElementById('profileWeight').value) || 0,
                activity: parseFloat(document.getElementById('profileActivity').value) || 1.2,
                trainingDays: parseInt(document.getElementById('profileTrainingDays').value) || 0,
                steps: parseInt(document.getElementById('profileSteps').value) || 0,
                goalMode: document.getElementById('profileGoalMode').value
            };
            saveProfile(prof);
        }

        // Update UI
        document.getElementById('targetKcalDisplay').textContent = newTargets.kcal;

        settingsModal.classList.remove('active');
    });

    // Close modal when clicking outside
    settingsModal.addEventListener('click', (e) => {
        if (e.target === settingsModal) {
            settingsModal.classList.remove('active');
        }
    });

    // Light/Dark Mode - App is Dark by default
    const darkModeBtn = document.getElementById('darkModeBtn');
    const LIGHT_MODE_KEY = 'lightMode';

    // Load light mode preference (dark is default)
    const isLightMode = localStorage.getItem(LIGHT_MODE_KEY) === 'true';
    if (isLightMode) {
        document.body.classList.add('light-mode');
        darkModeBtn.textContent = '🌙';
    }

    darkModeBtn.addEventListener('click', () => {
        document.body.classList.toggle('light-mode');
        const isNowLight = document.body.classList.contains('light-mode');

        darkModeBtn.textContent = isNowLight ? '🌙' : '☀️';
        localStorage.setItem(LIGHT_MODE_KEY, isNowLight);
    });

    // Update calorie target display on load
    document.getElementById('targetKcalDisplay').textContent = TARGETS.kcal;

    // --- Profil: Ayarlar modal'ına yükle ---
    const profile = loadProfile();
    if (profile.gender) document.getElementById('profileGender').value = profile.gender;
    if (profile.age) document.getElementById('profileAge').value = profile.age;
    if (profile.height) document.getElementById('profileHeight').value = profile.height;
    if (profile.weight) document.getElementById('profileWeight').value = profile.weight;
    if (profile.activity) document.getElementById('profileActivity').value = profile.activity;
    if (profile.trainingDays) document.getElementById('profileTrainingDays').value = profile.trainingDays;
    if (profile.steps) document.getElementById('profileSteps').value = profile.steps;
    if (profile.goalMode) document.getElementById('profileGoalMode').value = profile.goalMode;

    // Hedefleri Hesapla butonu
    document.getElementById('calculateGoals').addEventListener('click', calculateAndShowGoals);

    // --- Kilo Takibi ---
    const weightDateInput = document.getElementById('weightDate');
    weightDateInput.value = getToday();

    document.getElementById('saveWeight').addEventListener('click', () => {
        const weight = parseFloat(document.getElementById('weightInput').value);
        const date = document.getElementById('weightDate').value;
        if (!weight || weight < 30 || weight > 250) {
            alert('Geçerli bir kilo girin (30-250 kg).');
            return;
        }
        if (!date) {
            alert('Tarih seçin.');
            return;
        }
        const log = loadWeightLog();
        // Aynı tarih varsa güncelle
        const idx = log.findIndex(e => e.date === date);
        if (idx >= 0) {
            log[idx].weight = weight;
        } else {
            log.push({ date, weight });
        }
        saveWeightLog(log);
        document.getElementById('weightInput').value = '';
        renderWeightSection();
    });

    renderWeightSection();
});

﻿import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
    addDoc,
    collection,
    deleteDoc,
    doc,
    getDoc,
    getDocs,
    getFirestore,
    initializeFirestore,
    orderBy,
    persistentLocalCache,
    persistentMultipleTabManager,
    query,
    serverTimestamp,
    setDoc,
    updateDoc,
    where,
    writeBatch
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';
import { foods } from './data/foods.js';
import { drinks } from './data/drinks.js';
import {
    applyGoalMode,
    calcAdaptiveTDEE,
    calcBMR,
    calcTDEE,
    calculateNutrition,
    sumLogs
} from './lib/nutrition.js';
import {
    PORTION_MEMORY_KEY,
    convertToBaseAmount,
    getFrequentItemKeys,
    getRememberedPortion,
    getUnitOptions,
    normalizePortionMemory,
    recordPortionUsage
} from './lib/portion.js';
import {
    DEFAULT_MACRO_PREFERENCES,
    MACRO_PRESETS,
    calculateDayTypeEnergyTargets,
    calculateGoalTarget,
    calculateMacroTargets,
    calculateRecipeNutrition,
    getMacroGuidance,
    getNutritionConfidenceLabel,
    inferNutritionConfidence,
    normalizeMacroPreferences,
    resolveDayEnergyTarget,
    sumNutrition
} from './lib/planning.js';
import {
    calculateMacroAdherence,
    calculateWeeklyBudget,
    estimateGoalDate,
    getCalorieGuidance,
    getCalorieStatus,
    getMealTotals,
    getWeightAverages,
    getWeightDataRequirement
} from './lib/insights.js';
import { APP_SCHEMA_VERSION, SCHEMA_VERSION_KEY, runLocalMigrations } from './lib/schema.js';
import { createFirestoreStore } from './lib/firestore-store.js';
import { normalizeProfile, validateCompleteProfile } from './lib/profile.js';
import { renderSelectOptions, setModalOpen } from './lib/ui-components.js';

runLocalMigrations(localStorage);

// Constants - Load from localStorage or defaults
const TARGETS_KEY = 'calorieTargets';
const MACRO_PREFERENCES_KEY = 'macroPreferences';
const SETTINGS_COLLECTION = 'app_settings';
const SETTINGS_DOC_ID = 'default_settings';
const TEMPLATES_SETTINGS_DOC_ID = 'meal_templates';
const LOG_NUTRITION_REPAIR_KEY = 'logNutritionRepairV3';
const LOCK_TARGETS_TO_FIXED_PLAN = false;
const DEFAULT_TARGETS = Object.freeze({
    kcal: 2320,
    protein: 203,
    carb: 203,
    fat: 77
});
const TARGET_RANGES = Object.freeze({
    kcal: [1000, 5000],
    protein: [50, 500],
    carb: [50, 750],
    fat: [20, 300]
});
let MACRO_PREFERENCES = loadMacroPreferences();
let TARGETS = loadTargets();

function getDefaultTargets() {
    return { ...DEFAULT_TARGETS };
}

function loadMacroPreferences() {
    try {
        return normalizeMacroPreferences(JSON.parse(localStorage.getItem(MACRO_PREFERENCES_KEY)));
    } catch {
        return { ...DEFAULT_MACRO_PREFERENCES };
    }
}

function saveMacroPreferences(preferences) {
    MACRO_PREFERENCES = normalizeMacroPreferences(preferences);
    localStorage.setItem(MACRO_PREFERENCES_KEY, JSON.stringify(MACRO_PREFERENCES));
    return MACRO_PREFERENCES;
}

function targetsFromEnergy(kcal, preferences = MACRO_PREFERENCES) {
    const safeKcal = Math.min(
        TARGET_RANGES.kcal[1],
        Math.max(TARGET_RANGES.kcal[0], Math.round(Number(kcal) || DEFAULT_TARGETS.kcal))
    );
    return {
        kcal: safeKcal,
        ...calculateMacroTargets(safeKcal, preferences)
    };
}

function normalizeTargets(targets) {
    if (LOCK_TARGETS_TO_FIXED_PLAN) return getDefaultTargets();

    return Object.fromEntries(Object.entries(DEFAULT_TARGETS).map(([key, fallback]) => {
        const value = Number(targets?.[key]);
        const [min, max] = TARGET_RANGES[key];
        return [key, Number.isFinite(value) && value >= min && value <= max ? value : fallback];
    }));
}

function areTargetsValid(targets) {
    return Object.entries(TARGET_RANGES).every(([key, [min, max]]) => {
        const value = Number(targets?.[key]);
        return Number.isFinite(value) && value >= min && value <= max;
    });
}

function loadTargets() {
    if (LOCK_TARGETS_TO_FIXED_PLAN) return getDefaultTargets();

    try {
        const stored = JSON.parse(localStorage.getItem(TARGETS_KEY));
        const normalized = normalizeTargets(stored);
        return targetsFromEnergy(normalized.kcal);
    } catch (error) {
        return targetsFromEnergy(DEFAULT_TARGETS.kcal);
    }
}

function saveTargets(targets) {
    const normalized = normalizeTargets(targets);
    TARGETS = targetsFromEnergy(normalized.kcal);
    localStorage.setItem(TARGETS_KEY, JSON.stringify(TARGETS));
    updateSummary();
    renderChart();
    renderProgressInsights();
}

// --- Profile & Weight Tracking ---
const PROFILE_KEY = 'userProfile';
const WEIGHT_LOG_KEY = 'weightLog';
const WEIGHT_LOG_COLLECTION = 'weight_logs';
let weightLogCache = [];

function loadProfile() {
    try {
        return normalizeProfile(JSON.parse(localStorage.getItem(PROFILE_KEY)));
    } catch { return {}; }
}

function saveProfile(profile) {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(normalizeProfile(profile)));
}

async function loadSettingsFromCloud() {
    if (!db) return;

    try {
        const settingsRef = doc(db, SETTINGS_COLLECTION, SETTINGS_DOC_ID);
        const snap = await getDoc(settingsRef);
        if (!snap.exists()) return;

        const data = snap.data() || {};

        if (data.macro_preferences && typeof data.macro_preferences === 'object') {
            saveMacroPreferences(data.macro_preferences);
        }

        if (!LOCK_TARGETS_TO_FIXED_PLAN && data.targets && typeof data.targets === 'object') {
            const nextTargets = targetsFromEnergy(Number(data.targets.kcal) || TARGETS.kcal);
            saveTargets(nextTargets);
            document.getElementById('targetKcalDisplay').textContent = TARGETS.kcal;
        }

        if (data.profile && typeof data.profile === 'object') {
            saveProfile(data.profile);
        }

        if (data.daily_meta && typeof data.daily_meta === 'object') {
            Object.entries(data.daily_meta).forEach(([date, meta]) => {
                dailyMetaCache.set(date, meta && typeof meta === 'object' ? meta : {});
            });
            renderTodayTrainingToggle();
        }

        updateSummary();
        renderChart();
        renderProgressInsights();
    } catch (error) {
        console.warn('Cloud settings could not be loaded:', error);
    }
}

async function saveSettingsToCloud(targets, profile, macroPreferences = MACRO_PREFERENCES) {
    if (!db) return false;

    try {
        const settingsRef = doc(db, SETTINGS_COLLECTION, SETTINGS_DOC_ID);
        await setDoc(settingsRef, {
            targets: targetsFromEnergy(normalizeTargets(targets).kcal, macroPreferences),
            macro_preferences: normalizeMacroPreferences(macroPreferences),
            profile,
            updated_at: serverTimestamp()
        }, { merge: true });
        return true;
    } catch (error) {
        console.warn('Cloud settings could not be saved:', error);
        return false;
    }
}

async function readSharedSettingsData() {
    if (!db) return {};
    const snapshot = await getDoc(doc(db, SETTINGS_COLLECTION, SETTINGS_DOC_ID));
    return snapshot.exists() ? (snapshot.data() || {}) : {};
}

async function writeSharedSettingsField(field, value) {
    if (!db) throw new Error('Firebase bağlantısı kurulamadı.');
    await setDoc(doc(db, SETTINGS_COLLECTION, SETTINGS_DOC_ID), {
        [field]: value,
        schema_version: APP_SCHEMA_VERSION,
        updated_at: serverTimestamp()
    }, { merge: true });
}

function normalizeWeightLog(entries) {
    if (!Array.isArray(entries)) return [];

    const entriesByDate = new Map();
    entries
        .filter(e => e && typeof e.date === 'string')
        .map(e => ({
            date: e.date,
            weight: Number(e.weight)
        }))
        .filter(e => /^\d{4}-\d{2}-\d{2}$/.test(e.date))
        .filter(e => Number.isFinite(e.weight) && e.weight >= 30 && e.weight <= 250)
        .forEach(entry => entriesByDate.set(entry.date, entry));

    return [...entriesByDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function loadWeightLogFromLocal() {
    try {
        const data = JSON.parse(localStorage.getItem(WEIGHT_LOG_KEY));
        return normalizeWeightLog(data);
    } catch {
        return [];
    }
}

function saveWeightLogToLocal(log) {
    localStorage.setItem(WEIGHT_LOG_KEY, JSON.stringify(log));
}

function loadWeightLog() {
    if (weightLogCache.length === 0) {
        weightLogCache = loadWeightLogFromLocal();
    }
    return [...weightLogCache];
}

function saveWeightLog(log) {
    weightLogCache = normalizeWeightLog(log);
    saveWeightLogToLocal(weightLogCache);
}

async function fetchWeightLogFromCloud() {
    if (!db) return [];

    try {
        const q = query(collection(db, WEIGHT_LOG_COLLECTION), orderBy('date'));
        const snap = await getDocs(q);
        const cloudLog = [];
        snap.forEach((d) => {
            const item = d.data();
            cloudLog.push({
                date: item.date || d.id,
                weight: Number(item.weight)
            });
        });
        return normalizeWeightLog(cloudLog);
    } catch (error) {
        console.warn('Cloud weight log could not be loaded:', error);
        return [];
    }
}

async function upsertWeightEntryToCloud(entry) {
    if (!db) return false;

    try {
        await setDoc(doc(db, WEIGHT_LOG_COLLECTION, entry.date), {
            date: entry.date,
            weight: entry.weight,
            updated_at: serverTimestamp()
        }, { merge: true });
        return true;
    } catch (error) {
        console.warn('Cloud weight log could not be saved:', error);
        return false;
    }
}

async function deleteWeightEntryFromCloud(date) {
    if (!db) return false;

    try {
        await deleteDoc(doc(db, WEIGHT_LOG_COLLECTION, date));
        return true;
    } catch (error) {
        console.warn('Cloud weight log could not be deleted:', error);
        return false;
    }
}

async function initializeWeightLog() {
    const localLog = loadWeightLogFromLocal();
    weightLogCache = localLog;

    if (!db) return;

    const cloudLog = await fetchWeightLogFromCloud();

    if (cloudLog.length === 0 && localLog.length > 0) {
        for (const entry of localLog) {
            await upsertWeightEntryToCloud(entry);
        }
        return;
    }

    if (cloudLog.length > 0) {
        const mergedByDate = new Map();
        cloudLog.forEach(entry => mergedByDate.set(entry.date, entry));
        localLog.forEach(entry => {
            if (!mergedByDate.has(entry.date)) {
                mergedByDate.set(entry.date, entry);
            }
        });

        const merged = [...mergedByDate.values()].sort((a, b) => a.date.localeCompare(b.date));
        weightLogCache = merged;
        saveWeightLogToLocal(merged);

        for (const entry of localLog) {
            if (!cloudLog.some(c => c.date === entry.date)) {
                await upsertWeightEntryToCloud(entry);
            }
        }
    }
}

function getMacroPreferencesFormState() {
    return {
        strategy: document.getElementById('macroStrategy')?.value || MACRO_PREFERENCES.strategy,
        proteinPct: Number(document.getElementById('macroProteinPct')?.value),
        carbPct: Number(document.getElementById('macroCarbPct')?.value),
        fatPct: Number(document.getElementById('macroFatPct')?.value)
    };
}

function areMacroPreferencesValid(preferences) {
    if (preferences.strategy !== 'manual') return Boolean(MACRO_PRESETS[preferences.strategy]);
    const values = [preferences.proteinPct, preferences.carbPct, preferences.fatPct];
    return values.every(value => Number.isFinite(value) && value >= 10 && value <= 60)
        && Math.round(values.reduce((sum, value) => sum + value, 0)) === 100;
}

function renderMacroPreferencesForm(preferences = MACRO_PREFERENCES) {
    const normalized = normalizeMacroPreferences(preferences);
    const strategyInput = document.getElementById('macroStrategy');
    if (!strategyInput) return;

    strategyInput.value = normalized.strategy;
    document.getElementById('macroProteinPct').value = normalized.proteinPct;
    document.getElementById('macroCarbPct').value = normalized.carbPct;
    document.getElementById('macroFatPct').value = normalized.fatPct;
    updateMacroTargetFields();
}

function updateMacroTargetFields({ applyPreset = false } = {}) {
    const strategy = document.getElementById('macroStrategy')?.value || 'protein_focused';
    const ratioInputs = [
        document.getElementById('macroProteinPct'),
        document.getElementById('macroCarbPct'),
        document.getElementById('macroFatPct')
    ];

    if (applyPreset && MACRO_PRESETS[strategy]) {
        const preset = MACRO_PRESETS[strategy];
        ratioInputs[0].value = preset.proteinPct;
        ratioInputs[1].value = preset.carbPct;
        ratioInputs[2].value = preset.fatPct;
    }

    const isManual = strategy === 'manual';
    ratioInputs.forEach(input => {
        input.readOnly = !isManual;
        input.classList.toggle('is-readonly', !isManual);
    });

    const rawPreferences = getMacroPreferencesFormState();
    const total = [rawPreferences.proteinPct, rawPreferences.carbPct, rawPreferences.fatPct]
        .reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0);
    const status = document.getElementById('macroRatioStatus');
    const isValid = areMacroPreferencesValid(rawPreferences);
    if (status) {
        status.textContent = `Toplam %${Math.round(total)}`;
        status.classList.toggle('is-invalid', !isValid);
    }

    if (!isValid) return false;
    const kcal = Number(document.getElementById('targetKcal')?.value) || TARGETS.kcal;
    const macroTargets = calculateMacroTargets(kcal, rawPreferences);
    document.getElementById('targetProtein').value = macroTargets.protein;
    document.getElementById('targetCarb').value = macroTargets.carb;
    document.getElementById('targetFat').value = macroTargets.fat;
    return true;
}

function updateDayTypeTargetFields() {
    const energy = Number(document.getElementById('targetKcal')?.value) || TARGETS.kcal;
    const trainingDays = Number(document.getElementById('profileTrainingDays')?.value) || 0;
    const dayTargets = calculateDayTypeEnergyTargets(energy, trainingDays);
    const trainingInput = document.getElementById('trainingDayKcal');
    const restInput = document.getElementById('restDayKcal');
    if (trainingInput) trainingInput.value = dayTargets.trainingDayKcal;
    if (restInput) restInput.value = dayTargets.restDayKcal;
    return dayTargets;
}

// Hesapla ve göster
function calculateAndShowGoals() {
    const profileInput = {
        gender: document.getElementById('profileGender').value,
        age: document.getElementById('profileAge').value,
        height: document.getElementById('profileHeight').value,
        weight: document.getElementById('profileWeight').value,
        activity: document.getElementById('profileActivity').value,
        trainingDays: document.getElementById('profileTrainingDays').value,
        steps: document.getElementById('profileSteps').value,
        goalMode: document.getElementById('profileGoalMode').value,
        targetWeight: document.getElementById('profileTargetWeight').value
    };
    const profileError = validateCompleteProfile(profileInput);
    if (profileError) {
        showError(profileError);
        return;
    }
    const macroPreferencesInput = getMacroPreferencesFormState();
    if (!areMacroPreferencesValid(macroPreferencesInput)) {
        showError('Protein, karbonhidrat ve yağ oranlarının toplamı %100 olmalı.');
        return;
    }
    const profile = normalizeProfile(profileInput);

    saveProfile(profile);
    const macroPreferences = saveMacroPreferences(macroPreferencesInput);

    const bmr = calcBMR(profile.gender, profile.weight, profile.height, profile.age);
    const tdee = calcTDEE(bmr, profile.activity, profile.trainingDays, profile.steps);
    const calculatedTarget = applyGoalMode(tdee, profile.goalMode);
    const targetKcal = calculateGoalTarget(calculatedTarget, profile.goalMode);
    const { protein, carb, fat } = calculateMacroTargets(targetKcal, macroPreferences);

    // Hedef alanlarına doldur
    document.getElementById('targetKcal').value = targetKcal;
    document.getElementById('targetProtein').value = protein;
    document.getElementById('targetFat').value = fat;
    document.getElementById('targetCarb').value = carb;
    updateDayTypeTargetFields();

    // Öneri kutusunu göster
    const modeLabels = {
        cut_moderate: 'Dengeli yağ kaybı',
        cut_aggressive: 'Hızlı yağ kaybı',
        maintain: 'Kiloyu koruma',
        bulk: 'Kas kazanımı'
    };

    const recEl = document.getElementById('goalRecommendation');
    const recContent = document.getElementById('goalRecContent');
    recContent.innerHTML = `
        BMR: <strong>${Math.round(bmr)} kcal</strong> |
        TDEE: <strong>${tdee} kcal</strong><br>
        Mod: <strong>${modeLabels[profile.goalMode]}</strong><br>
        Kalori: <strong>${targetKcal} kcal</strong> ·
        Protein: <strong>${protein}g</strong> ·
        Yağ: <strong>${fat}g</strong> ·
        Karbonhidrat: <strong>${carb}g</strong>
    `;
    recEl.style.display = 'block';
}

function getItemByIdOrName(itemId, itemName) {
    const normalizedName = String(itemName || '').trim().toLocaleLowerCase('tr-TR');
    return [...foods, ...drinks].find((item) =>
        item.id === itemId ||
        String(item.name || '').trim().toLocaleLowerCase('tr-TR') === normalizedName
    ) || null;
}

function calculateLogNutrition(item, amount) {
    const core = calculateNutrition(item, amount);
    const referenceAmount = Number(item?.ref_amount) > 0 ? Number(item.ref_amount) : 100;
    const multiplier = Number(amount) > 0 ? Number(amount) / referenceAmount : 0;
    const optionalNutrient = (field) => {
        const value = Number(item?.[field]);
        return Math.round((Number.isFinite(value) && value > 0 ? value : 0) * multiplier * 10) / 10;
    };
    return {
        ...core,
        fiber: optionalNutrient('fiber_100'),
        sugar: optionalNutrient('sugar_100'),
        sodium: optionalNutrient('sodium_100')
    };
}

async function syncExistingLogsToCurrentData() {
    if (!db || localStorage.getItem(LOG_NUTRITION_REPAIR_KEY) === 'done') return;

    try {
        const snap = await getDocs(collection(db, 'daily_logs'));
        if (snap.empty) {
            localStorage.setItem(LOG_NUTRITION_REPAIR_KEY, 'done');
            return;
        }

        const repairs = [];

        snap.forEach((docSnap) => {
            const data = docSnap.data();
            const sourceItem = getItemByIdOrName(data.item_id, data.item_name);
            if (!sourceItem) return;

            const amount = Number(data.grams) || Number(sourceItem.ref_amount) || 100;
            const next = calculateLogNutrition(sourceItem, amount);

            // Geçmiş kayıtlar birer anlık görüntüdür. Katalog daha sonra
            // değişse bile eski değerleri yeniden yazma; yalnızca eksik alanları onar.
            const missingNutrition = ['kcal', 'protein', 'carb', 'fat']
                .some(field => !Number.isFinite(Number(data[field])));
            const missingAdvanced = ['fiber', 'sugar', 'sodium']
                .some(field => !Number.isFinite(Number(data[field])));

            if (missingNutrition || missingAdvanced || Number(data.schema_version) < APP_SCHEMA_VERSION) {
                repairs.push({
                    ref: doc(db, 'daily_logs', docSnap.id),
                    data: {
                        ...(missingNutrition ? {
                            kcal: next.kcal,
                            protein: next.protein,
                            carb: next.carb,
                            fat: next.fat
                        } : {}),
                        ...(missingAdvanced ? {
                            fiber: next.fiber,
                            sugar: next.sugar,
                            sodium: next.sodium
                        } : {}),
                        schema_version: APP_SCHEMA_VERSION
                    }
                });
            }
        });

        for (let index = 0; index < repairs.length; index += 400) {
            const batch = writeBatch(db);
            repairs.slice(index, index + 400).forEach(repair => {
                batch.update(repair.ref, repair.data);
            });
            await batch.commit();
        }
        localStorage.setItem(LOG_NUTRITION_REPAIR_KEY, 'done');
    } catch (error) {
        console.warn('Existing logs sync failed:', error);
    }
}

// Kilo takibi UI güncelleme
function renderWeightSection() {
    const entries = loadWeightLog().sort((a, b) => b.date.localeCompare(a.date));
    const listEl = document.getElementById('weightLogList');
    const statsEl = document.getElementById('weightStats');
    const adaptiveBtn = document.getElementById('updateGoalsAdaptive');
    if (LOCK_TARGETS_TO_FIXED_PLAN) {
        adaptiveBtn.style.display = 'none';
    }

    // Son 14 gün listesi
    const recent14 = entries.slice(0, 14);
    if (recent14.length === 0) {
        listEl.innerHTML = '<div class="weight-no-data">Trendini görmek için ilk kilo kaydını ekle.</div>';
        statsEl.style.display = 'none';
        adaptiveBtn.style.display = 'none';
        renderWeightTrend([]);
        document.getElementById('weightExplanation').textContent = 'Trend için 7 kilo kaydı gerekiyor; 7 kayıt kaldı.';
        document.getElementById('goalArrival').textContent = 'Hedef varış tahmini için profilindeki hedef kiloyu ekle.';
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
        btn.addEventListener('click', async () => {
            const date = btn.dataset.date;
            const log = loadWeightLog().filter(e => e.date !== date);
            saveWeightLog(log);
            renderWeightSection();

            const cloudDeleted = await deleteWeightEntryFromCloud(date);
            if (!cloudDeleted && db) {
                showError('Kilo kaydı buluttan silinemedi. Bağlantını kontrol edip yeniden dene.');
            }
        });
    });

    // İstatistikler
    const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
    renderWeightTrend(sorted.slice(-14));

    const averages = getWeightAverages(sorted);
    document.getElementById('weightAvg7').textContent = averages[7] !== null ? `${averages[7].toFixed(1)} kg` : '-';
    document.getElementById('weightAvg14').textContent = averages[14] !== null ? `${averages[14].toFixed(1)} kg` : '-';
    document.getElementById('weightAvg30').textContent = averages[30] !== null ? `${averages[30].toFixed(1)} kg` : '-';

    // Genel değişim
    if (sorted.length >= 2) {
        const delta = sorted[sorted.length - 1].weight - sorted[0].weight;
        const sign = delta >= 0 ? '+' : '';
        document.getElementById('weightChange').textContent = `${sign}${delta.toFixed(1)} kg`;
    } else {
        document.getElementById('weightChange').textContent = '-';
    }

    statsEl.style.display = 'grid';

    const requirement = getWeightDataRequirement(sorted);
    const explanation = document.getElementById('weightExplanation');
    if (!requirement.ready) {
        explanation.textContent = `Güvenilir eğilim için ${requirement.minimum} kayıt gerekiyor; ${requirement.remaining} kayıt kaldı.`;
    } else {
        const recentWindow = sorted.slice(-Math.min(14, sorted.length));
        const firstAvg = recentWindow.slice(0, Math.ceil(recentWindow.length / 2))
            .reduce((sum, entry) => sum + entry.weight, 0) / Math.ceil(recentWindow.length / 2);
        const secondChunk = recentWindow.slice(Math.floor(recentWindow.length / 2));
        const lastAvg = secondChunk.reduce((sum, entry) => sum + entry.weight, 0) / secondChunk.length;
        const trendDelta = lastAvg - firstAvg;
        const direction = Math.abs(trendDelta) < 0.2
            ? 'dengeye yakın'
            : trendDelta < 0 ? 'aşağı yönlü' : 'yukarı yönlü';
        explanation.textContent =
            `Ortalama eğilim ${direction}. Günlük sıçramalar su, tuz, karbonhidrat ve ölçüm saatinden etkilenebilir.`;
    }

    const profile = loadProfile();
    const eta = estimateGoalDate(sorted, profile.targetWeight);
    const arrivalEl = document.getElementById('goalArrival');
    if (!profile.targetWeight) {
        arrivalEl.textContent = 'Hedef varış tahmini için profilindeki hedef kiloyu ekle.';
    } else if (!requirement.ready) {
        arrivalEl.textContent = `Tahmin için ${requirement.remaining} kilo kaydı daha gerekiyor.`;
    } else if (!eta) {
        arrivalEl.textContent = 'Mevcut eğilim hedef yönünde yeterince belirgin değil; birkaç yeni kayıtla tekrar hesaplanacak.';
    } else {
        const lowerDays = Math.max(1, Math.round(eta.days * 0.8));
        const upperDays = Math.round(eta.days * 1.2);
        arrivalEl.textContent = `Hedef kiloya tahmini varış: ${lowerDays}–${upperDays} gün (${formatDate(eta.date)} civarı).`;
    }

    // Adaptive TDEE
    loadExtendedLogsForAdaptive(sorted);
}

function renderWeightTrend(entries) {
    const container = document.getElementById('weightTrendChart');
    if (!container) return;
    if (!Array.isArray(entries) || entries.length < 2) {
        container.innerHTML = '<div class="weight-no-data">Kilo trendi iki kayıttan sonra görünür.</div>';
        return;
    }

    const width = 340;
    const height = 128;
    const left = 34;
    const right = 10;
    const top = 14;
    const bottom = 24;
    const weights = entries.map(entry => Number(entry.weight));
    const rawMin = Math.min(...weights);
    const rawMax = Math.max(...weights);
    const padding = Math.max(0.5, (rawMax - rawMin) * 0.15);
    const min = rawMin - padding;
    const max = rawMax + padding;
    const plotWidth = width - left - right;
    const plotHeight = height - top - bottom;
    const x = index => left + (index / (entries.length - 1)) * plotWidth;
    const y = weight => top + ((max - weight) / (max - min || 1)) * plotHeight;
    const points = entries.map((entry, index) => `${x(index).toFixed(1)},${y(entry.weight).toFixed(1)}`);
    const first = entries[0];
    const last = entries[entries.length - 1];
    const delta = last.weight - first.weight;
    const deltaText = `${delta >= 0 ? '+' : ''}${delta.toFixed(1)} kg`;

    container.innerHTML = `
        <svg viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="weightTrendTitle weightTrendDesc">
            <title id="weightTrendTitle">Son ${entries.length} kilo kaydının trendi</title>
            <desc id="weightTrendDesc">${formatDate(first.date)} ile ${formatDate(last.date)} arasında değişim ${deltaText}.</desc>
            <line class="weight-trend-grid" x1="${left}" y1="${top}" x2="${left}" y2="${height - bottom}"></line>
            <line class="weight-trend-grid" x1="${left}" y1="${height - bottom}" x2="${width - right}" y2="${height - bottom}"></line>
            <text class="weight-trend-label" x="0" y="${top + 4}">${rawMax.toFixed(1)}</text>
            <text class="weight-trend-label" x="0" y="${height - bottom + 4}">${rawMin.toFixed(1)}</text>
            <polygon class="weight-trend-area" points="${left},${height - bottom} ${points.join(' ')} ${width - right},${height - bottom}"></polygon>
            <polyline class="weight-trend-line" points="${points.join(' ')}"></polyline>
            ${entries.map((entry, index) => `
                <circle class="weight-trend-point" cx="${x(index).toFixed(1)}" cy="${y(entry.weight).toFixed(1)}" r="3">
                    <title>${formatDate(entry.date)}: ${entry.weight} kg</title>
                </circle>
            `).join('')}
            <text class="weight-trend-label" x="${left}" y="${height - 5}">${formatDate(first.date).slice(0, 5)}</text>
            <text class="weight-trend-label" text-anchor="end" x="${width - right}" y="${height - 5}">${formatDate(last.date).slice(0, 5)}</text>
            <text class="weight-trend-delta" text-anchor="end" x="${width - right}" y="${top + 4}">${deltaText}</text>
        </svg>
    `;
}

// Genişletilmiş logları yükle (14 gün) ve adaptive TDEE hesapla
async function loadExtendedLogsForAdaptive(weightEntries) {
    const tdeeEl = document.getElementById('adaptiveTdee');
    const adaptiveBtn = document.getElementById('updateGoalsAdaptive');

    if (LOCK_TARGETS_TO_FIXED_PLAN) {
        adaptiveBtn.style.display = 'none';
    }

    if (weightEntries.length < 7) {
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

        const result = calcAdaptiveTDEE(weightEntries, logs, loadProfile());
        if (!result) {
            tdeeEl.textContent = 'Yetersiz veri';
            adaptiveBtn.style.display = 'none';
            return;
        }

        tdeeEl.textContent = `${result.adaptiveTDEE} kcal`;
        adaptiveBtn.style.display = 'block';

        // "Hedefleri Güncelle" butonu
        adaptiveBtn.onclick = async () => {
            const profile = loadProfile();
            const mode = profile.goalMode || 'maintain';
            const calculatedTarget = applyGoalMode(result.adaptiveTDEE, mode);
            const newKcal = calculateGoalTarget(calculatedTarget, mode);
            const { protein, carb, fat } = calculateMacroTargets(newKcal, MACRO_PREFERENCES);

            saveTargets({ kcal: newKcal, protein, carb, fat });
            document.getElementById('targetKcalDisplay').textContent = newKcal;
            await saveSettingsToCloud({ kcal: newKcal, protein, carb, fat }, profile, MACRO_PREFERENCES);
            showError(`Hedef güncellendi: tahmini harcama ${result.adaptiveTDEE} kcal, yeni hedef ${newKcal} kcal.`, 'success');
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
let dataStore;
let selectedItem = null;
let todayLogs = [];
let recentLogs = [];
let weekLogs = [];
let dateFilteredLogs = [];
let editingLogId = null;
let lastEditLogTrigger = null;
let lastSettingsTrigger = null;
const LOG_HISTORY_DAYS = 30;
const LOGS_PAGE_SIZE = 50;
let logsDateFilter = '';
let logsDateToFilter = '';
let logsVisibleCount = LOGS_PAGE_SIZE;
let pendingUiMessage = null;
let toastTimer = null;
let toastSequence = 0;
let confirmResolver = null;
let movingMealContext = null;
const dailyMetaCache = new Map();
let measurementCache = [];
let progressPhotoCache = [];

// Initialize Firebase
try {
    const app = initializeApp(firebaseConfig);
    try {
        db = initializeFirestore(app, {
            localCache: persistentLocalCache({
                tabManager: persistentMultipleTabManager()
            })
        });
    } catch (cacheError) {
        console.warn('Persistent Firestore cache could not be enabled:', cacheError);
        db = getFirestore(app);
    }
    dataStore = createFirestoreStore(db);
} catch (error) {
    showError('Veri bağlantısı kurulamadı. Lütfen bağlantını kontrol edip yeniden dene.');
    console.error('Firebase init error:', error);
}

// Utility Functions
const PREVIEW_QUERY_KEY = 'preview';

function getToday() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function getSelectedLogDate() {
    const logDateInput = document.getElementById('logDate');
    return logDateInput?.value || getToday();
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

function getDateDaysAgo(daysAgo) {
    const date = new Date();
    date.setDate(date.getDate() - daysAgo);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

async function copyDayLogs(sourceDate, targetDate = getToday()) {
    if (!sourceDate || sourceDate === targetDate) {
        showError('Kopyalanacak gün ile hedef gün aynı olamaz.');
        return false;
    }

    try {
        const q = query(collection(db, 'daily_logs'), where('date', '==', sourceDate));
        const snap = await getDocs(q);
        if (snap.empty) {
        showError(`${formatDate(sourceDate)} tarihinde kopyalanabilecek bir öğün bulunamadı.`);
            return false;
        }
        if (snap.size > 400) {
        showError('Bu gün çok fazla kayıt içerdiği için tek seferde kopyalanamadı.');
            return false;
        }

        const batch = writeBatch(db);
        snap.forEach(sourceDoc => {
            const data = sourceDoc.data();
            batch.set(doc(collection(db, 'daily_logs')), {
                ...data,
                date: targetDate,
                copied_from_date: sourceDate,
                created_at: serverTimestamp()
            });
        });
        await batch.commit();
        await refreshDailyLogViews();
        showError(`${snap.size} besin bugünün günlüğüne eklendi.`, 'success');
        return true;
    } catch (error) {
        console.error('Day copy failed:', error);
        showError('Öğünler kopyalanamadı. Lütfen yeniden dene.');
        return false;
    }
}

function isFuturePreviewEnabled() {
    const params = new URLSearchParams(window.location.search);
    return params.get(PREVIEW_QUERY_KEY) === 'future';
}

function removeFuturePreviewQueryParam() {
    const params = new URLSearchParams(window.location.search);
    if (!params.has(PREVIEW_QUERY_KEY)) return;
    params.delete(PREVIEW_QUERY_KEY);
    const qs = params.toString();
    const nextUrl = `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash || ''}`;
    window.history.replaceState({}, '', nextUrl);
}

function applyFuturePreviewData() {
    const lookupItem = (name) => foods.find(f => f.name === name) || drinks.find(d => d.name === name);
    const createFakeLog = (entry, date, idx) => {
        const item = lookupItem(entry.name);
        if (!item) return null;
        const mult = entry.grams / 100;
        return {
            id: `preview_${date}_${idx}`,
            date,
            item_id: item.id,
            item_name: item.name,
            grams: entry.grams,
            kcal: Math.round(item.kcal_100 * mult),
            protein: Math.round(item.protein_100 * mult * 10) / 10,
            carb: Math.round(item.carb_100 * mult * 10) / 10,
            fat: Math.round(item.fat_100 * mult * 10) / 10,
            created_at: { seconds: Math.floor(Date.now() / 1000) - idx }
        };
    };

    const dates = getLast7Days();
    const templates = [
        [
            { name: 'Yulaf Ezmesi (Kuru)', grams: 70 },
            { name: 'Süt (Yarım Yağlı)', grams: 250 },
            { name: 'Tavuk Göğsü (Haşlanmış)', grams: 180 },
            { name: 'Pirinç (Pişmiş)', grams: 220 },
            { name: 'Ayran', grams: 300 }
        ],
        [
            { name: 'Yumurta (Haşlanmış)', grams: 150 },
            { name: 'Tam Buğday Ekmeği', grams: 90 },
            { name: 'Dana Biftek (Izgara)', grams: 170 },
            { name: 'Bulgur Pilavı', grams: 250 },
            { name: 'Protein Süt (500 ml)', grams: 500 }
        ],
        [
            { name: 'Süzme Yoğurt', grams: 250 },
            { name: 'Muz', grams: 180 },
            { name: 'Tavuk But (Izgarada)', grams: 180 },
            { name: 'Patates (Haşlanmış)', grams: 300 },
            { name: 'Americano', grams: 250 }
        ],
        [
            { name: 'Lor Peyniri', grams: 160 },
            { name: 'Tam Buğday Ekmeği', grams: 110 },
            { name: 'Somon Balığı (Pişmiş)', grams: 170 },
            { name: 'Kinoa (Pişmiş)', grams: 220 },
            { name: 'Kefir (Icilen)', grams: 300 }
        ],
        [
            { name: 'Whey Protein (1 ölçek = 25g)', grams: 25 },
            { name: 'Muz', grams: 160 },
            { name: 'Yagisiz Kiyma (Pismis)', grams: 180 },
            { name: 'Beyaz Pirinc (Pismis)', grams: 240 },
            { name: 'Ayran', grams: 250 }
        ],
        [
            { name: 'Yumurta (Tavada)', grams: 140 },
            { name: 'Simit', grams: 100 },
            { name: 'Et Doner', grams: 220 },
            { name: 'Salata / Yeşillik (Karışık)', grams: 220 },
            { name: 'Sade Soda', grams: 250 }
        ],
        [
            { name: 'Peynirli Omlet', grams: 170 },
            { name: 'Tam Buğday Ekmeği', grams: 80 },
            { name: 'Tavuk Doner', grams: 220 },
            { name: 'Beyaz Pilav (Yagli)', grams: 230 },
            { name: 'Protein Icecegi (Sekersiz)', grams: 330 }
        ]
    ];

    const fakeLogs = [];
    dates.forEach((date, dayIdx) => {
        const template = templates[dayIdx % templates.length];
        template.forEach((entry, entryIdx) => {
            const log = createFakeLog(entry, date, entryIdx + (dayIdx * 10));
            if (log) fakeLogs.push(log);
        });
    });

    weekLogs = fakeLogs.map(({ id, ...rest }) => rest);
    todayLogs = fakeLogs.filter(log => log.date === getToday());
    recentLogs = [...fakeLogs].sort((a, b) => {
        if (a.date !== b.date) return b.date.localeCompare(a.date);
        const aSec = a.created_at?.seconds || 0;
        const bSec = b.created_at?.seconds || 0;
        return bSec - aSec;
    });

    updateSummary();
    renderLogs();
    renderChart();
    updateGoalStreak();

    removeFuturePreviewQueryParam();
}

function showError(message, type = 'error') {
    const errorEl = document.getElementById('errorMessage');
    if (!errorEl) {
        pendingUiMessage = { message, type };
        return;
    }

    pendingUiMessage = null;
    toastSequence += 1;
    if (toastTimer) window.clearTimeout(toastTimer);
    errorEl.textContent = message;
    errorEl.classList.toggle('success', type === 'success');
    errorEl.classList.remove('is-leaving');
    errorEl.style.display = 'block';
    void errorEl.offsetWidth;
    errorEl.classList.add('is-visible');
    toastTimer = window.setTimeout(() => {
        if (errorEl.textContent === message) clearError();
    }, type === 'success' ? 3200 : 4800);
}

function clearError() {
    const errorEl = document.getElementById('errorMessage');
    pendingUiMessage = null;
    if (!errorEl) return;
    const clearingSequence = toastSequence;
    if (toastTimer) window.clearTimeout(toastTimer);
    toastTimer = null;
    if (!errorEl.classList.contains('is-visible')) {
        errorEl.style.display = 'none';
        return;
    }
    errorEl.classList.remove('is-visible');
    errorEl.classList.add('is-leaving');
    window.setTimeout(() => {
        if (toastSequence !== clearingSequence) return;
        errorEl.textContent = '';
        errorEl.classList.remove('success', 'is-leaving');
        errorEl.style.display = 'none';
    }, 210);
}

function requestConfirmation({
    title = 'İşlemi onayla',
    message = 'Bu işleme devam etmek istiyor musun?',
    confirmLabel = 'Onayla',
    cancelLabel = 'Vazgeç',
    danger = false
} = {}) {
    const modal = document.getElementById('confirmModal');
    if (!modal) return Promise.resolve(false);
    if (confirmResolver) confirmResolver(false);

    document.getElementById('confirmModalTitle').textContent = title;
    document.getElementById('confirmModalMessage').textContent = message;
    document.getElementById('cancelConfirmModal').textContent = cancelLabel;
    const acceptButton = document.getElementById('acceptConfirmModal');
    acceptButton.textContent = confirmLabel;
    acceptButton.classList.toggle('is-danger', danger);
    setModalOpen(modal, true, acceptButton);

    return new Promise(resolve => {
        confirmResolver = resolve;
    });
}

function settleConfirmation(approved) {
    const modal = document.getElementById('confirmModal');
    setModalOpen(modal, false);
    const resolver = confirmResolver;
    confirmResolver = null;
    if (resolver) resolver(Boolean(approved));
}

function showLoading() {
    document.getElementById('loadingOverlay')?.classList.remove('hidden');
}

function hideLoading() {
    document.getElementById('loadingOverlay')?.classList.add('hidden');
}

function updateConnectionIndicator(state = navigator.onLine ? 'online' : 'offline') {
    const indicator = document.getElementById('syncIndicator');
    if (!indicator) return;
    const labels = {
        online: 'Bağlı',
        offline: 'Çevrimdışı · kayıtlar sırada',
        error: 'Senkronizasyon sorunu'
    };
    indicator.dataset.state = state;
    indicator.querySelector('strong').textContent = labels[state] || labels.online;
}

function updateThemeControl(isDark) {
    const button = document.getElementById('darkModeBtn');
    if (!button) return;
    const label = isDark ? 'Açık temaya geç' : 'Koyu temaya geç';
    button.title = label;
    button.setAttribute('aria-label', label);
    button.innerHTML = isDark
        ? '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>'
        : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 15.2A8.2 8.2 0 0 1 8.8 4 8.3 8.3 0 1 0 20 15.2Z"/></svg>';
}

// Data Functions
async function loadInitialDailyLogs() {
    try {
        const startDate = getDateDaysAgo(LOG_HISTORY_DAYS - 1);
        const q = query(
            collection(db, 'daily_logs'),
            where('date', '>=', startDate),
            orderBy('date', 'desc')
        );
        const querySnapshot = await getDocs(q);
        const loadedLogs = [];

        querySnapshot.forEach((docSnap) => {
            loadedLogs.push({ id: docSnap.id, ...docSnap.data() });
        });

        loadedLogs.sort((a, b) => {
            if (a.date !== b.date) return b.date.localeCompare(a.date);
            const aSec = a.created_at?.seconds || 0;
            const bSec = b.created_at?.seconds || 0;
            return bSec - aSec;
        });

        recentLogs = loadedLogs;
        todayLogs = loadedLogs.filter(log => log.date === getToday());
        const weekStart = getLast7Days()[0];
        weekLogs = loadedLogs.filter(log => log.date >= weekStart);
        if (logsDateFilter || logsDateToFilter) {
            const from = logsDateFilter || logsDateToFilter;
            const to = logsDateToFilter || logsDateFilter;
            const rangeStart = from <= to ? from : to;
            const rangeEnd = from <= to ? to : from;
            dateFilteredLogs = loadedLogs.filter(log =>
                log.date >= rangeStart && log.date <= rangeEnd
            );
        }

        updateSummary();
        renderLogs();
        renderChart();
        renderProgressInsights();
        updateGoalStreak();
    } catch (error) {
        console.error('Error loading initial daily logs:', error);
        renderLogs();
        renderChart();
        showError('Günlük kayıtların şu anda yüklenemedi.');
    }
}

async function loadLogsForRange(startDate, endDate = '') {
    if (!startDate && !endDate) {
        dateFilteredLogs = [];
        return;
    }

    try {
        let q;
        if (startDate && endDate && startDate !== endDate) {
            const from = startDate <= endDate ? startDate : endDate;
            const to = startDate <= endDate ? endDate : startDate;
            q = query(
                collection(db, 'daily_logs'),
                where('date', '>=', from),
                where('date', '<=', to),
                orderBy('date', 'desc')
            );
        } else {
            const exactDate = startDate || endDate;
            q = query(collection(db, 'daily_logs'), where('date', '==', exactDate));
        }
        const querySnapshot = await getDocs(q);
        dateFilteredLogs = [];
        querySnapshot.forEach((docSnap) => {
            dateFilteredLogs.push({ id: docSnap.id, ...docSnap.data() });
        });
        dateFilteredLogs.sort((a, b) => {
            const aSec = a.created_at?.seconds || 0;
            const bSec = b.created_at?.seconds || 0;
            return bSec - aSec;
        });
    } catch (error) {
        console.error('Date logs could not be loaded:', error);
        dateFilteredLogs = [];
        showError('Seçtiğin tarihin günlüğü yüklenemedi.');
    }
}

async function refreshDailyLogViews() {
    await loadInitialDailyLogs();
    if (logsDateFilter || logsDateToFilter) {
        await loadLogsForRange(logsDateFilter, logsDateToFilter);
        renderLogs();
    }
}

function renderTodayTrainingToggle() {
    const button = document.getElementById('dashboardTrainingToggle');
    const label = document.getElementById('dashboardTrainingLabel');
    const meta = document.getElementById('dashboardTrainingMeta');
    const state = document.getElementById('dashboardTrainingState');
    if (!button || !label || !meta || !state) return;

    const today = getToday();
    const trained = dailyMetaCache.get(today)?.trained === true;
    const activeTarget = getCalorieTargetForDate(today);
    button.classList.toggle('is-training', trained);
    button.setAttribute('aria-pressed', String(trained));
    label.textContent = trained ? 'Bugün antrenman yapmadım' : 'Bugün antrenman yaptım';
    meta.textContent = `${trained ? 'Antrenman' : 'Dinlenme'} hedefi aktif · ${activeTarget} kcal`;
    state.textContent = trained ? 'Antrenman' : 'Dinlenme';
}

function refreshTodayTrainingViews() {
    updateSummary();
    renderChart();
    renderProgressInsights();
}

async function toggleTodayTraining() {
    const button = document.getElementById('dashboardTrainingToggle');
    const date = getToday();
    const hadPrevious = dailyMetaCache.has(date);
    const previous = { ...(dailyMetaCache.get(date) || {}) };
    const trained = previous.trained !== true;
    dailyMetaCache.set(date, {
        ...previous,
        date,
        trained,
        schema_version: APP_SCHEMA_VERSION,
        updated_at: new Date()
    });
    refreshTodayTrainingViews();
    if (button) button.disabled = true;

    try {
        const settings = await readSharedSettingsData();
        const existingMeta = settings.daily_meta && typeof settings.daily_meta === 'object'
            ? settings.daily_meta
            : {};
        const payload = {
            ...(existingMeta[date] && typeof existingMeta[date] === 'object'
                ? existingMeta[date]
                : previous),
            date,
            trained,
            schema_version: APP_SCHEMA_VERSION,
            updated_at: serverTimestamp()
        };
        await writeSharedSettingsField('daily_meta', {
            ...existingMeta,
            [date]: payload
        });
        dailyMetaCache.set(date, { ...payload, updated_at: new Date() });
        refreshTodayTrainingViews();
        showError(
            trained ? 'Bugün antrenman günü olarak kaydedildi.' : 'Bugün dinlenme günü olarak kaydedildi.',
            'success'
        );
    } catch (error) {
        console.error('Training status could not be saved:', error);
        if (hadPrevious) {
            dailyMetaCache.set(date, previous);
        } else {
            dailyMetaCache.delete(date);
        }
        refreshTodayTrainingViews();
        showError('Antrenman durumu kaydedilemedi.');
    } finally {
        if (button) button.disabled = false;
    }
}

function openMoveMeal(date, mealType) {
    movingMealContext = { date, mealType };
    document.getElementById('moveMealDate').value = date;
    document.getElementById('moveMealType').value = MEAL_LABELS[mealType] ? mealType : 'snack';
    document.getElementById('moveMealDescription').textContent =
        `${formatDate(date)} · ${MEAL_LABELS[mealType] || 'Öğün'} içindeki bütün besinler taşınacak.`;
    setModalOpen(
        document.getElementById('moveMealModal'),
        true,
        document.getElementById('moveMealDate')
    );
}

async function moveMealToDate() {
    if (!movingMealContext) return;
    const targetDate = document.getElementById('moveMealDate').value;
    const targetMeal = document.getElementById('moveMealType').value;
    const loadedLogs = new Map([...recentLogs, ...dateFilteredLogs].map(log => [log.id, log]));
    const sourceLogs = [...loadedLogs.values()].filter(log =>
        log.date === movingMealContext.date && log.meal_type === movingMealContext.mealType
    );
    if (!targetDate || sourceLogs.length === 0) {
        showError('Taşınacak öğün bulunamadı.');
        return;
    }
    try {
        await dataStore.batchUpdate('daily_logs', sourceLogs.map(log => ({
            id: log.id,
            data: {
                date: targetDate,
                meal_type: targetMeal,
                updated_at: serverTimestamp()
            }
        })));
        setModalOpen(document.getElementById('moveMealModal'), false);
        movingMealContext = null;
        await refreshDailyLogViews();
        showError(`${sourceLogs.length} besin yeni güne taşındı.`, 'success');
    } catch (error) {
        console.error('Meal move failed:', error);
        showError('Öğün taşınamadı.');
    }
}

async function moveLogToMeal(logId, date, mealType) {
    const log = findLoadedLog(logId);
    if (!log || (log.date === date && log.meal_type === mealType)) return;
    try {
        await dataStore.updateDocument('daily_logs', logId, {
            date,
            meal_type: mealType,
            updated_at: serverTimestamp()
        });
        await refreshDailyLogViews();
        showError(`Besin ${MEAL_LABELS[mealType] || 'öğüne'} taşındı.`, 'success');
    } catch (error) {
        console.error('Log drag move failed:', error);
        showError('Besin taşınamadı.');
    }
}

function updateGoalStreak() {
    const dates = getLast7Days().reverse(); // Most recent first
    let streak = 0;

    for (const date of dates) {
        const dayLogs = weekLogs.filter(log => log.date === date);
        const dayTotal = dayLogs.reduce((sum, log) => sum + log.kcal, 0);
        const dayTarget = getCalorieTargetForDate(date);

        // Check if goal was met (within 70-120% range)
        const goalMet = dayTotal >= dayTarget * 0.7 && dayTotal <= dayTarget * 1.2;
        const todayStillInProgress = date === getToday() && dayTotal < dayTarget * 0.7;

        if (todayStillInProgress) {
            continue;
        }

        if (goalMet) {
            streak++;
        } else {
            break; // Streak ends
        }
    }

    const goalCountEl = document.getElementById('goalCount');
    if (streak > 0) {
        goalCountEl.textContent = `${streak} günlük seri`;
        goalCountEl.style.display = 'block';
    } else {
        goalCountEl.style.display = 'none';
    }
}

function getCalorieTargetForDate(date) {
    const profile = loadProfile();
    const dayTargets = calculateDayTypeEnergyTargets(TARGETS.kcal, profile.trainingDays);
    return resolveDayEnergyTarget({
        baseKcal: TARGETS.kcal,
        ...dayTargets,
        trained: dailyMetaCache.get(date)?.trained === true
    });
}

function getMacroTargetsForDate(date) {
    return calculateMacroTargets(getCalorieTargetForDate(date), MACRO_PREFERENCES);
}

function renderProgressInsights() {
    const weeklyDates = getLast7Days();
    const weeklyLogs = recentLogs.filter(log => weeklyDates.includes(log.date));
    const budget = calculateWeeklyBudget(weeklyLogs, getCalorieTargetForDate, weeklyDates);
    const macro = calculateMacroAdherence(weeklyLogs, getMacroTargetsForDate, weeklyDates);
    const macroScores = Object.values(macro).map(value =>
        Math.max(0, 100 - Math.abs(100 - value.percentage))
    );
    const macroScore = Math.round(macroScores.reduce((sum, value) => sum + value, 0) / macroScores.length);

    const budgetValue = document.getElementById('weeklyBudgetValue');
    const budgetNote = document.getElementById('weeklyBudgetNote');
    const macroValue = document.getElementById('weeklyMacroValue');
    const macroNote = document.getElementById('weeklyMacroNote');
    if (budgetValue) budgetValue.textContent = `${budget.percentage}%`;
    if (budgetNote) {
        budgetNote.textContent = budget.remaining >= 0
            ? `Haftalık hedefin ${budget.remaining} kcal altında`
            : `Haftalık hedefin ${Math.abs(budget.remaining)} kcal üstünde`;
    }
    if (macroValue) macroValue.textContent = `${macroScore}%`;
    if (macroNote) {
        macroNote.textContent =
            `P ${macro.protein.percentage}% · K ${macro.carb.percentage}% · Y ${macro.fat.percentage}%`;
    }

    const todayTotal = sumLogs(todayLogs).kcal;
    const guidance = document.getElementById('calorieGuidance');
    if (guidance) {
        const status = getCalorieStatus(todayTotal, getCalorieTargetForDate(getToday()));
        guidance.dataset.status = status;
        guidance.textContent = getCalorieGuidance(todayTotal, getCalorieTargetForDate(getToday()));
    }

    const calendar = document.getElementById('targetCalendar');
    if (!calendar) return;
    const visibleDates = Array.from({ length: 7 }, (_, index) => getDateDaysAgo(3 - index));
    const intakeByDate = new Map();
    recentLogs.forEach(log => {
        intakeByDate.set(log.date, (intakeByDate.get(log.date) || 0) + Number(log.kcal || 0));
    });
    calendar.innerHTML = `
        <div class="target-calendar-legend">
            <span><i data-status="low"></i> Eksik</span>
            <span><i data-status="on-target"></i> Hedefe yakın</span>
            <span><i data-status="high"></i> Fazla</span>
        </div>
        <div class="target-calendar-grid">
            ${visibleDates.map(date => {
                const kcal = intakeByDate.get(date) || 0;
                const status = getCalorieStatus(kcal, getCalorieTargetForDate(date));
                const isToday = date === getToday();
                return `
                    <div class="target-calendar-day${isToday ? ' is-today' : ''}" data-status="${status}" title="${formatDate(date)} · ${Math.round(kcal)} kcal">
                        <small>${isToday ? 'Bugün' : getTurkishDayName(date)}</small>
                        <strong>${new Date(`${date}T12:00:00`).getDate()}</strong>
                    </div>
                `;
            }).join('')}
        </div>
    `;
}

function getItemType(item) {
    if (item?.type === 'drink' || item?.type === 'food') return item.type;
    return drinks.some(drink => drink.id === item?.id) ? 'drink' : 'food';
}

function getLogUnit(log) {
    if (log?.unit === 'ml' || log?.item_type === 'drink' || String(log?.item_id || '').startsWith('drink_')) {
        return 'ml';
    }
    return 'g';
}

function formatLogPortion(log) {
    const labels = {
        g: 'g',
        ml: 'ml',
        portion: 'porsiyon',
        piece: 'adet',
        slice: 'dilim',
        tablespoon: 'yk',
        glass: 'bardak',
        tea_glass: 'çay bardağı',
        cup: 'kupa'
    };
    const amount = Number(log?.display_amount);
    const unit = String(log?.display_unit || '');
    if (Number.isFinite(amount) && amount > 0 && labels[unit]) {
        return `${amount} ${labels[unit]}`;
    }
    const baseAmount = Number.isFinite(Number(log?.grams)) ? Number(log.grams) : 0;
    return `${baseAmount} ${getLogUnit(log)}`;
}

const MEAL_LABELS = {
    breakfast: 'Kahvaltı',
    lunch: 'Öğle',
    dinner: 'Akşam',
    snack: 'Ara öğün'
};

async function addLog(item, grams, logDate = getToday(), mealType = 'snack', displayPortion = null) {
    try {
        const nutrition = calculateLogNutrition(item, grams);
        const itemType = getItemType(item);
        
        const logData = {
            date: logDate,
            item_id: item.id,
            item_name: item.name,
            grams: grams,
            item_type: itemType,
            unit: itemType === 'drink' ? 'ml' : 'g',
            display_amount: Number(displayPortion?.amount) || grams,
            display_unit: displayPortion?.unit || (itemType === 'drink' ? 'ml' : 'g'),
            meal_type: MEAL_LABELS[mealType] ? mealType : 'snack',
            nutrition_confidence: inferNutritionConfidence(item),
            schema_version: APP_SCHEMA_VERSION,
            ...nutrition,
            created_at: serverTimestamp()
        };
        
        await addDoc(collection(db, 'daily_logs'), logData);
        if (displayPortion?.amount && displayPortion?.unit) {
            savePortionUsage(item, itemType, displayPortion.amount, displayPortion.unit);
        }
        await refreshDailyLogViews();
        
        // Reset form
        document.getElementById('searchInput').value = '';
        document.getElementById('gramsInput').value = '';
        document.getElementById('calculationPreview').style.display = 'none';
        document.getElementById('portionPresets').style.display = 'none';
        selectedItem = null;
        
    } catch (error) {
        console.error('Error adding log:', error);
        showError('Besin günlüğe eklenemedi. Lütfen yeniden dene.');
    }
}

async function deleteLog(logId) {
    try {
        await deleteDoc(doc(db, 'daily_logs', logId));
        await refreshDailyLogViews();
    } catch (error) {
        console.error('Error deleting log:', error);
        showError('Kayıt silinemedi. Lütfen yeniden dene.');
    }
}

function findLoadedLog(logId) {
    return dateFilteredLogs.find(log => log.id === logId)
        || recentLogs.find(log => log.id === logId)
        || todayLogs.find(log => log.id === logId);
}

function editLog(logId) {
    const log = findLoadedLog(logId);
    if (!log) return;

    editingLogId = logId;
    lastEditLogTrigger = document.activeElement;
    document.getElementById('editLogName').textContent = log.item_name;
    document.getElementById('editLogAmount').value = log.grams;
    document.getElementById('editLogAmountLabel').textContent = `Porsiyon (${getLogUnit(log)})`;
    document.getElementById('editLogDate').value = log.date;
    document.getElementById('editLogMealType').value = MEAL_LABELS[log.meal_type] ? log.meal_type : 'snack';
    document.getElementById('editLogModal').classList.add('active');
    window.requestAnimationFrame(() => document.getElementById('editLogAmount')?.focus());
}

async function saveEditedLog() {
    const log = findLoadedLog(editingLogId);
    if (!log) return;

    const amount = parseFloat(document.getElementById('editLogAmount').value);
    const date = document.getElementById('editLogDate').value;
    const mealType = document.getElementById('editLogMealType').value;
    if (!Number.isFinite(amount) || amount <= 0 || !date) {
        showError('Geçerli bir porsiyon ve tarih seç.');
        return;
    }

    const sourceItem =
        foods.find(item => item.id === log.item_id) ||
        drinks.find(item => item.id === log.item_id);

    let nutrition;
    if (!sourceItem) {
        const oldAmount = Number(log.grams) || 100;
        const ratio = amount / oldAmount;
        nutrition = {
            kcal: Math.round((log.kcal || 0) * ratio),
            protein: Math.round((log.protein || 0) * ratio * 10) / 10,
            carb: Math.round((log.carb || 0) * ratio * 10) / 10,
            fat: Math.round((log.fat || 0) * ratio * 10) / 10,
            fiber: Math.round((log.fiber || 0) * ratio * 10) / 10,
            sugar: Math.round((log.sugar || 0) * ratio * 10) / 10,
            sodium: Math.round((log.sodium || 0) * ratio * 10) / 10
        };
    } else {
        nutrition = calculateLogNutrition(sourceItem, amount);
    }

    try {
        await updateDoc(doc(db, 'daily_logs', editingLogId), {
            grams: amount,
            display_amount: amount,
            display_unit: getLogUnit(log),
            date,
            meal_type: mealType,
            ...nutrition
        });
        document.getElementById('editLogModal').classList.remove('active');
        editingLogId = null;
        await refreshDailyLogViews();
    } catch (error) {
        console.error('Error updating log:', error);
        showError('Değişiklikler kaydedilemedi. Lütfen yeniden dene.');
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

        saveRecentItems(loadRecentItems().filter(entry => entry.id !== itemId));
        localStorage.setItem(
            FAVORITES_KEY,
            JSON.stringify(loadFavoriteItems().filter(entry => entry.id !== itemId))
        );

        const cleanedTemplates = loadTemplates()
            .map(template => ({
                ...template,
                items: template.items.filter(entry => entry.item_id !== itemId)
            }))
            .filter(template => template.items.length > 0);
        const updatedAtMs = saveTemplates(cleanedTemplates);
        await saveTemplatesToCloud(cleanedTemplates, updatedAtMs);
        renderTemplateList();

        // Update dropdown with current search term
        const searchInput = document.getElementById('searchInput');
        const currentSearch = searchInput.value.trim();
        const itemType = document.querySelector('input[name="itemType"]:checked').value;

        if (currentSearch) {
            // Re-render dropdown with current search
            const filtered = filterItems(currentSearch, itemType);
            renderDropdown(filtered, { searchTerm: currentSearch });
        } else {
            const suggestedItems = getSuggestedItemsByType(itemType);
            renderDropdown(suggestedItems, { showHeader: true });
        }

        // Clear selection
        selectedItem = null;
        document.getElementById('calculationPreview').style.display = 'none';

        showError('Besin, favorilerinden ve kayıtlı öğünlerinden kaldırıldı.', 'success');
    } catch (error) {
        console.error('Error deleting custom item:', error);
        showError('Besin silinemedi. Lütfen yeniden dene.');
    }
}

// Render Functions
function renderLogs() {
    const container = document.getElementById('logsContainer');
    const countEl = document.getElementById('logsCount');
    const clearFilterBtn = document.getElementById('clearLogsDateFilter');
    const baseLogs = recentLogs.length > 0 ? recentLogs : todayLogs;
    const hasDateFilter = Boolean(logsDateFilter || logsDateToFilter);
    const allLogsForList = hasDateFilter ? dateFilteredLogs : baseLogs;
    const logsForList = allLogsForList.slice(0, logsVisibleCount);
    const loadMoreBtn = document.getElementById('loadMoreLogsBtn');
    const rangeLabel = !hasDateFilter
        ? ''
        : (logsDateFilter && logsDateToFilter && logsDateFilter !== logsDateToFilter
            ? `${formatDate(logsDateFilter)} – ${formatDate(logsDateToFilter)}`
            : formatDate(logsDateFilter || logsDateToFilter));
    if (countEl) {
        countEl.textContent = hasDateFilter
            ? `${allLogsForList.length} kayıt · ${rangeLabel}`
            : `${allLogsForList.length} kayıt`;
    }

    if (clearFilterBtn) {
        clearFilterBtn.classList.toggle('is-visible', hasDateFilter);
    }

    if (allLogsForList.length === 0) {
        if (loadMoreBtn) loadMoreBtn.style.display = 'none';
        container.innerHTML = hasDateFilter
            ? `<div class="no-logs">${rangeLabel} aralığında günlüğe eklenmiş bir besin yok.</div>`
            : '<div class="no-logs">Günlüğün henüz boş. İlk öğününü ekleyerek başla.</div>';
        return;
    }

    if (loadMoreBtn) {
        loadMoreBtn.style.display = logsVisibleCount < allLogsForList.length ? 'block' : 'none';
    }

    const logsByDate = new Map();
    logsForList.forEach(log => {
        if (!logsByDate.has(log.date)) logsByDate.set(log.date, []);
        logsByDate.get(log.date).push(log);
    });

    const mealOrder = ['breakfast', 'lunch', 'dinner', 'snack'];
    container.innerHTML = [...logsByDate.entries()].map(([date, dayLogs]) => {
        const dayKcal = dayLogs.reduce((sum, log) => sum + Number(log.kcal || 0), 0);
        const mealKeys = [
            ...mealOrder.filter(type => dayLogs.some(log => log.meal_type === type)),
            ...new Set(dayLogs
                .map(log => log.meal_type || 'other')
                .filter(type => !mealOrder.includes(type)))
        ];

        return `
            <section class="log-day-group">
                <div class="log-day-header">
                    <div>
                        <strong>${date === getToday() ? 'Bugün' : formatDate(date)}</strong>
                        <span>${getTurkishDayName(date)}</span>
                    </div>
                    <span>${Math.round(dayKcal)} kcal</span>
                </div>
                ${mealKeys.map(mealType => {
                    const mealLogs = dayLogs.filter(log => (log.meal_type || 'other') === mealType);
                    const mealTotals = getMealTotals(mealLogs);
                    const mealLabel = MEAL_LABELS[mealType] || 'Diğer';
                    return `
                        <div class="meal-group" data-meal="${mealType}" data-date="${date}">
                            <div class="meal-group-header">
                                <div>
                                    <strong>${mealLabel}</strong>
                                    <span>${Math.round(mealTotals.kcal)} kcal · P ${Math.round(mealTotals.protein)}g · K ${Math.round(mealTotals.carb)}g · Y ${Math.round(mealTotals.fat)}g</span>
                                </div>
                                <div class="meal-group-actions">
                                    <button class="meal-move" type="button" data-meal="${mealType}" data-date="${date}">Taşı</button>
                                    <button class="meal-add" type="button" data-meal="${mealType}" data-date="${date}">+ Ekle</button>
                                </div>
                            </div>
                            ${mealLogs.map(log => {
                                const safeLogId = escapeHtml(log.id);
                                const protein = Number.isFinite(Number(log.protein)) ? Number(log.protein) : 0;
                                const carb = Number.isFinite(Number(log.carb)) ? Number(log.carb) : 0;
                                const fat = Number.isFinite(Number(log.fat)) ? Number(log.fat) : 0;
                                const fiber = Number.isFinite(Number(log.fiber)) ? Number(log.fiber) : 0;
                                const sugar = Number.isFinite(Number(log.sugar)) ? Number(log.sugar) : 0;
                                const sodium = Number.isFinite(Number(log.sodium)) ? Number(log.sodium) : 0;
                                const kcal = Number.isFinite(Number(log.kcal)) ? Number(log.kcal) : 0;
                                const confidence = inferNutritionConfidence({
                                    name: log.item_name,
                                    nutrition_confidence: log.nutrition_confidence
                                });
                                const confidenceLabel = confidence === 'verified'
                                    ? ''
                                    : `<span class="log-confidence" data-confidence="${confidence}">${getNutritionConfidenceLabel(confidence)}</span>`;
                                return `
                                <div class="log-item" data-id="${safeLogId}" draggable="true">
                                    <div class="log-info">
                                        <div class="log-name">${escapeHtml(log.item_name)}</div>
                                        <div class="log-details">
                                            <span>${escapeHtml(formatLogPortion(log))}</span>
                                            <span>P ${protein}g</span>
                                            <span>K ${carb}g</span>
                                            <span>Y ${fat}g</span>
                                            ${fiber > 0 ? `<span>L ${fiber}g</span>` : ''}
                                            ${sugar > 0 ? `<span>Ş ${sugar}g</span>` : ''}
                                            ${sodium > 0 ? `<span>Na ${sodium}mg</span>` : ''}
                                            ${confidenceLabel}
                                        </div>
                                    </div>
                                    <div class="log-kcal">${kcal}<span>kcal</span></div>
                                    <div class="log-actions">
                                        <button class="log-edit" data-id="${safeLogId}" title="Düzenle">Düzenle</button>
                                        <button class="log-delete" data-id="${safeLogId}" title="Sil">Sil</button>
                                    </div>
                                </div>
                            `;
                            }).join('')}
                        </div>
                    `;
                }).join('')}
            </section>
        `;
    }).join('');

    container.querySelectorAll('.meal-add').forEach(btn => {
        btn.addEventListener('click', () => {
            if (typeof window.switchTab === 'function') window.switchTab('add');
            const mealSelect = document.getElementById('mealType');
            if (mealSelect && mealOrder.includes(btn.dataset.meal)) {
                mealSelect.value = btn.dataset.meal;
            }
            const logDateInput = document.getElementById('logDate');
            if (logDateInput && btn.dataset.date) {
                logDateInput.value = btn.dataset.date;
            }
        });
    });

    container.querySelectorAll('.meal-move').forEach(btn => {
        btn.addEventListener('click', () => openMoveMeal(btn.dataset.date, btn.dataset.meal));
    });

    container.querySelectorAll('.log-item[draggable="true"]').forEach(item => {
        item.addEventListener('dragstart', event => {
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', item.dataset.id);
            item.classList.add('is-dragging');
        });
        item.addEventListener('dragend', () => item.classList.remove('is-dragging'));
    });

    container.querySelectorAll('.meal-group[data-meal]').forEach(group => {
        group.addEventListener('dragover', event => {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
            group.classList.add('is-drag-over');
        });
        group.addEventListener('dragleave', event => {
            if (!group.contains(event.relatedTarget)) group.classList.remove('is-drag-over');
        });
        group.addEventListener('drop', event => {
            event.preventDefault();
            group.classList.remove('is-drag-over');
            const logId = event.dataTransfer.getData('text/plain');
            if (logId) void moveLogToMeal(logId, group.dataset.date, group.dataset.meal);
        });
    });

    // Add edit event listeners
    container.querySelectorAll('.log-edit').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            editLog(btn.dataset.id);
        });
    });

    // Add delete event listeners
    container.querySelectorAll('.log-delete').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const approved = await requestConfirmation({
                title: 'Günlük kaydını sil',
                message: 'Bu besin kaydı günlükten kalıcı olarak silinsin mi?',
                confirmLabel: 'Kaydı sil',
                danger: true
            });
            if (approved) {
                deleteLog(btn.dataset.id);
            }
        });
    });
}

function updateSummary() {
    const totals = sumLogs(todayLogs);
    const calorieTarget = getCalorieTargetForDate(getToday());
    const macroTargets = getMacroTargetsForDate(getToday());

    // Update calorie display
    document.getElementById('currentKcal').textContent = totals.kcal;
    document.getElementById('targetKcalDisplay').textContent = calorieTarget;
    const percentage = Math.min((totals.kcal / calorieTarget) * 100, 100);

    // Update simple progress bar
    const calorieBar = document.getElementById('calorieBar');
    calorieBar.style.width = `${percentage}%`;
    const calorieRing = document.getElementById('calorieRing');
    if (calorieRing) {
        calorieRing.style.setProperty('--progress', percentage.toFixed(1));
    }
    const remaining = calorieTarget - totals.kcal;
    document.getElementById('remainingKcal').textContent =
        remaining > 0 ? `${remaining} kcal kaldı` : `${Math.abs(remaining)} kcal aşıldı`;

    // Update macro bars
    updateMacroBar('protein', totals.protein, macroTargets.protein);
    updateMacroBar('carb', totals.carb, macroTargets.carb);
    updateMacroBar('fat', totals.fat, macroTargets.fat);
    const macroGuidance = document.getElementById('macroGuidance');
    if (macroGuidance) {
        macroGuidance.textContent = getMacroGuidance(totals, macroTargets);
    }
    renderTodayTrainingToggle();
}

function updateMacroBar(type, current, target) {
    const percentage = Math.min((current / target) * 100, 100);
    document.getElementById(`${type}Bar`).style.width = `${percentage}%`;
    document.getElementById(`${type}Value`).textContent = `${Math.round(current)} / ${target}g`;
}

function renderChart() {
    const container = document.getElementById('chartContainer');
    const dates = getLast7Days();

    const dailyMap = {};
    dates.forEach(date => {
        dailyMap[date] = 0;
    });

    weekLogs.forEach(log => {
        if (dailyMap.hasOwnProperty(log.date)) {
            dailyMap[log.date] += log.kcal;
        }
    });

    const dailyTotals = dates.map(date => ({
        date,
        kcal: dailyMap[date] || 0,
        target: getCalorieTargetForDate(date)
    }));
    const values = dailyTotals.map(d => d.kcal);
    const averageTarget = Math.round(
        dailyTotals.reduce((sum, day) => sum + day.target, 0) / dailyTotals.length
    );

    const activeDays = values.filter(v => v > 0).length;
    const weekTotal = values.reduce((sum, v) => sum + v, 0);
    const weekAvg = activeDays > 0 ? Math.round(weekTotal / activeDays) : 0;
    const hitDays = dailyTotals.filter(day =>
        day.kcal >= day.target * 0.7 && day.kcal <= day.target * 1.2
    ).length;

    const maxKcal = Math.max(...values, ...dailyTotals.map(day => day.target), 1);

    const avgDiff = weekAvg - averageTarget;
    const avgDiffText = avgDiff === 0
        ? 'Hedefle aynı düzeyde'
        : avgDiff > 0
            ? `Hedefin ${avgDiff} kcal üzerinde`
            : `Hedefin ${Math.abs(avgDiff)} kcal altında`;

    const bestDay = dailyTotals.reduce((best, current) => current.kcal > best.kcal ? current : best, dailyTotals[0]);
    const bestDayText = bestDay.kcal > 0
        ? `${getTurkishDayName(bestDay.date)} (${bestDay.kcal} kcal)`
        : 'Henüz veri yok';

    let trendText = 'Eğilim için veri birikiyor';
    const loggedValues = values.filter(v => v > 0);
    if (loggedValues.length >= 4) {
        const half = Math.floor(loggedValues.length / 2);
        const firstAvg = loggedValues.slice(0, half).reduce((a, b) => a + b, 0) / half;
        const secondAvg = loggedValues.slice(half).reduce((a, b) => a + b, 0) / (loggedValues.length - half);
        const trendDiff = Math.round(secondAvg - firstAvg);

        if (Math.abs(trendDiff) < 80) {
            trendText = 'Dengeli ilerliyor';
        } else if (trendDiff > 0) {
            trendText = `Yükselen eğilim (+${trendDiff} kcal)`;
        } else {
            trendText = `Azalan eğilim (${trendDiff} kcal)`;
        }
    }

    const chartWidth = 680;
    const chartHeight = 272;
    const chartLeft = 44;
    const chartRight = 14;
    const chartTop = 30;
    const chartBottom = 42;
    const chartPlotWidth = chartWidth - chartLeft - chartRight;
    const chartPlotHeight = chartHeight - chartTop - chartBottom;
    const chartMax = Math.max(500, Math.ceil(maxKcal / 500) * 500);
    const chartBarGap = 18;
    const chartBarWidth = (chartPlotWidth - (chartBarGap * 6)) / 7;
    const chartY = value => chartTop + chartPlotHeight - (Math.min(value, chartMax) / chartMax) * chartPlotHeight;
    const chartGridValues = [chartMax, Math.round(chartMax / 2), 0];

    container.innerHTML = `
        <div class="chart-dashboard">
            <div class="chart-summary-row">
                <div class="chart-summary-item">
                    <span>Günlük ortalama</span>
                    <strong>${weekAvg || '—'} <small>${weekAvg ? 'kcal' : ''}</small></strong>
                    <em>${weekAvg ? avgDiffText : 'Kayıt bekleniyor'}</em>
                </div>
                <div class="chart-summary-item">
                    <span>Hedef aralığında</span>
                    <strong>${hitDays} <small>gün</small></strong>
                    <em>${activeDays}/7 gün kayıtlı</em>
                </div>
                <div class="chart-summary-item">
                    <span>Haftalık toplam</span>
                    <strong>${weekTotal || '—'} <small>${weekTotal ? 'kcal' : ''}</small></strong>
                    <em>${bestDay.kcal > 0 ? `En yüksek: ${bestDayText}` : trendText}</em>
                </div>
            </div>

            <div class="weekly-chart-wrap">
                <div class="weekly-chart-head">
                    <div>
                        <strong>Kalori akışı</strong>
                        <span>${trendText}</span>
                    </div>
                    <div class="chart-legend">
                        <span><i class="legend-target"></i> Ort. hedef ${averageTarget}</span>
                        <span><i class="legend-intake"></i> Tüketim</span>
                    </div>
                </div>
                <svg class="weekly-chart" viewBox="0 0 ${chartWidth} ${chartHeight}" role="img" aria-labelledby="weeklyChartTitle weeklyChartDesc">
                    <title id="weeklyChartTitle">Son yedi günün kalori grafiği</title>
                    <desc id="weeklyChartDesc">Ortalama günlük hedef ${averageTarget} kcal. Haftalık ortalama ${weekAvg} kcal ve toplam ${weekTotal} kcal.</desc>
                    ${chartGridValues.map(value => {
                        const y = chartY(value);
                        return `
                            <line class="weekly-chart-grid" x1="${chartLeft}" y1="${y}" x2="${chartWidth - chartRight}" y2="${y}"></line>
                            <text class="weekly-chart-axis" x="${chartLeft - 9}" y="${y + 4}" text-anchor="end">${value}</text>
                        `;
                    }).join('')}
                    <line class="weekly-chart-target" x1="${chartLeft}" y1="${chartY(averageTarget)}" x2="${chartWidth - chartRight}" y2="${chartY(averageTarget)}"></line>
                    <text class="weekly-chart-target-label" x="${chartWidth - chartRight}" y="${Math.max(14, chartY(averageTarget) - 7)}" text-anchor="end">ort. hedef</text>
                    ${dailyTotals.map((day, index) => {
                        const x = chartLeft + index * (chartBarWidth + chartBarGap);
                        const y = chartY(day.kcal);
                        const barHeight = day.kcal > 0 ? Math.max(5, chartTop + chartPlotHeight - y) : 0;
                        const statusClass = day.kcal > day.target * 1.2
                            ? 'over'
                            : (day.kcal > 0 && day.kcal < day.target * 0.7 ? 'under' : 'balanced');
                        const isToday = day.date === getToday();
                        return `
                            <g class="weekly-chart-day ${isToday ? 'today' : ''}">
                                <rect class="weekly-chart-bar ${statusClass}" x="${x.toFixed(1)}" y="${(chartTop + chartPlotHeight - barHeight).toFixed(1)}" width="${chartBarWidth.toFixed(1)}" height="${barHeight.toFixed(1)}" rx="10">
                                    <title>${getTurkishDayName(day.date)}: ${day.kcal} kcal</title>
                                </rect>
                                <text class="weekly-chart-value" x="${(x + chartBarWidth / 2).toFixed(1)}" y="${Math.max(18, chartTop + chartPlotHeight - barHeight - 8).toFixed(1)}" text-anchor="middle">${day.kcal || '—'}</text>
                                <text class="weekly-chart-day-label" x="${(x + chartBarWidth / 2).toFixed(1)}" y="${chartHeight - 13}" text-anchor="middle">${getTurkishDayName(day.date)}</text>
                            </g>
                        `;
                    }).join('')}
                </svg>
            </div>
        </div>
    `;
}

// Seri sayisini dondur (updateGoalStreak'ten bagimsiz helper)
function getGoalStreak() {
    const dates = getLast7Days().reverse();
    let streak = 0;
    for (const date of dates) {
        const dayLogs = weekLogs.filter(log => log.date === date);
        const dayTotal = dayLogs.reduce((sum, log) => sum + log.kcal, 0);
        const dayTarget = getCalorieTargetForDate(date);
        if (date === getToday() && dayTotal < dayTarget * 0.7) {
            continue;
        }
        if (dayTotal >= dayTarget * 0.7 && dayTotal <= dayTarget * 1.2) {
            streak++;
        } else {
            break;
        }
    }
    return streak;
}

const LAUNCH_MOTIVATION_LAST_KEY = 'launchMotivationLast';
let launchMotivationMessage = null;

function getLaunchMotivationMessage() {
    if (launchMotivationMessage) return launchMotivationMessage;

    const launchPool = [
        'Bugünü olduğu gibi kaydet; kusursuz olmak zorunda değil.',
        'Düzenli kayıt, ilerlemeyi tahminden çıkarır.',
        'Bir öğünle başla. Günün geri kalanı daha kolay gelir.',
        'Hedefe değil, bugünkü seçimlerine odaklan.',
        'Küçük ve sürdürülebilir değişimler daha uzun yaşar.',
        'Veriyi düzenli tut; kararlarını haftalık ortalamaya göre ver.'
    ];

    const last = localStorage.getItem(LAUNCH_MOTIVATION_LAST_KEY);
    const candidates = launchPool.filter(msg => msg !== last);
    const source = candidates.length > 0 ? candidates : launchPool;
    launchMotivationMessage = source[Math.floor(Math.random() * source.length)];
    localStorage.setItem(LAUNCH_MOTIVATION_LAST_KEY, launchMotivationMessage);
    return launchMotivationMessage;
}

function updateMotivation() {
    const motivationEl = document.querySelector('#motivationText');
    if (!motivationEl) return;
    const totals = sumLogs(todayLogs);

    const remaining = TARGETS.kcal - totals.kcal;
    const proteinPct = TARGETS.protein > 0 ? (totals.protein / TARGETS.protein) * 100 : 0;

    // 7 gunluk ortalama
    const dates = getLast7Days();
    const dailyTotals = {};
    dates.forEach(date => dailyTotals[date] = 0);
    weekLogs.forEach(log => {
        if (dailyTotals.hasOwnProperty(log.date)) {
            dailyTotals[log.date] += log.kcal;
        }
    });
    const weekValues = Object.values(dailyTotals);
    const loggedDays = weekValues.filter(v => v > 0).length;
    const weekAvg = loggedDays > 0
        ? Math.round(weekValues.reduce((a, b) => a + b, 0) / loggedDays)
        : 0;
    const streak = getGoalStreak();

    // Saat bazli
    const hour = new Date().getHours();
    const timeOfDay = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';

    const pickOne = (arr) => arr[Math.floor(Math.random() * arr.length)];
    const messages = [];
    messages.push(getLaunchMotivationMessage());
    const pepTalkPool = [
        'Tek bir gün yerine haftanın genel dengesine bak.',
        'İyi plan, tekrar edebildiğin plandır.',
        'Bugünkü kayıt yarının kararını kolaylaştırır.',
        'Küçük sapmalar normal; önemli olan genel yön.'
    ];

    // Kalori bazli ana mesaj
    if (totals.kcal === 0) {
        const timeMsg = {
            morning: [
                'İlk öğününü ekleyerek bugünün dengesini oluşturmaya başla.',
                'Kahvaltını kaydet; günün kalan hedefi hemen netleşsin.',
                'Güne su ve dengeli bir ilk öğünle başlamak iyi bir temel oluşturur.'
            ],
            afternoon: [
                'Günün yarısı geçti. Şimdiye kadarki öğünlerini ekleyip kalan hedefi gör.',
                'Öğle kaydı, akşam porsiyonunu daha rahat planlamanı sağlar.'
            ],
            evening: [
                'Gün bitmeden eksik öğünlerini tamamla.',
                'Akşam öğününü ekle ve günü net bir tabloyla kapat.'
            ]
        };
        messages.push(pickOne(timeMsg[timeOfDay]));
    } else if (remaining > 800) {
        messages.push(pickOne([
            `Bugün için ${remaining} kcal alanın var.`,
            `Kalan ${remaining} kcal için dengeli bir öğün planlayabilirsin.`,
            `${remaining} kcal alanın kaldı; protein ve lif içeren bir öğün iyi tamamlar.`
        ]));
    } else if (remaining > 300) {
        messages.push(pickOne([
            `Hedefe yaklaşırken ${remaining} kcal alanın kaldı.`,
            `${remaining} kcal ile günü dengeli biçimde tamamlayabilirsin.`,
            `Kalan ${remaining} kcal için küçük bir öğün yeterli olabilir.`
        ]));
    } else if (remaining > 0) {
        messages.push(pickOne([
            `Günlük hedefine ${remaining} kcal kaldı.`,
            `Kalan ${remaining} kcal küçük bir ara öğün için uygun.`
        ]));
    } else if (remaining === 0) {
        messages.push(pickOne([
            'Bugünün enerji hedefini tam olarak tamamladın.',
            'Günlük enerji dengesi hedefinle aynı seviyede.'
        ]));
    } else if (Math.abs(remaining) < 200) {
        messages.push(pickOne([
            `Hedefin ${Math.abs(remaining)} kcal üzerindesin; haftalık ortalama hâlâ daha anlamlı.`,
            `${Math.abs(remaining)} kcal fark küçük bir günlük sapma olarak değerlendirilebilir.`
        ]));
    } else {
        messages.push(pickOne([
            `Bugün hedefin ${Math.abs(remaining)} kcal üzerindesin. Bir sonraki öğünü daha sade tutabilirsin.`,
            `${Math.abs(remaining)} kcal fark var; yarın normal planına dönmen yeterli.`
        ]));
    }

    // Protein geri bildirimi
    if (totals.kcal > 0) {
        if (proteinPct >= 100) {
            messages.push(pickOne([
                'Protein hedefini tamamladın.',
                'Protein dengesi bugün hedef aralığında.'
            ]));
        } else if (proteinPct >= 70) {
            messages.push(pickOne([
                `Protein hedefinin %${Math.round(proteinPct)} kadarını tamamladın.`,
                `Protein tarafında hedefe yakınsın: %${Math.round(proteinPct)}.`
            ]));
        } else if (proteinPct < 40 && totals.kcal > TARGETS.kcal * 0.5) {
            messages.push(pickOne([
                `Protein hedefinin %${Math.round(proteinPct)} kadarındasın; bir sonraki öğünde protein kaynağı ekleyebilirsin.`,
                'Protein geride görünüyor. Yoğurt, yumurta, tavuk veya bakliyat iyi seçenekler olabilir.'
            ]));
        }
    }

    // Makro dengesi yorumu
    if (totals.kcal > 0) {
        const macroKcal = {
            protein: totals.protein * 4,
            carb: totals.carb * 4,
            fat: totals.fat * 9
        };
        const macroTotal = macroKcal.protein + macroKcal.carb + macroKcal.fat;
        if (macroTotal > 0) {
            const pPct = Math.round((macroKcal.protein / macroTotal) * 100);
            const cPct = Math.round((macroKcal.carb / macroTotal) * 100);
            const fPct = Math.round((macroKcal.fat / macroTotal) * 100);

            if (fPct > 45) {
                messages.push(`Makro dağılımında yağ yüksek (Protein %${pPct}, Karbonhidrat %${cPct}, Yağ %${fPct}). Bir sonraki öğünü daha dengeli kurabilirsin.`);
            } else if (pPct < 20 && totals.kcal > TARGETS.kcal * 0.5) {
                messages.push(`Makro dağılımında protein oranı düşük (Protein %${pPct}, Karbonhidrat %${cPct}, Yağ %${fPct}). Protein kaynağı eklemek iyi olur.`);
            } else {
                messages.push(`Makro dengesi iyi gidiyor (Protein %${pPct}, Karbonhidrat %${cPct}, Yağ %${fPct}).`);
            }
        }
    }

    // Haftalik trend
    if (loggedDays >= 3) {
        const avgDiff = weekAvg - TARGETS.kcal;
        if (Math.abs(avgDiff) < 100) {
            messages.push('Haftalık ortalaman hedefinle uyumlu.');
        } else if (avgDiff > 200) {
            messages.push('Haftalık ortalaman hedefinin biraz üzerinde.');
        } else if (avgDiff < -200) {
            messages.push('Haftalık ortalaman hedefinin altında.');
        }
    } else {
        messages.push('Haftalık değerlendirme için birkaç gün daha kayıt gerekiyor.');
    }

    // Seri tebrik
    if (streak >= 7) {
        messages.push(`${streak} gündür hedef aralığını koruyorsun.`);
    } else if (streak >= 3) {
        messages.push(`${streak} günlük bir seri oluşturdun.`);
    }

    // Yeni kullanici
    if (loggedDays <= 1 && todayLogs.length > 0 && todayLogs.length <= 2) {
        messages.push('İlk kayıtlar tamam. Düzenli devam ettikçe tablo daha anlamlı olacak.');
    }

    if (todayLogs.length > 0) {
        messages.push(pickOne(pepTalkPool));
    }

    const uniqueMessages = [...new Set(messages.filter(Boolean))];
    const compact = [];
    if (uniqueMessages[0]) compact.push(uniqueMessages[0]);
    if (uniqueMessages.length > 1) {
        compact.push(uniqueMessages[1 + Math.floor(Math.random() * (uniqueMessages.length - 1))]);
    }
    if (uniqueMessages.length > 2 && (streak >= 3 || Math.random() > 0.5)) {
        const pool = uniqueMessages.slice(1).filter(msg => !compact.includes(msg));
        if (pool.length > 0) compact.push(pool[Math.floor(Math.random() * pool.length)]);
    }

    motivationEl.textContent = compact
        .join(' ')
        .replace(/\p{Extended_Pictographic}|\uFE0F/gu, '')
        .replace(/\s+/g, ' ')
        .trim();
}
// Search and Add Functions
const RECENT_ITEMS_KEY = 'recentItemsV2';
const FAVORITES_KEY = 'favoriteItems';
const MAX_RESULTS = 30;
const MAX_RECENTS = 5;
let currentDropdownItems = [];
let currentDropdownIndex = -1;
let portionMemory = loadPortionMemory();
let pendingLogItems = [];

function loadPortionMemory() {
    try {
        return normalizePortionMemory(JSON.parse(localStorage.getItem(PORTION_MEMORY_KEY)));
    } catch {
        return {};
    }
}

function savePortionUsage(item, itemType, amount, unit) {
    portionMemory = recordPortionUsage(
        portionMemory,
        item.id,
        itemType,
        amount,
        unit
    );
    localStorage.setItem(PORTION_MEMORY_KEY, JSON.stringify(portionMemory));
}

function getItemsByType(itemType) {
    return itemType === 'food' ? foods : drinks;
}

function getDisplayItemName(item, itemType) {
    const source = getItemsByType(itemType);
    const normalized = String(item?.name || '').trim().toLocaleLowerCase('tr-TR');
    const duplicateCount = source.filter(candidate =>
        String(candidate.name || '').trim().toLocaleLowerCase('tr-TR') === normalized
    ).length;

    if (duplicateCount <= 1) return item.name;
    const unit = itemType === 'drink' ? '100 ml' : '100 g';
    return `${item.name} · ${item.kcal_100} kcal/${unit}`;
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

function getHeartIconMarkup() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z"/></svg>';
}

function getProductCardContent(item, itemType, options = {}) {
    const {
        nameHtml = escapeHtml(getDisplayItemName(item, itemType)),
        includeFavorite = false,
        includeDelete = false
    } = options;
    const unit = itemType === 'drink' ? '100 ml' : '100 g';
    const initial = String(item.name || '?').trim().charAt(0).toLocaleUpperCase('tr-TR');
    const isFavorite = includeFavorite && isFavoriteItem(item.id, itemType);
    const confidence = inferNutritionConfidence(item);
    const confidenceBadge = confidence === 'verified'
        ? ''
        : `<span class="nutrition-confidence-badge" data-confidence="${confidence}">${getNutritionConfidenceLabel(confidence)}</span>`;
    const actions = [];

    if (includeFavorite) {
        actions.push(`
            <button class="catalog-favorite${isFavorite ? ' active' : ''}" type="button"
                aria-label="${isFavorite ? 'Favorilerden çıkar' : 'Favorilere ekle'}"
                aria-pressed="${isFavorite}">
                ${getHeartIconMarkup()}
            </button>
        `);
    }
    if (includeDelete) {
        actions.push(`<button class="dropdown-delete" type="button" data-item-id="${escapeHtml(item.id)}" title="Sil">Sil</button>`);
    }

    return `
        <div class="catalog-item-symbol" aria-hidden="true">${escapeHtml(initial)}</div>
        <div class="catalog-item-main">
            <div class="catalog-item-topline">
                <div>
                    <div class="catalog-item-name">${nameHtml}</div>
                    <div class="catalog-item-type">${itemType === 'food' ? 'Yiyecek' : 'İçecek'} · ${unit} ${confidenceBadge}</div>
                </div>
                ${actions.length ? `<div class="catalog-card-actions">${actions.join('')}</div>` : ''}
            </div>
            <div class="catalog-nutrition">
                <div class="catalog-energy"><strong>${item.kcal_100}</strong><span>kcal</span></div>
                <div class="catalog-macro"><span>Protein</span><strong>${item.protein_100} g</strong></div>
                <div class="catalog-macro"><span>Karbonhidrat</span><strong>${item.carb_100} g</strong></div>
                <div class="catalog-macro"><span>Yağ</span><strong>${item.fat_100} g</strong></div>
            </div>
        </div>
    `;
}

function fitDropdownAboveMobileNavigation(dropdown) {
    if (!dropdown) return;

    window.requestAnimationFrame(() => {
        if (!dropdown.classList.contains('active')) return;
        if (!window.matchMedia('(max-width: 760px)').matches) {
            dropdown.style.removeProperty('max-height');
            return;
        }

        const navigation = document.querySelector('.tabs-container');
        const dropdownTop = dropdown.getBoundingClientRect().top;
        const visualViewportBottom = window.visualViewport
            ? window.visualViewport.offsetTop + window.visualViewport.height
            : window.innerHeight;
        const navigationTop = navigation?.getBoundingClientRect().top ?? visualViewportBottom;
        const availableHeight = Math.floor(
            Math.min(navigationTop, visualViewportBottom) - dropdownTop - 12
        );

        dropdown.style.maxHeight = `${Math.max(120, availableHeight)}px`;
    });
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

function loadFavoriteItems() {
    try {
        const stored = JSON.parse(localStorage.getItem(FAVORITES_KEY));
        return Array.isArray(stored) ? stored : [];
    } catch {
        return [];
    }
}

function isFavoriteItem(itemId, itemType) {
    return loadFavoriteItems().some(entry => entry.id === itemId && entry.type === itemType);
}

function toggleFavoriteItem(itemId, itemType) {
    const current = loadFavoriteItems();
    const exists = current.some(entry => entry.id === itemId && entry.type === itemType);
    const next = exists
        ? current.filter(entry => entry.id !== itemId || entry.type !== itemType)
        : [{ id: itemId, type: itemType }, ...current];
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
    return !exists;
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

function getFavoriteItemsByType(itemType) {
    const items = getItemsByType(itemType);
    return loadFavoriteItems()
        .filter(entry => entry.type === itemType)
        .map(entry => items.find(item => item.id === entry.id))
        .filter(Boolean);
}

function getFrequentItemsByType(itemType) {
    const items = getItemsByType(itemType);
    return getFrequentItemKeys(portionMemory, itemType, 6)
        .map(itemId => items.find(item => item.id === itemId))
        .filter(Boolean);
}

function getSuggestedItemsByType(itemType) {
    const favorites = getFavoriteItemsByType(itemType);
    const frequentItems = getFrequentItemsByType(itemType);
    const recents = getRecentItemsByType(itemType);
    const availableItems = getItemsByType(itemType);
    const seenIds = new Set();

    return [...favorites, ...frequentItems, ...recents, ...availableItems].filter(item => {
        if (seenIds.has(item.id)) return false;
        seenIds.add(item.id);
        return true;
    }).slice(0, 10);
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
    searchInput.value = getDisplayItemName(item, itemType);
    dropdown.classList.remove('active');
    addRecentItem(item, itemType);
    configurePortionControls(item, itemType);
    renderPortionPresets(item, itemType);
    updatePreview();
    gramsInput.focus();
    gramsInput.select();
}

function configurePortionControls(item, itemType, useRemembered = true) {
    const unitSelect = document.getElementById('portionUnit');
    const amountInput = document.getElementById('gramsInput');
    const amountLabel = document.getElementById('amountLabel');
    if (!unitSelect || !amountInput) return;

    const resolvedType = itemType === 'drink' ? 'drink' : 'food';
    const options = getUnitOptions(item, resolvedType);
    unitSelect.innerHTML = renderSelectOptions(options);

    const remembered = useRemembered
        ? getRememberedPortion(portionMemory, item?.id, resolvedType)
        : null;
    const rememberedOption = remembered
        ? options.find(option => option.value === remembered.unit)
        : null;
    const defaultOption = options[0];
    unitSelect.value = rememberedOption?.value || defaultOption.value;
    if (remembered) {
        amountInput.value = remembered.amount;
    } else if (!amountInput.value) {
        amountInput.value = resolvedType === 'drink' ? 200 : 100;
    }
    if (amountLabel) amountLabel.textContent = 'Miktar';
}

function getCurrentPortion(item, itemType) {
    const displayAmount = Number(document.getElementById('gramsInput')?.value);
    const unit = document.getElementById('portionUnit')?.value || (itemType === 'drink' ? 'ml' : 'g');
    return {
        displayAmount,
        unit,
        baseAmount: convertToBaseAmount(displayAmount, unit, item, itemType)
    };
}

function getPortionPresets(item, itemType) {
    const name = String(item?.name || '').toLocaleLowerCase('tr-TR');
    const presets = itemType === 'drink'
        ? [
            { label: '1 bardak', amount: 1, unit: 'glass' },
            { label: '1 kupa', amount: 1, unit: 'cup' },
            { label: '330 ml', amount: 330, unit: 'ml' }
        ]
        : [
            { label: '1 porsiyon', amount: 1, unit: 'portion' },
            { label: '100 g', amount: 100, unit: 'g' },
            { label: '150 g', amount: 150, unit: 'g' }
        ];

    if (name.includes('yumurta')) presets.unshift({ label: '1 adet', amount: 1, unit: 'piece' });
    if (name.includes('ekmek')) presets.unshift({ label: '1 dilim', amount: 1, unit: 'slice' });
    if (name.includes('whey') || name.includes('protein tozu')) {
        presets.unshift({ label: '25 g', amount: 25, unit: 'g' });
    }
    if (name.includes('çorba')) presets.unshift({ label: '1 porsiyon', amount: 1, unit: 'portion' });

    return presets;
}

function renderPortionPresets(item, itemType) {
    const wrapper = document.getElementById('portionPresets');
    const container = document.getElementById('portionPresetButtons');
    if (!item || !wrapper || !container) {
        if (wrapper) wrapper.style.display = 'none';
        return;
    }

    const presets = getPortionPresets(item, itemType);
    container.innerHTML = presets.map((preset, index) => `
        <button class="portion-preset-btn" type="button" data-index="${index}">
            ${escapeHtml(preset.label)}
        </button>
    `).join('');
    wrapper.style.display = 'flex';

    container.querySelectorAll('.portion-preset-btn').forEach(button => {
        button.addEventListener('click', () => {
            const preset = presets[Number(button.dataset.index)];
            if (!preset) return;
            document.getElementById('gramsInput').value = preset.amount;
            document.getElementById('portionUnit').value = preset.unit;
            updatePreview();
        });
    });
}

function clearSelectedAddItem() {
    selectedItem = null;
    document.getElementById('searchInput').value = '';
    document.getElementById('gramsInput').value = '';
    document.getElementById('calculationPreview').style.display = 'none';
    document.getElementById('portionPresets').style.display = 'none';
}

function renderPendingLogItems() {
    const panel = document.getElementById('addQueuePanel');
    const list = document.getElementById('addQueueList');
    const count = document.getElementById('addQueueCount');
    const total = document.getElementById('addQueueTotal');
    if (!panel || !list || !count || !total) return;

    panel.hidden = pendingLogItems.length === 0;
    count.textContent = `${pendingLogItems.length} besin`;
    const totals = pendingLogItems.reduce((sum, entry) => {
        const nutrition = calculateLogNutrition(entry.item, entry.grams);
        return {
            kcal: sum.kcal + nutrition.kcal,
            protein: sum.protein + nutrition.protein,
            carb: sum.carb + nutrition.carb,
            fat: sum.fat + nutrition.fat
        };
    }, { kcal: 0, protein: 0, carb: 0, fat: 0 });
    total.textContent = `${Math.round(totals.kcal)} kcal · P ${Math.round(totals.protein)}g · K ${Math.round(totals.carb)}g · Y ${Math.round(totals.fat)}g`;
    list.innerHTML = pendingLogItems.map((entry, index) => `
        <div class="add-queue-item">
            <div>
                <strong>${escapeHtml(entry.item.name)}</strong>
                <span>${entry.displayAmount} ${escapeHtml(entry.unitLabel)} · ${MEAL_LABELS[entry.meal_type]}</span>
            </div>
            <button class="queue-delete-btn" type="button" data-index="${index}" aria-label="${escapeHtml(entry.item.name)} besinini listeden sil" title="Listeden sil">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/></svg>
            </button>
        </div>
    `).join('');
    list.querySelectorAll('button[data-index]').forEach(button => {
        button.addEventListener('click', () => {
            pendingLogItems.splice(Number(button.dataset.index), 1);
            renderPendingLogItems();
        });
    });
}

function queueSelectedLogItem() {
    const itemType = document.querySelector('input[name="itemType"]:checked')?.value;
    if (!selectedItem || itemType === 'custom') {
        showError('Listeye eklemek için önce katalogdan bir besin seç.');
        return;
    }
    const portion = getCurrentPortion(selectedItem, itemType);
    if (!portion.baseAmount) {
        showError('Geçerli bir miktar gir.');
        return;
    }
    const unitOption = getUnitOptions(selectedItem, itemType)
        .find(option => option.value === portion.unit);
    pendingLogItems.push({
        item: selectedItem,
        item_id: selectedItem.id,
        type: itemType,
        grams: portion.baseAmount,
        displayAmount: portion.displayAmount,
        display_unit: portion.unit,
        unitLabel: unitOption?.shortLabel || portion.unit,
        meal_type: document.getElementById('mealType')?.value || 'snack'
    });
    clearSelectedAddItem();
    renderPendingLogItems();
}

function renderDropdown(items, options = {}) {
    const dropdown = document.getElementById('dropdown');
    const { searchTerm = '', showHeader = false } = options;

    currentDropdownItems = items;
    currentDropdownIndex = -1;

    if (items.length === 0) {
        const emptyText = showHeader ? 'Bu tür için henüz bir besin önerisi yok.' : 'Aramana uygun besin bulunamadı.';
        dropdown.innerHTML = showHeader
            ? `<div class="dropdown-header"><span class="dropdown-header-icon">${getHeartIconMarkup()}</span>Favorilerin ve öneriler</div><div class="dropdown-empty">${emptyText}</div>`
            : `<div class="dropdown-item">${emptyText}</div>`;
        dropdown.classList.add('active');
        fitDropdownAboveMobileNavigation(dropdown);
        return;
    }

    const itemType = document.querySelector('input[name="itemType"]:checked').value;
    const header = showHeader
        ? `<div class="dropdown-header"><span class="dropdown-header-icon">${getHeartIconMarkup()}</span>Favorilerin ve öneriler</div>`
        : '';
    dropdown.innerHTML = header + items.map((item, index) => `
        <div class="dropdown-item dropdown-product-card catalog-item${index === currentDropdownIndex ? ' active' : ''}" data-index="${index}">
            ${getProductCardContent(item, itemType, {
                nameHtml: highlightMatch(getDisplayItemName(item, itemType), searchTerm),
                includeFavorite: true,
                includeDelete: item.id.startsWith('custom_')
            })}
        </div>
    `).join('');

    dropdown.classList.add('active');
    fitDropdownAboveMobileNavigation(dropdown);

    // Add click event listeners
    dropdown.querySelectorAll('.dropdown-item[data-index]').forEach(item => {
        item.addEventListener('click', (e) => {
            if (e.target.closest('.dropdown-delete, .catalog-favorite')) return;

            const index = parseInt(item.dataset.index, 10);
            const selected = Number.isNaN(index) ? null : currentDropdownItems[index];
            const itemType = document.querySelector('input[name="itemType"]:checked').value;

            if (selected) {
                selectItem(selected, itemType);
            }
        });
    });

    dropdown.querySelectorAll('.catalog-favorite').forEach((button) => {
        button.addEventListener('click', (event) => {
            event.stopPropagation();
            const card = button.closest('.dropdown-item[data-index]');
            const index = Number(card?.dataset.index);
            const item = currentDropdownItems[index];
            if (!item) return;
            toggleFavoriteItem(item.id, itemType);
            renderDropdown(currentDropdownItems, { showHeader, searchTerm });
        });
    });

    // Add delete event listeners for custom items
    dropdown.querySelectorAll('.dropdown-delete').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const itemId = btn.dataset.itemId;
            const item = currentDropdownItems.find(i => i.id === itemId);

            if (!item) return;

            const approved = await requestConfirmation({
                title: 'Besini sil',
                message: `"${item.name}" besini katalogdan kalıcı olarak silinsin mi?`,
                confirmLabel: 'Besini sil',
                danger: true
            });
            if (approved) {
                await deleteCustomItem(itemId);
            }
        });
    });
}

function updatePreview() {
    const preview = document.getElementById('calculationPreview');
    const itemType = document.querySelector('input[name="itemType"]:checked')?.value;
    const portion = selectedItem ? getCurrentPortion(selectedItem, itemType) : null;

    if (!selectedItem || !portion?.baseAmount) {
        preview.style.display = 'none';
        return;
    }

    const { kcal, protein, carb, fat } = calculateLogNutrition(selectedItem, portion.baseAmount);

    document.getElementById('previewKcal').textContent = `${kcal} kcal`;
    document.getElementById('previewProtein').textContent = `${protein}g`;
    document.getElementById('previewCarb').textContent = `${carb}g`;
    document.getElementById('previewFat').textContent = `${fat}g`;
    const confidence = inferNutritionConfidence(selectedItem);
    const confidenceNote = document.getElementById('nutritionConfidenceNote');
    if (confidenceNote) {
        confidenceNote.dataset.confidence = confidence;
        confidenceNote.textContent = confidence === 'estimated'
            ? 'Standart içeriğe göre tahmini hesap. Daha net sonuç için malzemelerinle bir tarif oluştur.'
            : confidence === 'personal'
                ? 'Kendi kaydettiğin değerlere göre hesaplandı.'
                : 'Ürün veya temel besin değerine göre hesaplandı.';
    }

    preview.style.display = 'block';
}

function openDropdownForInput(searchTerm, itemType) {
    if (!searchTerm) {
        renderDropdown(getSuggestedItemsByType(itemType), { showHeader: true });
        return;
    }

    const filtered = filterItems(searchTerm, itemType);
    renderDropdown(filtered, { searchTerm });
}

// --- Product Catalog ---
let catalogCategory = 'all';
let catalogSearchTerm = '';

function getCatalogItems() {
    let items = [];
    if (catalogCategory === 'all' || catalogCategory === 'favorite' || catalogCategory === 'food') {
        items = items.concat(foods.map(f => ({ ...f, _type: 'food' })));
    }
    if (catalogCategory === 'all' || catalogCategory === 'favorite' || catalogCategory === 'drink') {
        items = items.concat(drinks.map(d => ({ ...d, _type: 'drink' })));
    }
    if (catalogCategory === 'favorite') {
        items = items.filter(item => isFavoriteItem(item.id, item._type));
    }
    if (catalogSearchTerm) {
        const term = catalogSearchTerm.toLowerCase();
        items = items.filter(item => item.name.toLowerCase().includes(term));
    }
    items.sort((a, b) => a.name.localeCompare(b.name, 'tr'));
    return items;
}

function renderCatalog() {
    const items = getCatalogItems();
    const listEl = document.getElementById('catalogList');
    const countEl = document.getElementById('catalogCount');

    countEl.textContent = `${items.length} besin`;

    if (items.length === 0) {
        listEl.innerHTML = '<div class="catalog-empty">Aramana uygun bir besin bulunamadı.</div>';
        return;
    }

    listEl.innerHTML = items.map(item => {
        return `
        <div class="catalog-item" data-item-id="${item.id}" data-item-type="${item._type}" role="button" tabindex="0">
            ${getProductCardContent(item, item._type, { includeFavorite: true })}
        </div>
    `;
    }).join('');

    listEl.querySelectorAll('.catalog-item').forEach((el) => {
        el.querySelector('.catalog-favorite')?.addEventListener('click', (event) => {
            event.stopPropagation();
            toggleFavoriteItem(el.dataset.itemId, el.dataset.itemType);
            renderCatalog();
        });

        el.addEventListener('click', () => {
            const itemId = el.dataset.itemId;
            const itemType = el.dataset.itemType === 'drink' ? 'drink' : 'food';
            const source = itemType === 'food' ? foods : drinks;
            const item = source.find((i) => i.id === itemId);
            if (!item) return;

            if (typeof window.switchTab === 'function') {
                window.switchTab('add');
            }

            const targetRadio = document.querySelector(`input[name="itemType"][value="${itemType}"]`);
            if (targetRadio && !targetRadio.checked) {
                targetRadio.checked = true;
                targetRadio.dispatchEvent(new Event('change', { bubbles: true }));
            }

            selectItem(item, itemType);
        });

        el.addEventListener('keydown', (event) => {
            if (event.target.closest('.catalog-favorite')) return;
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            el.click();
        });
    });
}

// --- Meal Templates ---
const TEMPLATES_KEY = 'mealTemplates';
const TEMPLATES_SYNC_META_KEY = 'mealTemplatesSyncMeta';
let templateCache = [];
let currentTemplateItems = [];
let tplSelectedItem = null;
let tplDropdownItems = [];

function normalizeTemplate(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const name = String(raw.name || '').trim();
    const id = String(raw.id || '').trim();
    if (!name || name.length > 100 || !isSafeRecordId(id) || !Array.isArray(raw.items)) return null;

    const items = raw.items
        .slice(0, 400)
        .map((entry) => ({
            item_id: String(entry?.item_id || '').trim(),
            item_name: String(entry?.item_name || '').trim(),
            grams: Number(entry?.grams),
            type: entry?.type === 'drink' ? 'drink' : 'food'
        }))
        .filter((entry) =>
            isSafeRecordId(entry.item_id)
            && entry.item_name
            && entry.item_name.length <= 250
            && Number.isFinite(entry.grams)
            && entry.grams > 0
            && entry.grams <= 100000
        );

    if (items.length === 0) return null;

    const kind = raw.kind === 'recipe' ? 'recipe' : 'meal';
    const servings = kind === 'recipe'
        ? Math.min(100, Math.max(1, Math.round(Number(raw.servings) || 1)))
        : 1;
    const fallbackYield = items.reduce((sum, item) => sum + Number(item.grams || 0), 0);
    const yieldAmount = kind === 'recipe'
        ? Math.min(100000, Math.max(1, Number(raw.yieldAmount) || fallbackYield || servings))
        : 0;
    const yieldUnit = raw.yieldUnit === 'ml' ? 'ml' : 'g';
    const nutritionConfidence = raw.nutritionConfidence === 'estimated' ? 'estimated' : 'personal';
    return { id, name, kind, servings, yieldAmount, yieldUnit, nutritionConfidence, items };
}

function normalizeTemplates(rawTemplates) {
    if (!Array.isArray(rawTemplates)) return [];

    const normalized = [];
    const seen = new Set();
    rawTemplates.slice(0, 200).forEach((tpl) => {
        const parsed = normalizeTemplate(tpl);
        if (!parsed || seen.has(parsed.id)) return;
        seen.add(parsed.id);
        normalized.push(parsed);
    });
    return normalized;
}

function loadTemplatesFromLocal() {
    try {
        const stored = JSON.parse(localStorage.getItem(TEMPLATES_KEY));
        return normalizeTemplates(stored);
    } catch { return []; }
}

function getLocalTemplatesUpdatedAtMs() {
    try {
        const meta = JSON.parse(localStorage.getItem(TEMPLATES_SYNC_META_KEY)) || {};
        const updatedAtMs = Number(meta.updatedAtMs);
        return Number.isFinite(updatedAtMs) && updatedAtMs > 0 ? updatedAtMs : 0;
    } catch {
        return 0;
    }
}

function setLocalTemplatesUpdatedAtMs(updatedAtMs = Date.now()) {
    const safeMs = Number(updatedAtMs);
    const finalMs = Number.isFinite(safeMs) && safeMs > 0 ? safeMs : Date.now();
    localStorage.setItem(TEMPLATES_SYNC_META_KEY, JSON.stringify({ updatedAtMs: finalMs }));
    return finalMs;
}

function saveTemplatesToLocal(templates) {
    localStorage.setItem(TEMPLATES_KEY, JSON.stringify(normalizeTemplates(templates)));
}

async function loadTemplatesFromCloud() {
    if (!db) return { templates: [], updatedAtMs: 0 };

    try {
        const templateRef = doc(db, SETTINGS_COLLECTION, TEMPLATES_SETTINGS_DOC_ID);
        const snap = await getDoc(templateRef);
        if (!snap.exists()) return { templates: [], updatedAtMs: 0 };
        const data = snap.data() || {};
        const fromField = Number(data.updated_at_ms);
        const fromTimestamp = data.updated_at && typeof data.updated_at.toMillis === 'function'
            ? data.updated_at.toMillis()
            : 0;
        const updatedAtMs = Number.isFinite(fromField) && fromField > 0 ? fromField : fromTimestamp;
        return {
            templates: normalizeTemplates(data.templates),
            updatedAtMs: Number.isFinite(updatedAtMs) && updatedAtMs > 0 ? updatedAtMs : 0
        };
    } catch (error) {
        console.warn('Cloud templates could not be loaded:', error);
        return { templates: [], updatedAtMs: 0 };
    }
}

async function saveTemplatesToCloud(templates, updatedAtMs = Date.now()) {
    if (!db) return false;

    try {
        const safeUpdatedAtMs = Number.isFinite(Number(updatedAtMs)) && Number(updatedAtMs) > 0
            ? Number(updatedAtMs)
            : Date.now();
        const templateRef = doc(db, SETTINGS_COLLECTION, TEMPLATES_SETTINGS_DOC_ID);
        await setDoc(templateRef, {
            templates: normalizeTemplates(templates),
            updated_at_ms: safeUpdatedAtMs,
            updated_at: serverTimestamp()
        }, { merge: true });
        return true;
    } catch (error) {
        console.warn('Cloud templates could not be saved:', error);
        return false;
    }
}

async function initializeTemplates() {
    const localTemplates = loadTemplatesFromLocal();
    const localUpdatedAtMs = getLocalTemplatesUpdatedAtMs();
    templateCache = localTemplates;

    const cloudData = await loadTemplatesFromCloud();
    const cloudTemplates = cloudData.templates;
    const cloudUpdatedAtMs = cloudData.updatedAtMs;

    if (cloudTemplates.length === 0) {
        if (localTemplates.length > 0) {
            const syncMs = localUpdatedAtMs || Date.now();
            setLocalTemplatesUpdatedAtMs(syncMs);
            await saveTemplatesToCloud(localTemplates, syncMs);
        }
        return;
    }

    if (localTemplates.length === 0) {
        templateCache = cloudTemplates;
        saveTemplatesToLocal(templateCache);
        setLocalTemplatesUpdatedAtMs(cloudUpdatedAtMs || Date.now());
        return;
    }

    if (localUpdatedAtMs > 0 && cloudUpdatedAtMs > 0 && localUpdatedAtMs !== cloudUpdatedAtMs) {
        if (localUpdatedAtMs > cloudUpdatedAtMs) {
            templateCache = localTemplates;
            saveTemplatesToLocal(templateCache);
            await saveTemplatesToCloud(templateCache, localUpdatedAtMs);
        } else {
            templateCache = cloudTemplates;
            saveTemplatesToLocal(templateCache);
            setLocalTemplatesUpdatedAtMs(cloudUpdatedAtMs);
        }
        return;
    }

    const mergedById = new Map();
    cloudTemplates.forEach((tpl) => mergedById.set(tpl.id, tpl));
    localTemplates.forEach((tpl) => {
        if (!mergedById.has(tpl.id)) mergedById.set(tpl.id, tpl);
    });

    templateCache = [...mergedById.values()];
    saveTemplatesToLocal(templateCache);
    const mergedSyncMs = Math.max(localUpdatedAtMs, cloudUpdatedAtMs, Date.now());
    setLocalTemplatesUpdatedAtMs(mergedSyncMs);
    await saveTemplatesToCloud(templateCache, mergedSyncMs);
}

function loadTemplates() {
    return [...templateCache];
}

function saveTemplates(templates) {
    templateCache = normalizeTemplates(templates);
    saveTemplatesToLocal(templateCache);
    return setLocalTemplatesUpdatedAtMs(Date.now());
}

function getTemplateIngredientNutrition(template) {
    return (template?.items || []).map(entry => {
        const source = entry.type === 'food' ? foods : drinks;
        const item = source.find(candidate => candidate.id === entry.item_id);
        return item ? calculateLogNutrition(item, entry.grams) : null;
    }).filter(Boolean);
}

function getTemplateNutritionTotals(template) {
    return sumNutrition(getTemplateIngredientNutrition(template));
}

function getRecipeDefaultAmount(template) {
    const yieldAmount = Number(template?.yieldAmount) || 0;
    const servings = Math.max(1, Number(template?.servings) || 1);
    return Math.round((yieldAmount / servings) * 10) / 10;
}

async function addRecipeLog(template, consumedAmount, logDate = getToday()) {
    const amount = Number(consumedAmount);
    const yieldAmount = Number(template?.yieldAmount);
    if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(yieldAmount) || yieldAmount <= 0) {
        throw new Error('Tarif miktarı geçersiz.');
    }

    const nutrition = calculateRecipeNutrition(
        getTemplateIngredientNutrition(template),
        yieldAmount,
        amount
    );
    const unit = template.yieldUnit === 'ml' ? 'ml' : 'g';
    const mealType = document.getElementById('mealType')?.value || 'snack';
    await addDoc(collection(db, 'daily_logs'), {
        date: logDate,
        item_id: template.id,
        item_name: template.name,
        grams: amount,
        item_type: unit === 'ml' ? 'drink' : 'food',
        unit,
        display_amount: amount,
        display_unit: unit,
        meal_type: MEAL_LABELS[mealType] ? mealType : 'snack',
        recipe_yield: yieldAmount,
        recipe_servings: template.servings,
        nutrition_confidence: template.nutritionConfidence,
        schema_version: APP_SCHEMA_VERSION,
        ...nutrition,
        created_at: serverTimestamp()
    });
}

async function addLogBatch(items, logDate = getToday()) {
    if (!Array.isArray(items) || items.length === 0) return;
    if (items.length > 400) {
        throw new Error('Bir kayıtlı öğünde en fazla 400 besin bulunabilir.');
    }

    const batch = writeBatch(db);
    let addedCount = 0;
    for (const entry of items) {
        const source = entry.type === 'food' ? foods : drinks;
        const item = source.find(s => s.id === entry.item_id);
        if (!item) continue;

        const nutrition = calculateLogNutrition(item, entry.grams);
        const itemType = entry.type === 'drink' ? 'drink' : 'food';
        const logData = {
            date: logDate,
            item_id: item.id,
            item_name: item.name,
            grams: entry.grams,
            item_type: itemType,
            unit: itemType === 'drink' ? 'ml' : 'g',
            display_amount: Number(entry.displayAmount) || entry.grams,
            display_unit: entry.display_unit || (itemType === 'drink' ? 'ml' : 'g'),
            meal_type: MEAL_LABELS[entry.meal_type] ? entry.meal_type : (document.getElementById('mealType')?.value || 'snack'),
            nutrition_confidence: inferNutritionConfidence(item),
            schema_version: APP_SCHEMA_VERSION,
            ...nutrition,
            created_at: serverTimestamp()
        };
        batch.set(doc(collection(db, 'daily_logs')), logData);
        addedCount += 1;
    }

    if (addedCount > 0) {
        await batch.commit();
    }
}
function renderTemplateList() {
    const templates = loadTemplates();
    const listEl = document.getElementById('templatesList');

    if (templates.length === 0) {
        listEl.innerHTML = '<div class="template-empty">Henüz kayıtlı öğünün yok. Sık tükettiğin bir öğünü kaydederek başla.</div>';
        return;
    }

    listEl.innerHTML = templates.map(tpl => {
        const totals = getTemplateNutritionTotals(tpl);
        const defaultAmount = tpl.kind === 'recipe' ? getRecipeDefaultAmount(tpl) : 0;
        const displayNutrition = tpl.kind === 'recipe'
            ? calculateRecipeNutrition([totals], tpl.yieldAmount, defaultAmount)
            : totals;
        const kindLabel = tpl.kind === 'recipe'
            ? `Tarif · ${tpl.yieldAmount} ${tpl.yieldUnit} · ${tpl.servings} porsiyon`
            : 'Kayıtlı öğün';
        const confidenceLabel = tpl.kind === 'recipe'
            ? getNutritionConfidenceLabel(tpl.nutritionConfidence)
            : '';
        const applyControl = tpl.kind === 'recipe'
            ? `
                <label class="template-portion-control">
                    <span>Yediğin miktar</span>
                    <span><input type="number" min="1" max="${tpl.yieldAmount}" step="1" value="${defaultAmount}" data-recipe-amount> ${tpl.yieldUnit}</span>
                </label>
                <button class="btn btn-primary btn-sm template-apply" data-id="${tpl.id}">Günlüğe ekle</button>
            `
            : `<button class="btn btn-primary btn-sm template-apply" data-id="${tpl.id}">Uygula</button>`;

        return `
            <div class="template-card" data-id="${tpl.id}">
                <div class="template-card-header">
                    <div>
                        <div class="template-card-name">${escapeHtml(tpl.name)}</div>
                        <div class="template-card-info">${kindLabel} · ${tpl.items.length} malzeme${confidenceLabel ? ` · ${confidenceLabel}` : ''}</div>
                        <div class="template-card-nutrition">
                            <strong>${Math.round(displayNutrition.kcal)} kcal</strong>
                            <span>P ${Math.round(displayNutrition.protein)}g</span>
                            <span>K ${Math.round(displayNutrition.carb)}g</span>
                            <span>Y ${Math.round(displayNutrition.fat)}g</span>
                        </div>
                    </div>
                    <div class="template-card-actions">
                        ${applyControl}
                        <button class="btn btn-secondary btn-sm template-delete" data-id="${tpl.id}">Sil</button>
                    </div>
                </div>
                <div class="template-card-items">
                    ${tpl.items.map(ti => `<span class="template-item-pill">${escapeHtml(ti.item_name)} (${ti.grams}${ti.type === 'drink' ? 'ml' : 'g'})</span>`).join('')}
                </div>
            </div>
        `;
    }).join('');

    listEl.querySelectorAll('.template-apply').forEach(btn => {
        btn.addEventListener('click', () => {
            const card = btn.closest('.template-card');
            const amount = Number(card?.querySelector('[data-recipe-amount]')?.value);
            applyTemplate(btn.dataset.id, amount);
        });
    });
    listEl.querySelectorAll('.template-delete').forEach(btn => {
        btn.addEventListener('click', async () => {
            const approved = await requestConfirmation({
                title: 'Kayıtlı öğünü sil',
                message: 'Bu öğün veya tarif kalıcı olarak silinsin mi?',
                confirmLabel: 'Kaydı sil',
                danger: true
            });
            if (approved) {
                await deleteTemplate(btn.dataset.id);
            }
        });
    });
}

async function applyTemplate(templateId, recipeAmount = 0) {
    const templates = loadTemplates();
    const tpl = templates.find(t => t.id === templateId);
    if (!tpl) return;
    const logDate = getSelectedLogDate();
    // Batch: tum loglari ekle, sonra tek seferde yenile
    try {
        if (tpl.kind === 'recipe') {
            const amount = Number(recipeAmount) > 0 ? Number(recipeAmount) : getRecipeDefaultAmount(tpl);
            if (amount > tpl.yieldAmount) {
                showError(`Tarifin toplamı ${tpl.yieldAmount} ${tpl.yieldUnit}. Daha düşük bir miktar gir.`);
                return;
            }
            await addRecipeLog(tpl, amount, logDate);
        } else {
            await addLogBatch(tpl.items, logDate);
        }
    } catch (error) {
        console.error('Template could not be applied:', error);
        showError('Kayıtlı öğün günlüğe eklenemedi; hiçbir değişiklik yapılmadı.');
        return;
    }

    await refreshDailyLogViews();
    if (typeof window.switchTab === 'function') {
        window.switchTab('logs');
    }
}

async function deleteTemplate(templateId) {
    const templates = loadTemplates().filter(t => t.id !== templateId);
    const updatedAtMs = saveTemplates(templates);
    renderTemplateList();

    const cloudSaved = await saveTemplatesToCloud(templates, updatedAtMs);
    if (!cloudSaved) {
        showError('Sablon Firebase\'e kaydedilemedi. Firestore kurallarini kontrol edin.');
    }
}

function showTemplateForm() {
    document.getElementById('templateListView').style.display = 'none';
    document.getElementById('templateFormView').style.display = 'block';
    document.getElementById('templateName').value = '';
    document.getElementById('templateKind').value = 'meal';
    document.getElementById('templateServings').value = '1';
    document.getElementById('templateYield').value = '';
    document.getElementById('templateYieldUnit').value = 'g';
    document.getElementById('templateConfidence').value = 'personal';
    document.getElementById('recipeSettings').hidden = true;
    currentTemplateItems = [];
    tplSelectedItem = null;
    renderTemplateFormItems();
}

function hideTemplateForm() {
    document.getElementById('templateFormView').style.display = 'none';
    document.getElementById('templateListView').style.display = 'block';
    currentTemplateItems = [];
    tplSelectedItem = null;
}

function renderTemplateFormItems() {
    const listEl = document.getElementById('templateItemsList');
    const previewEl = document.getElementById('templateNutritionPreview');
    if (currentTemplateItems.length === 0) {
        listEl.innerHTML = '<div class="template-empty-items">Bu öğüne henüz besin eklenmedi.</div>';
        if (previewEl) previewEl.textContent = '';
        return;
    }
    listEl.innerHTML = currentTemplateItems.map((item, i) => `
        <div class="template-form-item">
            <span class="template-form-item-name">${escapeHtml(item.item_name)} - ${item.grams}${item.type === 'drink' ? 'ml' : 'g'}</span>
            <button class="template-form-item-remove" data-index="${i}">✕</button>
        </div>
    `).join('');

    listEl.querySelectorAll('.template-form-item-remove').forEach(btn => {
        btn.addEventListener('click', () => {
            currentTemplateItems.splice(parseInt(btn.dataset.index), 1);
            renderTemplateFormItems();
        });
    });

    if (previewEl) {
        const totals = sumNutrition(currentTemplateItems.map(entry => {
            const source = entry.type === 'food' ? foods : drinks;
            const item = source.find(candidate => candidate.id === entry.item_id);
            return item ? calculateLogNutrition(item, entry.grams) : null;
        }).filter(Boolean));
        previewEl.innerHTML = `
            <span>Tarifin tamamı</span>
            <strong>${Math.round(totals.kcal)} kcal</strong>
            <span>P ${Math.round(totals.protein)}g · K ${Math.round(totals.carb)}g · Y ${Math.round(totals.fat)}g</span>
        `;
    }
}

async function saveCurrentTemplate() {
    const name = document.getElementById('templateName').value.trim();
    const kind = document.getElementById('templateKind').value === 'recipe' ? 'recipe' : 'meal';
    const servings = Math.min(100, Math.max(1, Math.round(Number(document.getElementById('templateServings').value) || 1)));
    const fallbackYield = currentTemplateItems.reduce((sum, item) => sum + Number(item.grams || 0), 0);
    const yieldAmount = kind === 'recipe'
        ? Number(document.getElementById('templateYield').value)
        : 0;
    const yieldUnit = document.getElementById('templateYieldUnit').value === 'ml' ? 'ml' : 'g';
    const nutritionConfidence = document.getElementById('templateConfidence').value === 'estimated'
        ? 'estimated'
        : 'personal';
    if (!name) { showError('Öğününe bir ad ver.'); return; }
    if (currentTemplateItems.length === 0) { showError('Öğüne en az bir besin ekle.'); return; }
    if (kind === 'recipe' && (!Number.isFinite(yieldAmount) || yieldAmount <= 0 || yieldAmount > 100000)) {
        showError('Tarifin hazırlandıktan sonraki toplam gram veya mililitre miktarını gir.');
        return;
    }

    const template = {
        id: 'tpl_' + Date.now(),
        name,
        kind,
        servings,
        yieldAmount: kind === 'recipe' ? yieldAmount : fallbackYield,
        yieldUnit,
        nutritionConfidence,
        items: currentTemplateItems.map(ti => ({
            item_id: ti.item_id, item_name: ti.item_name, grams: ti.grams, type: ti.type
        }))
    };
    const templates = loadTemplates();
    templates.push(template);
    const updatedAtMs = saveTemplates(templates);
    hideTemplateForm();
    renderTemplateList();

    const cloudSaved = await saveTemplatesToCloud(templates, updatedAtMs);
    if (!cloudSaved) {
        showError('Sablon Firebase\'e kaydedilemedi. Firestore kurallarini kontrol edin.');
    }
}

function renderTplDropdown(items, searchTerm) {
    const dropdown = document.getElementById('tplDropdown');
    tplDropdownItems = items;

    if (items.length === 0) {
        dropdown.innerHTML = '<div class="dropdown-item">Aramana uygun besin bulunamadı.</div>';
        dropdown.classList.add('active');
        fitDropdownAboveMobileNavigation(dropdown);
        return;
    }

    const itemType = document.querySelector('input[name="tplItemType"]:checked').value;
    dropdown.innerHTML = items.map((item, index) => `
        <div class="dropdown-item dropdown-product-card catalog-item" data-index="${index}">
            ${getProductCardContent(item, itemType, {
                nameHtml: highlightMatch(getDisplayItemName(item, itemType), searchTerm)
            })}
        </div>
    `).join('');
    dropdown.classList.add('active');
    fitDropdownAboveMobileNavigation(dropdown);

    dropdown.querySelectorAll('.dropdown-item[data-index]').forEach(el => {
        el.addEventListener('click', () => {
            const idx = parseInt(el.dataset.index);
            const selected = tplDropdownItems[idx];
            if (selected) {
                tplSelectedItem = selected;
                document.getElementById('tplSearchInput').value = getDisplayItemName(
                    selected,
                    document.querySelector('input[name="tplItemType"]:checked').value
                );
                dropdown.classList.remove('active');
                document.getElementById('tplGramsInput').focus();
            }
        });
    });
}

function closeTplDropdown() {
    document.getElementById('tplDropdown').classList.remove('active');
    tplDropdownItems = [];
}

function downloadTextFile(filename, content, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
}

async function readCollectionForBackup(collectionName) {
    const snap = await getDocs(collection(db, collectionName));
    return snap.docs.map(docSnap => ({ id: docSnap.id, data: docSnap.data() }));
}

async function exportJsonBackup() {
    try {
        showLoading();
        const [dailyLogs, customItems, weightLogs, settingsSnap, templatesSnap] = await Promise.all([
            readCollectionForBackup('daily_logs'),
            readCollectionForBackup('custom_items'),
            readCollectionForBackup(WEIGHT_LOG_COLLECTION),
            getDoc(doc(db, SETTINGS_COLLECTION, SETTINGS_DOC_ID)),
            getDoc(doc(db, SETTINGS_COLLECTION, TEMPLATES_SETTINGS_DOC_ID))
        ]);
        const settingsData = settingsSnap.exists() ? settingsSnap.data() : {};
        const dailyMeta = Object.entries(settingsData.daily_meta || {})
            .map(([id, data]) => ({ id, data }));
        const measurements = Object.entries(settingsData.body_measurements || {})
            .map(([id, data]) => ({ id, data }));

        const backup = {
            schema_version: APP_SCHEMA_VERSION,
            exported_at: new Date().toISOString(),
            daily_logs: dailyLogs,
            custom_items: customItems,
            weight_logs: weightLogs,
            daily_meta: dailyMeta,
            body_measurements: measurements,
            settings: settingsSnap.exists() ? settingsData : null,
            templates: templatesSnap.exists() ? templatesSnap.data() : null,
            local: {
                targets: TARGETS,
                macro_preferences: MACRO_PREFERENCES,
                profile: loadProfile(),
                favorites: loadFavoriteItems(),
                recent_items: loadRecentItems()
            }
        };
        downloadTextFile(
            `denge-yedek-${getToday()}.json`,
            JSON.stringify(backup, null, 2),
            'application/json;charset=utf-8'
        );
        showError('JSON yedeği hazırlandı.', 'success');
    } catch (error) {
        console.error('Backup export failed:', error);
        showError('JSON yedeği oluşturulamadı.');
    } finally {
        hideLoading();
    }
}

function csvCell(value) {
    const text = String(value ?? '');
    return `"${text.replaceAll('"', '""')}"`;
}

async function exportLogsCsv() {
    try {
        showLoading();
        const logs = await readCollectionForBackup('daily_logs');
        const header = ['date', 'meal', 'item_name', 'amount', 'unit', 'kcal', 'protein', 'carb', 'fat', 'fiber', 'sugar', 'sodium'];
        const rows = logs
            .map(entry => entry.data)
            .sort((a, b) => String(a.date).localeCompare(String(b.date)))
            .map(log => [
                log.date,
                MEAL_LABELS[log.meal_type] || '',
                log.item_name,
                log.grams,
                getLogUnit(log),
                log.kcal,
                log.protein,
                log.carb,
                log.fat,
                log.fiber || 0,
                log.sugar || 0,
                log.sodium || 0
            ].map(csvCell).join(','));
        downloadTextFile(
            `kalori-kayitlari-${getToday()}.csv`,
            '\uFEFF' + [header.map(csvCell).join(','), ...rows].join('\n'),
            'text/csv;charset=utf-8'
        );
        showError('CSV dosyası hazırlandı.', 'success');
    } catch (error) {
        console.error('CSV export failed:', error);
        showError('CSV dışa aktarılamadı.');
    } finally {
        hideLoading();
    }
}

async function restoreCollection(collectionName, entries) {
    const safeEntries = entries.filter(isValidBackupEntry);
    for (let index = 0; index < safeEntries.length; index += 400) {
        const batch = writeBatch(db);
        safeEntries.slice(index, index + 400).forEach(entry => {
            batch.set(doc(db, collectionName, String(entry.id)), entry.data);
        });
        await batch.commit();
    }
}

const BACKUP_FILE_MAX_BYTES = 25 * 1024 * 1024;
const BACKUP_COLLECTION_LIMITS = {
    daily_logs: 50000,
    custom_items: 5000,
    weight_logs: 5000,
    daily_meta: 5000,
    body_measurements: 5000
};

function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isValidBackupEntry(entry) {
    return isRecord(entry)
        && typeof entry.id === 'string'
        && isSafeRecordId(entry.id)
        && isRecord(entry.data);
}

function isSafeRecordId(value) {
    return typeof value === 'string'
        && value.length > 0
        && value.length <= 1500
        && /^[A-Za-z0-9_-]+$/.test(value);
}

function isValidDateString(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isFiniteNumberInRange(value, min, max) {
    const number = Number(value);
    return Number.isFinite(number) && number >= min && number <= max;
}

function validateBackupCollection(name, entries, validateData) {
    if (!Array.isArray(entries)) return `${name} listesi eksik veya geçersiz.`;
    if (entries.length > BACKUP_COLLECTION_LIMITS[name]) {
        return `${name} listesi izin verilen kayıt sınırını aşıyor.`;
    }

    const ids = new Set();
    for (const entry of entries) {
        if (!isValidBackupEntry(entry) || ids.has(entry.id) || !validateData(entry.data)) {
            return `${name} listesinde geçersiz veya yinelenen bir kayıt var.`;
        }
        ids.add(entry.id);
    }
    return '';
}

function validateBackup(backup) {
    if (!isRecord(backup) || ![1, 2, 3].includes(backup.schema_version)) {
        return 'Yedek biçimi desteklenmiyor.';
    }

    const dailyLogsError = validateBackupCollection('daily_logs', backup.daily_logs, data =>
        isValidDateString(data.date)
        && typeof data.item_name === 'string'
        && data.item_name.trim().length > 0
        && data.item_name.length <= 250
        && isFiniteNumberInRange(data.grams, 0.01, 100000)
        && ['kcal', 'protein', 'carb', 'fat'].every(key =>
            isFiniteNumberInRange(data[key], 0, 100000)
        )
    );
    if (dailyLogsError) return dailyLogsError;

    const customItemsError = validateBackupCollection('custom_items', backup.custom_items, data =>
        typeof data.name === 'string'
        && data.name.trim().length > 0
        && data.name.length <= 250
        && (data.type === 'food' || data.type === 'drink')
        && isFiniteNumberInRange(data.ref_amount ?? 100, 0.01, 100000)
        && ['kcal_100', 'protein_100', 'carb_100', 'fat_100'].every(key =>
            isFiniteNumberInRange(data[key], 0, 100000)
        )
    );
    if (customItemsError) return customItemsError;

    const weightLogsError = validateBackupCollection('weight_logs', backup.weight_logs, data =>
        isValidDateString(data.date)
        && isFiniteNumberInRange(data.weight, 30, 250)
    );
    if (weightLogsError) return weightLogsError;

    if (backup.schema_version >= 2) {
        const dailyMetaError = validateBackupCollection('daily_meta', backup.daily_meta, data =>
            isValidDateString(data.date)
            && isFiniteNumberInRange(data.hunger ?? 3, 1, 5)
            && isFiniteNumberInRange(data.energy ?? 3, 1, 5)
            && (data.trained === undefined || typeof data.trained === 'boolean')
        );
        if (dailyMetaError) return dailyMetaError;

        const measurementsError = validateBackupCollection('body_measurements', backup.body_measurements, data =>
            isValidDateString(data.date)
            && ['waist', 'hip', 'chest'].every(key =>
                Number(data[key] || 0) === 0 || isFiniteNumberInRange(data[key], 30, 250)
            )
        );
        if (measurementsError) return measurementsError;
    }

    if (backup.settings !== null && backup.settings !== undefined && !isRecord(backup.settings)) {
        return 'Ayarlar verisi geçersiz.';
    }
    if (backup.templates !== null && backup.templates !== undefined && !isRecord(backup.templates)) {
        return 'Kayıtlı öğün verisi geçersiz.';
    }
    if (backup.local !== null && backup.local !== undefined && !isRecord(backup.local)) {
        return 'Yerel ayarlar verisi geçersiz.';
    }
    return '';
}

async function restoreJsonBackup(file) {
    if (!file || file.size > BACKUP_FILE_MAX_BYTES) {
        showError('Yedek dosyası 25 MB sınırını aşıyor.');
        return;
    }

    let backup;
    try {
        backup = JSON.parse(await file.text());
    } catch {
        showError('Seçilen dosya geçerli bir JSON yedeği değil.');
        return;
    }

    const validationError = validateBackup(backup);
    if (validationError) {
        showError(validationError);
        return;
    }
    const approved = await requestConfirmation({
        title: 'Yedeği geri yükle',
        message: 'Mevcut veriler silinip seçtiğin yedek geri yüklenecek. Bu işlem geri alınamaz.',
        confirmLabel: 'Yedeği yükle',
        danger: true
    });
    if (!approved) return;

    try {
        showLoading();
        const warnings = await resetCloudData();
        if (warnings.length > 0) throw new Error(warnings.join(' '));

        await restoreCollection('daily_logs', backup.daily_logs);
        await restoreCollection('custom_items', backup.custom_items);
        await restoreCollection(WEIGHT_LOG_COLLECTION, backup.weight_logs);
        const restoredSettings = { ...(backup.settings || {}) };
        if (backup.schema_version >= 2) {
            restoredSettings.daily_meta = Object.fromEntries(
                backup.daily_meta.map(entry => [entry.id, entry.data])
            );
            restoredSettings.body_measurements = Object.fromEntries(
                backup.body_measurements.map(entry => [entry.id, entry.data])
            );
        }
        if (Object.keys(restoredSettings).length > 0) {
            await setDoc(doc(db, SETTINGS_COLLECTION, SETTINGS_DOC_ID), {
                ...restoredSettings,
                updated_at: serverTimestamp()
            });
        }
        if (backup.templates) {
            await setDoc(doc(db, SETTINGS_COLLECTION, TEMPLATES_SETTINGS_DOC_ID), {
                ...backup.templates,
                updated_at: serverTimestamp()
            });
        }

        // Eski yerel önbellek, geri yüklenen bulut verisini yeniden ezmesin.
        resetLocalData();
        if (backup.local?.macro_preferences) {
            saveMacroPreferences(backup.local.macro_preferences);
        }
        if (backup.local?.targets) saveTargets(backup.local.targets);
        if (backup.local?.profile) saveProfile(backup.local.profile);
        if (Array.isArray(backup.local?.favorites)) {
            localStorage.setItem(FAVORITES_KEY, JSON.stringify(backup.local.favorites));
        }
        if (Array.isArray(backup.local?.recent_items)) {
            saveRecentItems(backup.local.recent_items);
        }

        showError('Yedek geri yüklendi. Uygulama yenileniyor.', 'success');
        window.setTimeout(() => window.location.reload(), 900);
    } catch (error) {
        console.error('Backup restore failed:', error);
        showError('Yedek geri yüklenemedi. Mevcut JSON yedeğini saklayın ve tekrar deneyin.');
    } finally {
        hideLoading();
    }
}

async function deleteCollectionDocsInBatches(collectionName) {
    const snap = await getDocs(collection(db, collectionName));
    if (snap.empty) return 0;

    let deletedCount = 0;
    let batch = writeBatch(db);
    let batchSize = 0;

    for (const docSnap of snap.docs) {
        batch.delete(docSnap.ref);
        deletedCount++;
        batchSize++;

        if (batchSize >= 400) {
            await batch.commit();
            batch = writeBatch(db);
            batchSize = 0;
        }
    }

    if (batchSize > 0) {
        await batch.commit();
    }

    return deletedCount;
}

async function resetCloudData() {
    const warnings = [];

    if (!db) {
        warnings.push('Firebase baglantisi olmadigi icin bulut verileri sifirlanamadi.');
        return warnings;
    }

    try {
        await deleteCollectionDocsInBatches('daily_logs');
    } catch (error) {
        console.warn('daily_logs reset failed:', error);
        warnings.push('Gunluk kayitlar Firebase tarafinda silinemedi.');
    }

    try {
        await deleteCollectionDocsInBatches('custom_items');
    } catch (error) {
        console.warn('custom_items reset failed:', error);
        warnings.push('Ozel urunler Firebase tarafinda silinemedi.');
    }

    try {
        await deleteCollectionDocsInBatches(WEIGHT_LOG_COLLECTION);
    } catch (error) {
        console.warn('weight_logs reset failed:', error);
        warnings.push('Kilo gecmisi Firebase tarafinda silinemedi.');
    }

    try {
        await deleteDoc(doc(db, SETTINGS_COLLECTION, SETTINGS_DOC_ID));
    } catch (error) {
        console.warn('app_settings reset failed:', error);
        warnings.push('Ayarlar Firebase tarafinda silinemedi.');
    }

    try {
        await deleteDoc(doc(db, SETTINGS_COLLECTION, TEMPLATES_SETTINGS_DOC_ID));
    } catch (error) {
        console.warn('templates reset failed:', error);
        warnings.push('Sablonlar Firebase tarafinda silinemedi.');
    }

    return warnings;
}

function removeCustomItemsFromLocalArrays() {
    for (let i = foods.length - 1; i >= 0; i--) {
        if (typeof foods[i].id === 'string' && foods[i].id.startsWith('custom_')) {
            foods.splice(i, 1);
        }
    }

    for (let i = drinks.length - 1; i >= 0; i--) {
        if (typeof drinks[i].id === 'string' && drinks[i].id.startsWith('custom_')) {
            drinks.splice(i, 1);
        }
    }
}

function resetLocalData() {
    const keysToRemove = [
        TARGETS_KEY,
        MACRO_PREFERENCES_KEY,
        PROFILE_KEY,
        WEIGHT_LOG_KEY,
        RECENT_ITEMS_KEY,
        FAVORITES_KEY,
        PORTION_MEMORY_KEY,
        SCHEMA_VERSION_KEY,
        LOG_NUTRITION_REPAIR_KEY,
        TEMPLATES_KEY,
        TEMPLATES_SYNC_META_KEY,
        LAUNCH_MOTIVATION_LAST_KEY,
        'lightMode',
        'darkMode',
        'mobileCollapseState'
    ];
    keysToRemove.forEach((key) => localStorage.removeItem(key));

    removeCustomItemsFromLocalArrays();

    todayLogs = [];
    recentLogs = [];
    weekLogs = [];
    selectedItem = null;
    portionMemory = {};
    pendingLogItems = [];
    templateCache = [];
    currentDropdownItems = [];
    currentDropdownIndex = -1;
    currentTemplateItems = [];
    tplSelectedItem = null;
    tplDropdownItems = [];
    catalogCategory = 'all';
    catalogSearchTerm = '';
    logsDateFilter = '';
    logsDateToFilter = '';
    launchMotivationMessage = null;
    weightLogCache = [];

    saveProfile({});
    saveWeightLog([]);
    saveMacroPreferences(DEFAULT_MACRO_PREFERENCES);
    saveTargets(getDefaultTargets());
}

function refreshUiAfterReset() {
    const setInputValue = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.value = value;
    };

    const targetDisplay = document.getElementById('targetKcalDisplay');
    if (targetDisplay) targetDisplay.textContent = TARGETS.kcal;

    setInputValue('profileGender', '');
    setInputValue('profileAge', '');
    setInputValue('profileHeight', '');
    setInputValue('profileWeight', '');
    setInputValue('profileActivity', '1.2');
    setInputValue('profileTrainingDays', '');
    setInputValue('profileSteps', '');
    setInputValue('profileGoalMode', 'cut_moderate');
    setInputValue('profileTargetWeight', '');
    setInputValue('trainingDayKcal', '');
    setInputValue('restDayKcal', '');

    setInputValue('targetKcal', TARGETS.kcal);
    setInputValue('targetProtein', TARGETS.protein);
    setInputValue('targetCarb', TARGETS.carb);
    setInputValue('targetFat', TARGETS.fat);
    renderMacroPreferencesForm(MACRO_PREFERENCES);

    setInputValue('weightInput', '');
    setInputValue('weightDate', getToday());
    setInputValue('logDate', getToday());
    setInputValue('logsDateFilter', '');
    setInputValue('logsDateToFilter', '');

    setInputValue('searchInput', '');
    setInputValue('gramsInput', '');
    setInputValue('customName', '');
    setInputValue('customKcal', '');
    setInputValue('customProtein', '');
    setInputValue('customCarb', '');
    setInputValue('customFat', '');
    setInputValue('customFiber', '');
    setInputValue('customSugar', '');
    setInputValue('customSodium', '');
    setInputValue('customConfidence', 'verified');
    setInputValue('catalogSearch', '');
    setInputValue('templateName', '');
    setInputValue('tplSearchInput', '');
    setInputValue('tplGramsInput', '');

    const goalRecommendation = document.getElementById('goalRecommendation');
    if (goalRecommendation) goalRecommendation.style.display = 'none';

    const previewEl = document.getElementById('calculationPreview');
    if (previewEl) previewEl.style.display = 'none';
    const portionPresets = document.getElementById('portionPresets');
    if (portionPresets) portionPresets.style.display = 'none';
    renderPendingLogItems();

    const itemTypeFood = document.querySelector('input[name="itemType"][value="food"]');
    if (itemTypeFood) itemTypeFood.checked = true;

    const customType = document.getElementById('customType');
    if (customType) customType.value = 'food';
    const customTypeFood = document.querySelector('input[name="customTypeChoice"][value="food"]');
    if (customTypeFood) customTypeFood.checked = true;

    const presetSection = document.getElementById('preset-section');
    if (presetSection) presetSection.style.display = 'block';
    const customSection = document.getElementById('custom-section');
    if (customSection) customSection.style.display = 'none';

    const amountLabel = document.getElementById('amountLabel');
    if (amountLabel) amountLabel.textContent = 'Porsiyon (gram)';
    const gramsInput = document.getElementById('gramsInput');
    if (gramsInput) gramsInput.placeholder = '100';

    document.querySelectorAll('.catalog-filter-btn').forEach((btn) => btn.classList.remove('active'));
    const allCatalogBtn = document.querySelector('.catalog-filter-btn[data-category="all"]');
    if (allCatalogBtn) allCatalogBtn.classList.add('active');

    closeDropdown();
    closeTplDropdown();
    hideTemplateForm();
    if (typeof window.switchTab === 'function') {
        window.switchTab('logs');
    }

    updateSummary();
    renderLogs();
    renderChart();
    renderProgressInsights();
    updateGoalStreak();
    renderWeightSection();
    renderCatalog();
    renderTemplateList();
}

async function resetApplicationData() {
    const cloudWarnings = await resetCloudData();
    resetLocalData();
    refreshUiAfterReset();
    return cloudWarnings;
}

window.renderCatalog = renderCatalog;
window.renderTemplateList = renderTemplateList;

// Load custom items from Firestore
function normalizeCustomItem(id, raw) {
    if (!isSafeRecordId(id) || !isRecord(raw)) return null;
    const name = String(raw.name || '').trim();
    const type = raw.type === 'food' || raw.type === 'drink' ? raw.type : '';
    const referenceAmount = Number(raw.ref_amount ?? 100);
    const nutrition = {
        kcal_100: Number(raw.kcal_100),
        protein_100: Number(raw.protein_100),
        carb_100: Number(raw.carb_100),
        fat_100: Number(raw.fat_100),
        fiber_100: Number(raw.fiber_100 || 0),
        sugar_100: Number(raw.sugar_100 || 0),
        sodium_100: Number(raw.sodium_100 || 0)
    };
    if (
        !name
        || name.length > 250
        || !type
        || !Number.isFinite(referenceAmount)
        || referenceAmount <= 0
        || referenceAmount > 100000
        || Object.values(nutrition).some(value =>
            !Number.isFinite(value) || value < 0 || value > 100000
        )
    ) {
        return null;
    }
    return {
        id,
        name,
        type,
        ref_amount: referenceAmount,
        nutrition_confidence: ['verified', 'personal', 'estimated'].includes(raw.nutrition_confidence)
            ? raw.nutrition_confidence
            : 'verified',
        schema_version: Number(raw.schema_version) || 1,
        ...nutrition
    };
}

async function loadCustomItems() {
    try {
        const querySnapshot = await getDocs(collection(db, 'custom_items'));
        querySnapshot.forEach((docSnap) => {
            const item = normalizeCustomItem(docSnap.id, docSnap.data());
            if (!item) {
                console.warn('Invalid custom item skipped:', docSnap.id);
                return;
            }
            if (item.type === 'food') {
                foods.push(item);
            } else {
                drinks.push(item);
            }
        });
    } catch (error) {
        console.warn('Could not load custom items:', error);
    }
}

function renderMeasurements() {
    const container = document.getElementById('measurementList');
    if (!container) return;
    if (measurementCache.length === 0) {
        container.innerHTML = '<div class="weight-no-data">Henüz vücut ölçümü yok.</div>';
        return;
    }
    const formatMeasurement = value => {
        const number = Number(value);
        return Number.isFinite(number) && number > 0 ? `${number} cm` : '—';
    };
    container.innerHTML = measurementCache.slice(0, 8).map(entry => `
        <div class="measurement-item">
            <strong class="measurement-date">${formatDate(entry.date)}</strong>
            <div class="measurement-values">
                <span>Bel <strong>${formatMeasurement(entry.waist)}</strong></span>
                <span>Kalça <strong>${formatMeasurement(entry.hip)}</strong></span>
                <span>Göğüs <strong>${formatMeasurement(entry.chest)}</strong></span>
            </div>
            <button class="measurement-delete-btn" type="button" data-date="${entry.date}" aria-label="${formatDate(entry.date)} ölçümünü sil" title="Ölçümü sil">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/></svg>
            </button>
        </div>
    `).join('');
    container.querySelectorAll('button[data-date]').forEach(button => {
        button.addEventListener('click', async () => {
            const approved = await requestConfirmation({
                title: 'Ölçümü sil',
                message: `${formatDate(button.dataset.date)} tarihli vücut ölçümü silinsin mi?`,
                confirmLabel: 'Ölçümü sil',
                danger: true
            });
            if (!approved) return;
            try {
                const settings = await readSharedSettingsData();
                const measurements = {
                    ...(settings.body_measurements && typeof settings.body_measurements === 'object'
                        ? settings.body_measurements
                        : {})
                };
                delete measurements[button.dataset.date];
                await writeSharedSettingsField('body_measurements', measurements);
                measurementCache = measurementCache.filter(entry => entry.date !== button.dataset.date);
                renderMeasurements();
            } catch (error) {
                console.error('Measurement delete failed:', error);
                showError('Ölçüm silinemedi.');
            }
        });
    });
}

async function loadMeasurements() {
    if (!db) return;
    try {
        const settings = await readSharedSettingsData();
        measurementCache = Object.entries(
            settings.body_measurements && typeof settings.body_measurements === 'object'
                ? settings.body_measurements
                : {}
        ).map(([date, data]) => ({ ...data, date: data.date || date }));
        measurementCache.sort((a, b) => b.date.localeCompare(a.date));
        renderMeasurements();
    } catch (error) {
        console.warn('Measurements could not be loaded:', error);
        renderMeasurements();
    }
}

async function saveMeasurement() {
    const date = document.getElementById('measurementDate').value;
    const values = {
        waist: Number(document.getElementById('measurementWaist').value) || 0,
        hip: Number(document.getElementById('measurementHip').value) || 0,
        chest: Number(document.getElementById('measurementChest').value) || 0
    };
    const hasMeasurement = Object.values(values).some(value => value >= 30 && value <= 250);
    const hasInvalidMeasurement = Object.values(values)
        .some(value => value !== 0 && (value < 30 || value > 250));
    if (!date || !hasMeasurement || hasInvalidMeasurement) {
        showError('Bir tarih ve en az bir geçerli ölçü gir.');
        return;
    }
    try {
        const payload = {
            date,
            ...values,
            schema_version: APP_SCHEMA_VERSION,
            updated_at: serverTimestamp()
        };
        const settings = await readSharedSettingsData();
        const measurements = {
            ...(settings.body_measurements && typeof settings.body_measurements === 'object'
                ? settings.body_measurements
                : {}),
            [date]: payload
        };
        await writeSharedSettingsField('body_measurements', measurements);
        measurementCache = [
            { ...payload, updated_at: new Date() },
            ...measurementCache.filter(entry => entry.date !== date)
        ].sort((a, b) => b.date.localeCompare(a.date));
        renderMeasurements();
        ['measurementWaist', 'measurementHip', 'measurementChest']
            .forEach(id => { document.getElementById(id).value = ''; });
        showError('Vücut ölçümü kaydedildi.', 'success');
    } catch (error) {
        console.error('Measurement save failed:', error);
        showError('Ölçüm kaydedilemedi.');
    }
}

async function renderProgressPhotos() {
    const container = document.getElementById('progressPhotoGrid');
    if (!container) return;
    try {
        const settings = await readSharedSettingsData();
        progressPhotoCache = Array.isArray(settings.progress_photos)
            ? settings.progress_photos
                .filter(photo => photo && photo.id && (photo.data_url || photo.url) && photo.date)
                .sort((a, b) => b.date.localeCompare(a.date) || Number(b.created_at_ms || 0) - Number(a.created_at_ms || 0))
            : [];
        if (progressPhotoCache.length === 0) {
            container.innerHTML = '<div class="weight-no-data">Henüz ilerleme fotoğrafı yok.</div>';
            return;
        }
        container.innerHTML = progressPhotoCache.map(photo => `
                <figure>
                    <img src="${escapeHtml(photo.data_url || photo.url)}" alt="${formatDate(photo.date)} tarihli ilerleme fotoğrafı" loading="lazy">
                    <figcaption>
                        <strong>${formatDate(photo.date)}</strong>
                        <span>${escapeHtml(photo.note || '')}</span>
                        <button type="button" data-photo-id="${escapeHtml(photo.id)}">Sil</button>
                    </figcaption>
                </figure>
            `).join('');
        container.querySelectorAll('button[data-photo-id]').forEach(button => {
            button.addEventListener('click', async () => {
                const photo = progressPhotoCache.find(item => item.id === button.dataset.photoId);
                if (!photo) return;
                const approved = await requestConfirmation({
                    title: 'Fotoğrafı sil',
                    message: `${formatDate(photo.date)} tarihli ilerleme fotoğrafı Firebase'den silinsin mi?`,
                    confirmLabel: 'Fotoğrafı sil',
                    danger: true
                });
                if (!approved) return;
                try {
                    progressPhotoCache = progressPhotoCache.filter(item => item.id !== photo.id);
                    await writeSharedSettingsField('progress_photos', progressPhotoCache);
                    await renderProgressPhotos();
                    showError('İlerleme fotoğrafı silindi.', 'success');
                } catch (error) {
                    console.error('Firebase progress photo delete failed:', error);
                    showError('Fotoğraf Firebase\'den silinemedi.');
                }
            });
        });
    } catch (error) {
        console.warn('Progress photos could not be loaded:', error);
        container.innerHTML = '<div class="weight-no-data">Fotoğraflar Firebase\'den yüklenemedi.</div>';
    }
}

async function optimizeProgressPhoto(file) {
    const objectUrl = URL.createObjectURL(file);
    try {
        const image = await new Promise((resolve, reject) => {
            const element = new Image();
            element.onload = () => resolve(element);
            element.onerror = () => reject(new Error('Fotoğraf açılamadı.'));
            element.src = objectUrl;
        });
        const longestSide = Math.max(image.naturalWidth, image.naturalHeight);
        const scale = Math.min(1, 720 / Math.max(1, longestSide));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        const context = canvas.getContext('2d', { alpha: false });
        context.drawImage(image, 0, 0, canvas.width, canvas.height);

        let quality = 0.76;
        let dataUrl = canvas.toDataURL('image/webp', quality);
        while (dataUrl.length > 160000 && quality > 0.42) {
            quality -= 0.08;
            dataUrl = canvas.toDataURL('image/webp', quality);
        }
        if (dataUrl.length > 190000) {
            throw new Error('Fotoğraf Firebase kaydı için fazla büyük.');
        }
        return dataUrl;
    } finally {
        URL.revokeObjectURL(objectUrl);
    }
}

async function addProgressPhotoFromForm() {
    const file = document.getElementById('progressPhotoInput').files?.[0];
    const date = document.getElementById('progressPhotoDate').value;
    const note = document.getElementById('progressPhotoNote').value;
    if (!file || !date) {
        showError('Bir tarih ve fotoğraf seç.');
        return;
    }
    if (file.size > 8 * 1024 * 1024) {
        showError('Fotoğraf en fazla 8 MB olabilir.');
        return;
    }
    try {
        const id = `photo_${Date.now()}`;
        const dataUrl = await optimizeProgressPhoto(file);
        const settings = await readSharedSettingsData();
        const photos = Array.isArray(settings.progress_photos) ? settings.progress_photos : [];
        progressPhotoCache = [
            {
                id,
                date,
                note: String(note || '').trim().slice(0, 160),
                data_url: dataUrl,
                created_at_ms: Date.now(),
                schema_version: APP_SCHEMA_VERSION
            },
            ...photos.filter(photo => photo?.id !== id)
        ].slice(0, 4);
        await writeSharedSettingsField('progress_photos', progressPhotoCache);
        document.getElementById('progressPhotoInput').value = '';
        document.getElementById('progressPhotoFileName').textContent = 'JPG, PNG veya WebP';
        document.getElementById('progressPhotoNote').value = '';
        await renderProgressPhotos();
        showError('İlerleme fotoğrafı Firebase\'e kaydedildi.', 'success');
    } catch (error) {
        console.error('Firebase progress photo save failed:', error);
        showError('Fotoğraf Firebase\'e kaydedilemedi. Daha küçük bir fotoğrafla tekrar dene.');
    }
}

// Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    if (pendingUiMessage) {
        const { message, type } = pendingUiMessage;
        showError(message, type);
    }
    updateConnectionIndicator();
    window.addEventListener('online', () => updateConnectionIndicator('online'));
    window.addEventListener('offline', () => updateConnectionIndicator('offline'));
    window.addEventListener('unhandledrejection', event => {
        console.error('Unhandled application rejection:', event.reason);
        updateConnectionIndicator(navigator.onLine ? 'error' : 'offline');
    });
    window.addEventListener('error', event => {
        console.error('Unhandled application error:', event.error || event.message);
        updateConnectionIndicator(navigator.onLine ? 'error' : 'offline');
    });

    const refitOpenDropdowns = () => {
        document.querySelectorAll('.dropdown.active').forEach(fitDropdownAboveMobileNavigation);
    };
    window.addEventListener('resize', refitOpenDropdowns);
    window.visualViewport?.addEventListener('resize', refitOpenDropdowns);

    // Set date display
    const today = getToday();
    document.getElementById('dateDisplay').textContent = formatDate(today);
    const logDateInput = document.getElementById('logDate');
    if (logDateInput) logDateInput.value = today;
    const logsDateFilterInput = document.getElementById('logsDateFilter');
    if (logsDateFilterInput) logsDateFilterInput.value = today;
    const logsDateToFilterInput = document.getElementById('logsDateToFilter');
    if (logsDateToFilterInput) logsDateToFilterInput.value = today;
    logsDateFilter = today;
    logsDateToFilter = today;
    const logsDateFilterField = logsDateFilterInput?.closest('.logs-filter-field');
    const syncLogsDateFilterPlaceholder = () => {
        if (!logsDateFilterField || !logsDateFilterInput) return;
        logsDateFilterField.classList.toggle('is-empty', !logsDateFilterInput.value);
    };
    syncLogsDateFilterPlaceholder();

    // Arayüzü ağ isteklerini bekletmeden kullanılabilir hale getir.
    updateSummary();
    renderTodayTrainingToggle();
    renderCatalog();
    renderTemplateList();
    hideLoading();

    const dailyLogsPromise = loadInitialDailyLogs().then(() => {
        if (isFuturePreviewEnabled()) applyFuturePreviewData();
    });

    Promise.allSettled([
        loadCustomItems().then(() => {
            renderCatalog();
            renderTemplateList();
        }),
        initializeTemplates().then(renderTemplateList),
        loadSettingsFromCloud(),
        initializeWeightLog(),
        loadMeasurements(),
        renderProgressPhotos(),
        dailyLogsPromise
    ]);

    const runMaintenance = () => {
        syncExistingLogsToCurrentData();
    };

    if ('requestIdleCallback' in window) {
        window.requestIdleCallback(runMaintenance, { timeout: 15000 });
    } else {
        window.setTimeout(runMaintenance, 8000);
    }
    // Yeni mobil düzende kartlar doğal akışta kalır; ek katlama sarmalayıcıları kullanılmaz.

    if ('serviceWorker' in navigator) {
        let reloadingForServiceWorker = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (reloadingForServiceWorker) return;
            reloadingForServiceWorker = true;
            window.location.reload();
        });
        navigator.serviceWorker.register('./sw.js')
            .then(registration => registration.update())
            .catch(error => {
                console.warn('Service worker could not be registered:', error);
            });
    }

    ['targetKcal', 'targetProtein', 'targetCarb', 'targetFat'].forEach((id) => {
        const input = document.getElementById(id);
        if (!input) return;
        input.readOnly = id === 'targetKcal' ? LOCK_TARGETS_TO_FIXED_PLAN : true;
        input.value = TARGETS[id.replace('target', '').toLowerCase()] ?? input.value;
    });
    renderMacroPreferencesForm(MACRO_PREFERENCES);
    document.getElementById('macroStrategy').addEventListener('change', () => {
        updateMacroTargetFields({ applyPreset: true });
    });
    ['macroProteinPct', 'macroCarbPct', 'macroFatPct', 'targetKcal'].forEach(id => {
        document.getElementById(id).addEventListener('input', () => {
            updateMacroTargetFields();
            if (id === 'targetKcal') updateDayTypeTargetFields();
        });
    });
    document.getElementById('profileTrainingDays').addEventListener('input', updateDayTypeTargetFields);
    
    // Item type change
    document.querySelectorAll('input[name="itemType"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            selectedItem = null;
            document.getElementById('searchInput').value = '';
            document.getElementById('calculationPreview').style.display = 'none';
            document.getElementById('portionPresets').style.display = 'none';
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
                amountLabel.textContent = 'Miktar';
                gramsInput.placeholder = '100';
                configurePortionControls(null, document.getElementById('customType')?.value || 'food', false);
            } else {
                presetSection.style.display = 'block';
                customSection.style.display = 'none';
                configurePortionControls(null, itemType, false);
            }

            // Clear custom inputs
            document.getElementById('customName').value = '';
            document.getElementById('customKcal').value = '';
            document.getElementById('customProtein').value = '';
            document.getElementById('customCarb').value = '';
            document.getElementById('customFat').value = '';
            document.getElementById('customFiber').value = '';
            document.getElementById('customSugar').value = '';
            document.getElementById('customSodium').value = '';
            document.getElementById('customConfidence').value = 'verified';
        });
    });

    // Custom type change - update amount label
    document.getElementById('customType').addEventListener('change', (e) => {
        const gramsInput = document.getElementById('gramsInput');

        if (e.target.value === 'drink') {
            gramsInput.placeholder = '250';
        } else {
            gramsInput.placeholder = '100';
        }
        configurePortionControls(null, e.target.value, false);
        updatePreview();
    });

    document.querySelectorAll('input[name="customTypeChoice"]').forEach((radio) => {
        radio.addEventListener('change', (event) => {
            if (!event.target.checked) return;
            const customType = document.getElementById('customType');
            customType.value = event.target.value;
            customType.dispatchEvent(new Event('change', { bubbles: true }));
        });
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

    searchInput.addEventListener('focus', (e) => {
        const itemType = document.querySelector('input[name="itemType"]:checked').value;
        openDropdownForInput(e.target.value.trim(), itemType);
    });

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

    document.getElementById('portionUnit').addEventListener('change', updatePreview);

    document.getElementById('queueButton').addEventListener('click', queueSelectedLogItem);
    document.getElementById('clearAddQueue').addEventListener('click', () => {
        pendingLogItems = [];
        renderPendingLogItems();
    });
    document.getElementById('addQueuedItems').addEventListener('click', async () => {
        if (pendingLogItems.length === 0) return;
        const logDate = getSelectedLogDate();
        if (!logDate) {
            showError('Günlüğe eklenecek tarihi seç.');
            return;
        }
        const queuedSnapshot = [...pendingLogItems];
        try {
            await addLogBatch(queuedSnapshot, logDate);
            queuedSnapshot.forEach(entry => {
                savePortionUsage(
                    entry.item,
                    entry.type,
                    entry.displayAmount,
                    entry.display_unit
                );
            });
            pendingLogItems = [];
            renderPendingLogItems();
            await refreshDailyLogViews();
            showError(`${queuedSnapshot.length} besin günlüğe eklendi.`, 'success');
        } catch (error) {
            console.error('Batch log add failed:', error);
            showError('Toplu ekleme tamamlanamadı. Liste korunuyor.');
        }
    });
    
    // Add button
    document.getElementById('addButton').addEventListener('click', async () => {
        const itemType = document.querySelector('input[name="itemType"]:checked').value;
        const logDate = getSelectedLogDate();
        const mealType = document.getElementById('mealType')?.value || 'snack';

        if (!logDate) {
        showError('Günlüğe eklenecek tarihi seç.');
            return;
        }

        if (itemType === 'custom') {
            // Handle custom item
            const customName = document.getElementById('customName').value.trim();
            const customType = document.getElementById('customType').value;
            const customKcal = parseFloat(document.getElementById('customKcal').value) || 0;
            const customProtein = parseFloat(document.getElementById('customProtein').value) || 0;
            const customCarb = parseFloat(document.getElementById('customCarb').value) || 0;
            const customFat = parseFloat(document.getElementById('customFat').value) || 0;
            const customFiber = parseFloat(document.getElementById('customFiber').value) || 0;
            const customSugar = parseFloat(document.getElementById('customSugar').value) || 0;
            const customSodium = parseFloat(document.getElementById('customSodium').value) || 0;
            const customConfidence = document.getElementById('customConfidence').value;
            const portion = getCurrentPortion(null, customType);

            if (!customName) {
                showError('Besine bir ad ver.');
                return;
            }

            if (!portion.baseAmount) {
                showError('Geçerli bir miktar gir.');
                return;
            }

            // Create custom item object
            const customItem = {
                id: 'custom_' + Date.now(),
                name: customName,
                type: customType,
                ref_amount: 100,
                kcal_100: customKcal,
                protein_100: customProtein,
                carb_100: customCarb,
                fat_100: customFat,
                fiber_100: customFiber,
                sugar_100: customSugar,
                sodium_100: customSodium,
                nutrition_confidence: ['verified', 'personal', 'estimated'].includes(customConfidence)
                    ? customConfidence
                    : 'verified',
                schema_version: APP_SCHEMA_VERSION
            };

            // Save to Firestore for persistence
            try {
                await setDoc(doc(db, 'custom_items', customItem.id), {
                    ...customItem,
                    type: customType,
                    created_at: serverTimestamp()
                });
            } catch (error) {
                console.error('Custom item not saved to Firestore:', error);
            showError('Besin kaydedilemedi ve günlüğe eklenmedi.');
                return;
            }

            // Kalıcı kayıt başarılı olduktan sonra yerel kataloğa ekle.
            if (customType === 'food') {
                foods.push(customItem);
            } else {
                drinks.push(customItem);
            }

            await addLog(customItem, portion.baseAmount, logDate, mealType, {
                amount: portion.displayAmount,
                unit: portion.unit
            });

            // Clear custom form
            document.getElementById('customName').value = '';
            document.getElementById('customKcal').value = '';
            document.getElementById('customProtein').value = '';
            document.getElementById('customCarb').value = '';
            document.getElementById('customFat').value = '';
            document.getElementById('customFiber').value = '';
            document.getElementById('customSugar').value = '';
            document.getElementById('customSodium').value = '';
            document.getElementById('customConfidence').value = 'verified';
        } else {
            // Handle preset item
            if (!selectedItem) {
        showError('Önce bir besin seç.');
                return;
            }

            const portion = getCurrentPortion(selectedItem, itemType);
            if (!portion.baseAmount) {
                showError('Geçerli bir miktar gir.');
                return;
            }

            await addLog(selectedItem, portion.baseAmount, logDate, mealType, {
                amount: portion.displayAmount,
                unit: portion.unit
            });
        }
    });
    
    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.form-group')) {
            closeDropdown();
        }
    });

    // Kayıt düzenleme modalı
    const editLogModal = document.getElementById('editLogModal');
    const closeEditLogModal = () => {
        editLogModal.classList.remove('active');
        editingLogId = null;
        if (lastEditLogTrigger?.isConnected) lastEditLogTrigger.focus();
        lastEditLogTrigger = null;
    };
    document.getElementById('closeEditLog').addEventListener('click', closeEditLogModal);
    document.getElementById('cancelEditLog').addEventListener('click', closeEditLogModal);
    document.getElementById('saveEditLog').addEventListener('click', saveEditedLog);
    editLogModal.addEventListener('click', (event) => {
        if (event.target === editLogModal) closeEditLogModal();
    });

    const moveMealModal = document.getElementById('moveMealModal');
    const closeMoveMealModal = () => {
        setModalOpen(moveMealModal, false);
        movingMealContext = null;
    };
    document.getElementById('closeMoveMeal').addEventListener('click', closeMoveMealModal);
    document.getElementById('cancelMoveMeal').addEventListener('click', closeMoveMealModal);
    document.getElementById('confirmMoveMeal').addEventListener('click', moveMealToDate);
    moveMealModal.addEventListener('click', event => {
        if (event.target === moveMealModal) closeMoveMealModal();
    });

    const confirmModal = document.getElementById('confirmModal');
    document.getElementById('closeConfirmModal').addEventListener('click', () => settleConfirmation(false));
    document.getElementById('cancelConfirmModal').addEventListener('click', () => settleConfirmation(false));
    document.getElementById('acceptConfirmModal').addEventListener('click', () => settleConfirmation(true));
    confirmModal.addEventListener('click', event => {
        if (event.target === confirmModal) settleConfirmation(false);
    });

    document.getElementById('dashboardTrainingToggle').addEventListener('click', toggleTodayTraining);

    // Settings Modal
    const settingsModal = document.getElementById('settingsModal');
    const settingsBtn = document.getElementById('settingsBtn');
    const closeSettings = document.getElementById('closeSettings');
    const cancelSettings = document.getElementById('cancelSettings');
    const saveSettingsBtn = document.getElementById('saveSettings');
    const resetAllDataBtn = document.getElementById('resetAllDataBtn');
    const importJsonInput = document.getElementById('importJsonInput');

    document.getElementById('exportJsonBtn').addEventListener('click', exportJsonBackup);
    document.getElementById('exportCsvBtn').addEventListener('click', exportLogsCsv);
    document.getElementById('importJsonBtn').addEventListener('click', () => importJsonInput.click());
    importJsonInput.addEventListener('change', async () => {
        const [file] = importJsonInput.files || [];
        if (file) await restoreJsonBackup(file);
        importJsonInput.value = '';
    });

    const closeSettingsModal = () => {
        settingsModal.classList.remove('active');
        if (lastSettingsTrigger?.isConnected) lastSettingsTrigger.focus();
        lastSettingsTrigger = null;
    };

    settingsBtn.addEventListener('click', () => {
        lastSettingsTrigger = document.activeElement;
        // Load current targets
        document.getElementById('targetKcal').value = TARGETS.kcal;
        document.getElementById('targetProtein').value = TARGETS.protein;
        document.getElementById('targetCarb').value = TARGETS.carb;
        document.getElementById('targetFat').value = TARGETS.fat;
        document.getElementById('targetKcal').readOnly = LOCK_TARGETS_TO_FIXED_PLAN;
        document.getElementById('targetProtein').readOnly = true;
        document.getElementById('targetCarb').readOnly = true;
        document.getElementById('targetFat').readOnly = true;
        renderMacroPreferencesForm(MACRO_PREFERENCES);

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
        if (prof.targetWeight) document.getElementById('profileTargetWeight').value = prof.targetWeight;
        updateDayTypeTargetFields();

        // Öneri kutusunu gizle (yeniden hesaplanması gerekir)
        document.getElementById('goalRecommendation').style.display = 'none';

        settingsModal.classList.add('active');
        window.requestAnimationFrame(() => closeSettings.focus());
    });

    closeSettings.addEventListener('click', closeSettingsModal);
    cancelSettings.addEventListener('click', closeSettingsModal);

    saveSettingsBtn.addEventListener('click', async () => {
        const macroPreferencesInput = getMacroPreferencesFormState();
        if (!areMacroPreferencesValid(macroPreferencesInput)) {
            showError('Protein, karbonhidrat ve yağ oranlarının toplamı %100 olmalı.');
            return;
        }
        const macroPreferences = normalizeMacroPreferences(macroPreferencesInput);
        const energyTarget = Number(document.getElementById('targetKcal').value);
        const calculatedMacros = calculateMacroTargets(energyTarget, macroPreferences);
        const targetInput = {
            kcal: energyTarget,
            ...calculatedMacros
        };
        if (!areTargetsValid(targetInput)) {
            showError('Kalori ve makro hedeflerini izin verilen aralıklarda gir.');
            return;
        }
        const newTargets = normalizeTargets(targetInput);
        updateDayTypeTargetFields();

        // Profil bilgilerini de kaydet
        const profileInput = {
            gender: document.getElementById('profileGender').value,
            age: document.getElementById('profileAge').value,
            height: document.getElementById('profileHeight').value,
            weight: document.getElementById('profileWeight').value,
            activity: document.getElementById('profileActivity').value,
            trainingDays: document.getElementById('profileTrainingDays').value,
            steps: document.getElementById('profileSteps').value,
            goalMode: document.getElementById('profileGoalMode').value,
            targetWeight: document.getElementById('profileTargetWeight').value
        };
        const hasProfileInput = Boolean(
            profileInput.gender || profileInput.age || profileInput.height || profileInput.weight
        );
        let profileToSave = loadProfile();

        if (hasProfileInput) {
            const profileError = validateCompleteProfile(profileInput);
            if (profileError) {
                showError(profileError);
                return;
            }
            profileToSave = normalizeProfile(profileInput);
        }

        saveMacroPreferences(macroPreferences);
        saveTargets(newTargets);
        if (hasProfileInput) saveProfile(profileToSave);

        const cloudSaved = await saveSettingsToCloud(newTargets, profileToSave, macroPreferences);
        if (!cloudSaved) {
            showError('Ayarlar Firebase\'e kaydedilemedi. Firestore kurallarini kontrol edin.');
        }

        // Update UI
        document.getElementById('targetKcalDisplay').textContent = newTargets.kcal;

        closeSettingsModal();
    });

    resetAllDataBtn.addEventListener('click', async () => {
        const approved = await requestConfirmation({
            title: 'Tüm verileri sil',
            message: 'Günlükler, ayarlar, ölçümler ve Firebase’deki ilerleme fotoğrafları kalıcı olarak silinecek. Bu işlem geri alınamaz.',
            confirmLabel: 'Tümünü kalıcı sil',
            danger: true
        });
        if (!approved) return;

        clearError();
        showLoading();

        try {
            const cloudWarnings = await resetApplicationData();
            closeSettingsModal();

            if (cloudWarnings.length > 0) {
                showError(`Yerel veriler sıfırlandı ancak bulutta eksik kalanlar var: ${cloudWarnings.join(' ')}`);
            } else {
                showError('Tüm veriler sıfırlandı.', 'success');
            }
        } catch (error) {
            console.error('Reset failed:', error);
            showError('Veriler sıfırlanırken bir hata oluştu.');
        } finally {
            hideLoading();
        }
    });

    // Close modal when clicking outside
    settingsModal.addEventListener('click', (e) => {
        if (e.target === settingsModal) {
            closeSettingsModal();
        }
    });

    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        if (confirmModal.classList.contains('active')) {
            settleConfirmation(false);
        } else if (moveMealModal.classList.contains('active')) {
            closeMoveMealModal();
        } else if (editLogModal.classList.contains('active')) {
            closeEditLogModal();
        } else if (settingsModal.classList.contains('active')) {
            closeSettingsModal();
        }
    });

    // Light/Dark mode - the editorial light theme is the default
    const darkModeBtn = document.getElementById('darkModeBtn');
    const DARK_MODE_KEY = 'darkMode';

    const isDarkMode = localStorage.getItem(DARK_MODE_KEY) === 'true';
    if (isDarkMode) {
        document.body.classList.add('dark-mode');
    }
    updateThemeControl(isDarkMode);

    darkModeBtn.addEventListener('click', () => {
        document.body.classList.toggle('dark-mode');
        const isNowDark = document.body.classList.contains('dark-mode');

        updateThemeControl(isNowDark);
        localStorage.setItem(DARK_MODE_KEY, isNowDark);
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
    if (profile.targetWeight) document.getElementById('profileTargetWeight').value = profile.targetWeight;
    updateDayTypeTargetFields();

    // Hedefleri Hesapla butonu
    document.getElementById('calculateGoals').addEventListener('click', calculateAndShowGoals);

    // --- Kilo Takibi ---
    const weightDateInput = document.getElementById('weightDate');
    weightDateInput.value = getToday();
    document.getElementById('measurementDate').value = getToday();
    document.getElementById('progressPhotoDate').value = getToday();
    document.getElementById('saveMeasurement').addEventListener('click', saveMeasurement);
    document.getElementById('saveProgressPhoto').addEventListener('click', addProgressPhotoFromForm);
    document.getElementById('progressPhotoInput').addEventListener('change', event => {
        const [file] = event.target.files || [];
        document.getElementById('progressPhotoFileName').textContent =
            file ? file.name : 'JPG, PNG veya WebP';
    });

    document.getElementById('saveWeight').addEventListener('click', async () => {
        const weight = parseFloat(document.getElementById('weightInput').value);
        const date = document.getElementById('weightDate').value;
        if (!weight || weight < 30 || weight > 250) {
            showError('30–250 kg arasında geçerli bir kilo gir.');
            return;
        }
        if (!date) {
            showError('Kilo kaydı için bir tarih seç.');
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

        const cloudSaved = await upsertWeightEntryToCloud({ date, weight });
        if (!cloudSaved && db) {
            showError('Kilo kaydı buluta gönderilemedi. Bağlantını kontrol edip yeniden dene.');
        }
    });

    renderWeightSection();

    // --- Logs Filter Event Listeners ---
    const quickDateButtons = [
        { element: document.getElementById('quickTodayBtn'), days: 1 },
        { element: document.getElementById('quickWeekBtn'), days: 7 },
        { element: document.getElementById('quickMonthBtn'), days: 30 }
    ];

    const syncQuickDateButtons = () => {
        const from = logsDateFilterInput?.value || '';
        const to = logsDateToFilterInput?.value || '';
        quickDateButtons.forEach(({ element, days }) => {
            if (!element) return;
            const expectedFrom = days === 1 ? today : getDateDaysAgo(days - 1);
            element.classList.toggle('active', from === expectedFrom && to === today);
        });
        const copySelectedButton = document.getElementById('copyFilteredDayBtn');
        if (copySelectedButton) {
            const canCopySelectedDay = Boolean(from && to && from === to && from !== today);
            copySelectedButton.disabled = !canCopySelectedDay;
            copySelectedButton.title = canCopySelectedDay
                ? 'Bu günün öğünlerini bugüne kopyala'
                : from === today && to === today
                    ? 'Bugünün kayıtları yeniden bugüne kopyalanamaz'
                    : 'Kopyalamak için tek bir gün seç';
        }
    };

    syncQuickDateButtons();

    const refreshDateRangeFilter = async () => {
        logsDateFilter = logsDateFilterInput?.value || '';
        logsDateToFilter = logsDateToFilterInput?.value || '';
        await loadLogsForRange(logsDateFilter, logsDateToFilter);
        logsVisibleCount = LOGS_PAGE_SIZE;
        syncLogsDateFilterPlaceholder();
        syncQuickDateButtons();
        renderLogs();
    };

    quickDateButtons.forEach(({ element, days }) => {
        element?.addEventListener('click', async () => {
            if (logsDateFilterInput) {
                logsDateFilterInput.value = days === 1 ? today : getDateDaysAgo(days - 1);
            }
            if (logsDateToFilterInput) logsDateToFilterInput.value = today;
            await refreshDateRangeFilter();
        });
    });

    if (logsDateFilterInput) {
        logsDateFilterInput.addEventListener('change', refreshDateRangeFilter);
        logsDateFilterInput.addEventListener('input', syncLogsDateFilterPlaceholder);
    }
    if (logsDateToFilterInput) {
        logsDateToFilterInput.addEventListener('change', refreshDateRangeFilter);
        logsDateToFilterInput.addEventListener('input', () => {
            syncLogsDateFilterPlaceholder();
        });
    }

    const clearLogsDateFilterBtn = document.getElementById('clearLogsDateFilter');
    if (clearLogsDateFilterBtn) {
        clearLogsDateFilterBtn.addEventListener('click', () => {
            logsDateFilter = '';
            logsDateToFilter = '';
            dateFilteredLogs = [];
            logsVisibleCount = LOGS_PAGE_SIZE;
            if (logsDateFilterInput) logsDateFilterInput.value = '';
            if (logsDateToFilterInput) logsDateToFilterInput.value = '';
            syncLogsDateFilterPlaceholder();
            syncQuickDateButtons();
            renderLogs();
        });
    }

    document.getElementById('loadMoreLogsBtn').addEventListener('click', () => {
        logsVisibleCount += LOGS_PAGE_SIZE;
        renderLogs();
    });

    document.getElementById('copyYesterdayBtn').addEventListener('click', async () => {
        const approved = await requestConfirmation({
            title: 'Dünkü öğünleri getir',
            message: 'Dünkü öğünlerin tamamı bugünün günlüğüne eklenecek.',
            confirmLabel: 'Bugüne ekle'
        });
        if (!approved) return;
        await copyDayLogs(getDateDaysAgo(1));
    });

    document.getElementById('copyFilteredDayBtn').addEventListener('click', async () => {
        const selectedCopyDate = logsDateFilter || logsDateToFilter;
        if (!selectedCopyDate || (logsDateFilter && logsDateToFilter && logsDateFilter !== logsDateToFilter)) {
        showError('Kopyalamak için tarih aralığı yerine tek bir gün seç.');
            return;
        }
        const approved = await requestConfirmation({
            title: 'Seçili günü kopyala',
            message: `${formatDate(selectedCopyDate)} tarihindeki öğünlerin tamamı bugüne eklenecek.`,
            confirmLabel: 'Bugüne ekle'
        });
        if (!approved) return;
        await copyDayLogs(selectedCopyDate);
    });

    // --- Catalog Event Listeners ---
    document.querySelectorAll('.catalog-filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.catalog-filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            catalogCategory = btn.dataset.category;
            renderCatalog();
        });
    });

    document.getElementById('catalogSearch').addEventListener('input', (e) => {
        catalogSearchTerm = e.target.value.trim();
        renderCatalog();
    });

    // --- Template Event Listeners ---
    document.getElementById('createTemplateBtn').addEventListener('click', showTemplateForm);
    document.getElementById('backToTemplates').addEventListener('click', hideTemplateForm);
    document.getElementById('saveTemplate').addEventListener('click', saveCurrentTemplate);
    document.getElementById('templateKind').addEventListener('change', event => {
        const isRecipe = event.target.value === 'recipe';
        document.getElementById('recipeSettings').hidden = !isRecipe;
        document.querySelector('label[for="templateName"]').textContent = isRecipe ? 'Tarif adı' : 'Öğün adı';
        document.getElementById('saveTemplate').textContent = isRecipe ? 'Tarifi kaydet' : 'Öğünü kaydet';
    });

    // Template search
    const tplSearchInput = document.getElementById('tplSearchInput');
    tplSearchInput.addEventListener('input', (e) => {
        const itemType = document.querySelector('input[name="tplItemType"]:checked').value;
        const term = e.target.value.trim();
        tplSelectedItem = null;
        if (!term) { closeTplDropdown(); return; }
        const items = itemType === 'food' ? foods : drinks;
        const filtered = items.filter(i => i.name.toLowerCase().includes(term.toLowerCase())).slice(0, 15);
        renderTplDropdown(filtered, term);
    });

    // Template item type change
    document.querySelectorAll('input[name="tplItemType"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            tplSelectedItem = null;
            document.getElementById('tplSearchInput').value = '';
            closeTplDropdown();
            // Miktar label guncelle
            const label = document.getElementById('tplAmountLabel');
            if (e.target.value === 'drink') {
                label.textContent = 'Porsiyon (ml)';
            } else {
                label.textContent = 'Porsiyon (gram)';
            }
        });
    });

    // Add item to template
    document.getElementById('addItemToTemplate').addEventListener('click', () => {
        if (!tplSelectedItem) { showError('Önce bir besin seç.'); return; }
        const grams = parseFloat(document.getElementById('tplGramsInput').value);
        if (!grams || grams <= 0) { showError('Geçerli bir porsiyon gir.'); return; }
        const itemType = document.querySelector('input[name="tplItemType"]:checked').value;

        currentTemplateItems.push({
            item_id: tplSelectedItem.id,
            item_name: tplSelectedItem.name,
            grams,
            type: itemType
        });

        tplSelectedItem = null;
        document.getElementById('tplSearchInput').value = '';
        document.getElementById('tplGramsInput').value = '';
        closeTplDropdown();
        renderTemplateFormItems();
    });
});

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getFirestore, collection, addDoc, query, where, getDocs, deleteDoc, doc, serverTimestamp, orderBy } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
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
});
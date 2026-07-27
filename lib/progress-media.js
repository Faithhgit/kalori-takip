const DB_NAME = 'kalori-progress-media';
const DB_VERSION = 1;
const STORE_NAME = 'photos';

function openDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
            const database = request.result;
            if (!database.objectStoreNames.contains(STORE_NAME)) {
                database.createObjectStore(STORE_NAME, { keyPath: 'id' });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function requestResult(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

export async function saveProgressPhoto(file, date, note = '') {
    if (!(file instanceof Blob)) throw new Error('Fotoğraf dosyası geçersiz.');
    const database = await openDatabase();
    const id = `${date}_${Date.now()}`;
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put({
        id,
        date,
        note: String(note || '').slice(0, 160),
        blob: file,
        createdAt: Date.now()
    });
    await new Promise((resolve, reject) => {
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
    });
    database.close();
    return id;
}

export async function loadProgressPhotos() {
    const database = await openDatabase();
    const records = await requestResult(
        database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll()
    );
    database.close();
    return records.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
}

export async function deleteProgressPhoto(id) {
    const database = await openDatabase();
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).delete(id);
    await new Promise((resolve, reject) => {
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
    });
    database.close();
}

export async function clearProgressPhotos() {
    const database = await openDatabase();
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).clear();
    await new Promise((resolve, reject) => {
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
    });
    database.close();
}

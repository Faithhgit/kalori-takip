import {
    collection,
    deleteDoc,
    doc,
    getDoc,
    getDocs,
    serverTimestamp,
    setDoc,
    updateDoc,
    writeBatch
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

export function createFirestoreStore(db) {
    if (!db) throw new Error('Firestore bağlantısı gerekli.');

    return Object.freeze({
        serverTimestamp,
        async getDocument(collectionName, id) {
            const snapshot = await getDoc(doc(db, collectionName, id));
            return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
        },
        async setDocument(collectionName, id, data, options = { merge: true }) {
            await setDoc(doc(db, collectionName, id), data, options);
            return id;
        },
        async updateDocument(collectionName, id, data) {
            await updateDoc(doc(db, collectionName, id), data);
            return id;
        },
        async deleteDocument(collectionName, id) {
            await deleteDoc(doc(db, collectionName, id));
        },
        async listCollection(collectionName) {
            const snapshot = await getDocs(collection(db, collectionName));
            return snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
        },
        async batchUpdate(collectionName, changes) {
            const batch = writeBatch(db);
            changes.forEach(change => {
                batch.update(doc(db, collectionName, change.id), change.data);
            });
            await batch.commit();
        }
    });
}

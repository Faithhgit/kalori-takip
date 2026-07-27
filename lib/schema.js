export const APP_SCHEMA_VERSION = 3;
export const SCHEMA_VERSION_KEY = 'appSchemaVersion';

export function runLocalMigrations(storage) {
    const current = Number(storage.getItem(SCHEMA_VERSION_KEY)) || 1;
    if (current >= APP_SCHEMA_VERSION) {
        return { from: current, to: current, migrated: false };
    }

    if (current < 2) {
        const legacyRecent = storage.getItem('recentItems');
        if (legacyRecent && !storage.getItem('recentItemsV2')) {
            storage.setItem('recentItemsV2', legacyRecent);
        }
    }

    if (current < 3 && !storage.getItem('macroPreferences')) {
        storage.setItem('macroPreferences', JSON.stringify({
            strategy: 'protein_focused',
            proteinPct: 35,
            carbPct: 35,
            fatPct: 30
        }));
    }

    storage.setItem(SCHEMA_VERSION_KEY, String(APP_SCHEMA_VERSION));
    return { from: current, to: APP_SCHEMA_VERSION, migrated: true };
}
